// Controlador de la agenda: cabecera (navegación, vistas, barra rápida con
// dictado), cuerpo con la vista activa, barra de selección de varios días,
// atajos de teclado y anuncios para lectores de pantalla.
import type { App } from '../app';
import { api } from '../api';
import { on } from '../bus';
import { h, promptText, toast, confirmDialog, hasOpenModal } from '../ui/dom';
import { icon } from '../ui/icons';
import type { Scope, Session, Task, ViewKind } from './model';
import { AgendaState } from './state';
import {
  MONTHS, addDays, addMonths, endOfMonth, isoWeek, longDate, range, shortDate, startOfMonth, startOfWeek, todayISO, toDate,
} from './dates';
import { parseGoTo } from './parse';
import type { ViewHost } from './views/common';
import { renderTimeGrid } from './views/timegrid';
import { monthRange, renderMonth } from './views/month';
import { renderYear } from './views/year';
import { LIST_STEP, renderList } from './views/list';
import { attachSwipe } from './gestures';
import { sheet } from '../mobile/sheet';
import { taskDialog, askScope } from './editor';
import { doneDialog } from './done';
import { QuickAdd } from './quickadd';
import { AgendaSidebar } from './sidebar';
import { planDialog } from './plansettings';
import { topicsDialog } from './topics';
import { memoryPanel } from './memory';
import { statsDialog } from './stats';
import { templatesMenu } from './templates';
import './agenda.css';

const VIEW_KEY = 'folio-agenda-view';

export class AgendaView implements ViewHost {
  state = new AgendaState();
  view: ViewKind = document.body.classList.contains('is-mobile') ? 'list' : 'week';
  /** Días que enseña la vista de lista (crece con «Ver más días»). */
  listDays = LIST_STEP;
  cursor = todayISO();
  selection = new Set<string>();
  hidden = new Set<string>();
  sessions: Session[] = [];
  root = h('section', { id: 'agenda', class: 'agenda', 'aria-label': 'Agenda', hidden: true });
  private body = h('div', { class: 'ag-body' });
  private title = h('h2', { class: 'ag-title', 'aria-live': 'polite' });
  private examBadge = h('span', { class: 'ag-exam', hidden: true });
  private viewBtns = new Map<ViewKind, HTMLButtonElement>();
  private selBar = h('div', { class: 'ag-selbar', role: 'toolbar', 'aria-label': 'Días seleccionados', hidden: true });
  private banner = h('div', { class: 'ag-banner', role: 'status', hidden: true });
  private live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
  private tasks: Task[] = [];
  /** Interfaz móvil: otras vistas, cabecera compacta y gestos. */
  get mobile() { return document.body.classList.contains('is-mobile'); }
  private loadToken = 0;
  private clipboard: { tasks: Task[]; from: string } | null = null;
  quick!: QuickAdd;
  sidebar!: AgendaSidebar;
  private started = false;

  constructor(readonly app: App) {
    try {
      const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
      if (['list', 'day', '3days', 'week', 'month', 'year'].includes(saved.view) && (this.mobile ? saved.view !== 'week' : !['list', '3days'].includes(saved.view))) this.view = saved.view;
      if (Array.isArray(saved.hidden)) this.hidden = new Set(saved.hidden);
    } catch { /* */ }
  }

  get today() { return this.state.today; }

  /** Se llama la primera vez que se entra en la agenda. */
  async mount(container: HTMLElement) {
    if (this.started) return;
    this.started = true;
    if (!this.root.isConnected) container.append(this.root);
    await this.state.load();
    this.cursor = this.state.today;
    this.quick = new QuickAdd(this, this.app);
    this.sidebar = new AgendaSidebar(this, this.app);
    this.buildHead();
    this.root.append(this.banner, this.selBar, this.body, this.live);
    if (this.mobile) {
      attachSwipe(this);
      this.title.setAttribute('role', 'button');
      this.title.tabIndex = 0;
      this.title.title = 'Ir a un día';
      this.title.addEventListener('click', () => this.openMiniCalendar());
    }
    on('agenda:changed', () => void this.reload());
    on('social:changed', () => { if (!this.root.hidden) void this.sidebar.render(); });
    on('agenda:plan', () => this.showReport());
    // Atajos de la agenda con el foco en cualquier sitio (salvo campos y diálogos)
    window.addEventListener('keydown', (e) => { if (!this.root.hidden && !hasOpenModal() && !document.querySelector('.backstage, .popover')) this.onKey(e); });
    // A medianoche cambia «hoy»
    setInterval(() => { if (todayISO() !== this.state.today) { this.state.today = todayISO(); void this.reload(); } }, 60_000);
    await this.reload();
    this.autoPlan();
  }

  /**
   * Rehace el plan una vez al día (para recolocar lo que no se hizo) cuando la
   * agenda ya está pintada y el dispositivo está libre. Los cambios que afectan
   * al plan ya lo rehacen al guardarse.
   */
  private autoPlan() {
    const KEY = 'folio-agenda-planned';
    let last = '';
    try { last = localStorage.getItem(KEY) || ''; } catch { /* */ }
    if (!this.state.topics.length || last === this.state.today) return;
    const idle = (window as any).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 400));
    idle(() => void this.state.plan(true).then((r) => {
      if (!r) return;
      try { localStorage.setItem(KEY, this.state.today); } catch { /* */ }
      void this.state.refreshRecent().then(() => this.reload());
    }));
  }

  // ---------- Cabecera ----------

  private buildHead() {
    const nav = (ic: string, label: string, run: () => void, cls = 'icon-btn') =>
      h('button', { type: 'button', class: cls, title: label, 'aria-label': label, html: icon(ic, 16), onclick: run });
    const todayBtn = h('button', { type: 'button', class: 'btn btn-sm', title: 'Ir a hoy (H)', onclick: () => this.goTo(this.view, this.state.today) }, 'Hoy');
    const views = h('div', { class: 'ag-views', role: 'radiogroup', 'aria-label': 'Vista' });
    const kinds: [ViewKind, string, string][] = this.mobile
      ? [['list', 'Lista', ''], ['day', 'Día', 'D'], ['3days', '3 días', ''], ['month', 'Mes', 'M'], ['year', 'Año', 'A']]
      : [['day', 'Día', 'D'], ['week', 'Semana', 'S'], ['month', 'Mes', 'M'], ['year', 'Año', 'A']];
    for (const [v, label, key] of kinds) {
      const b = h('button', { type: 'button', class: 'ag-view', role: 'radio', title: key ? `${label} (${key})` : label, onclick: () => this.setView(v) }, label);
      this.viewBtns.set(v, b);
      views.append(b);
    }
    const goto = h('button', { type: 'button', class: 'btn btn-sm btn-ghost', title: 'Ir a una fecha (G)', onclick: () => void this.promptGoTo() }, h('span', { html: icon('calendar', 15) }), 'Ir a…');
    const row1 = h('div', { class: 'ag-head-row' },
      todayBtn,
      nav('chevronLeft', 'Anterior (← o RePág)', () => this.step(-1)),
      nav('chevronRight', 'Siguiente (→ o AvPág)', () => this.step(1)),
      this.title, this.examBadge,
      h('div', { class: 'spacer' }),
      goto, views);
    const tools = h('div', { class: 'ag-tools' },
      h('button', { type: 'button', class: 'btn btn-sm', title: 'Repartir estudio y repasos hasta el examen', onclick: () => void this.state.plan().then(() => this.showReport(true)) }, h('span', { html: icon('sparkles', 15) }), 'Planificar'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', title: 'Temario de la oposición', onclick: () => void topicsDialog(this, this.app) }, h('span', { html: icon('layers', 15) }), 'Temario'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', title: 'Tiempo de estudio, examen y repasos', onclick: () => void planDialog(this) }, h('span', { html: icon('clock', 15) }), 'Plan'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', title: 'Progreso del estudio', onclick: () => void statsDialog(this, this.app) }, h('span', { html: icon('barChart', 15) }), 'Progreso'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost ag-tpl-btn', title: 'Semanas tipo', onclick: (e: MouseEvent) => templatesMenu(this, e.currentTarget as HTMLElement) }, h('span', { html: icon('template', 15) }), 'Semana tipo'));
    const row2 = h('div', { class: 'ag-head-row ag-head-row2' }, this.quick.el, tools);
    this.root.append(h('header', { class: 'ag-head' }, row1, row2));
  }

  /** Móvil: tocar el título abre el minicalendario para saltar a cualquier día. */
  private openMiniCalendar() {
    const body = this.sidebar.miniCalendar();
    const s = sheet('Ir a un día', body);
    body.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('.ag-mini-day, .ag-mini-title')) setTimeout(() => s.close(), 0); });
  }

  private updateHead() {
    const c = this.cursor;
    let label = '';
    if (this.view === 'day') label = this.mobile ? longDate(c, false) : longDate(c);
    else if (this.view === 'list') label = `Desde el ${shortDate(c)}`;
    else if (this.view === '3days') label = `${shortDate(c)} – ${shortDate(addDays(c, 2))} ${addDays(c, 2).slice(0, 4)}`;
    else if (this.view === 'week') {
      const a = startOfWeek(c), b = addDays(a, 6);
      label = `Semana ${isoWeek(c)} · ${shortDate(a)} – ${shortDate(b)} ${b.slice(0, 4)}`;
    } else if (this.view === 'month') label = `${MONTHS[toDate(c).getMonth()]} ${c.slice(0, 4)}`;
    else label = c.slice(0, 4);
    this.title.textContent = label[0].toUpperCase() + label.slice(1);
    this.viewBtns.forEach((b, v) => { b.classList.toggle('on', v === this.view); b.setAttribute('aria-checked', String(v === this.view)); });
    const exam = this.state.settings.examDate;
    const left = exam ? Math.round((toDate(exam).getTime() - toDate(this.state.today).getTime()) / 86400000) : -1;
    this.examBadge.hidden = left < 0;
    this.examBadge.textContent = left === 0 ? 'Hoy es el examen' : left === 1 ? 'Falta 1 día para el examen' : `Faltan ${left} días para el examen`;
    this.examBadge.title = exam ? `Examen: ${longDate(exam)}` : '';
  }

  // ---------- Datos y dibujo ----------

  private visibleRange(): [string, string] {
    const c = this.cursor;
    if (this.view === 'day') return [c, c];
    if (this.view === 'list') return [c, addDays(c, this.listDays - 1)];
    if (this.view === '3days') return [c, addDays(c, 2)];
    if (this.view === 'week') return [startOfWeek(c), addDays(startOfWeek(c), 6)];
    if (this.view === 'month') return monthRange(c);
    return [`${c.slice(0, 4)}-01-01`, `${c.slice(0, 4)}-12-31`];
  }

  /** Vuelve a pedir los datos y a pintar. Las llamadas seguidas se agrupan en una. */
  reload(): Promise<void> {
    this.pending ??= new Promise<void>((resolve) => queueMicrotask(() => { this.pending = null; void this.doReload().then(resolve); }));
    return this.pending;
  }
  private pending: Promise<void> | null = null;

  private async doReload() {
    if (!this.started) return;
    const token = ++this.loadToken;
    const [from, to] = this.visibleRange();
    const [tasks, sessions] = await Promise.all([
      this.state.range(from, to),
      this.view === 'year' ? api.AgendaSessions(from, to) : Promise.resolve(this.sessions),
    ]);
    if (token !== this.loadToken) return;
    this.tasks = tasks;
    this.sessions = sessions ?? [];
    this.render();
    this.sidebar.render();
  }

  private render() {
    this.updateHead();
    const [from, to] = this.visibleRange();
    if (this.view === 'list') renderList(this, this.body, from, this.listDays, this.tasks, () => { this.listDays += LIST_STEP; void this.reload(); });
    else if (this.view === 'day' || this.view === 'week' || this.view === '3days') renderTimeGrid(this, this.body, range(from, to), this.tasks);
    else if (this.view === 'month') renderMonth(this, this.body, this.tasks);
    else renderYear(this, this.body, this.tasks);
    this.body.dataset.view = this.view;
    this.updateSelBar();
  }

  taskById(id: string) { return this.tasks.find((t) => t.id === id) ?? this.state.recent.find((t) => t.id === id); }

  // ---------- Navegación ----------

  setView(v: ViewKind) {
    this.view = v;
    this.persistView();
    void this.reload();
    this.announce(`Vista de ${({ list: 'lista', day: 'día', '3days': 'tres días', week: 'semana', month: 'mes', year: 'año' } as const)[v]}`);
  }

  goTo(v: ViewKind, date: string) {
    this.view = v;
    this.cursor = date;
    this.persistView();
    void this.reload();
  }

  step(dir: number) {
    const c = this.cursor;
    this.cursor = this.view === 'day' ? addDays(c, dir) : this.view === '3days' ? addDays(c, dir * 3) : this.view === 'list' ? addDays(c, dir * 7) : this.view === 'week' ? addDays(c, dir * 7) : this.view === 'month' ? addMonths(c, dir) : addMonths(c, dir * 12);
    void this.reload();
  }

  setCursor(date: string, focus = false) {
    const [from, to] = this.visibleRange();
    const inView = this.view === 'year' ? date.slice(0, 4) === this.cursor.slice(0, 4) : this.view === 'month' ? date >= from && date <= to && date.slice(0, 7) === this.cursor.slice(0, 7) || (date >= from && date <= to) : date >= from && date <= to;
    this.cursor = date;
    if (!inView) { void this.reload().then(() => focus && this.focusCursor()); return; }
    this.body.querySelectorAll<HTMLElement>('[role="gridcell"]').forEach((c) => { c.tabIndex = c.dataset.date === date ? 0 : -1; });
    if (focus) this.focusCursor();
  }

  private focusCursor() {
    (this.body.querySelector(`[data-date="${this.cursor}"][role="gridcell"]`) as HTMLElement | null)?.focus();
  }

  private persistView() {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ view: this.view, hidden: [...this.hidden] })); } catch { /* */ }
  }

  toggleType(id: string) {
    if (this.hidden.has(id)) this.hidden.delete(id); else this.hidden.add(id);
    this.persistView();
    this.render();
  }

  async promptGoTo() {
    const v = await promptText('Ir a una fecha', 'Escribe una fecha', '', { placeholder: '15 marzo · semana 12 · +3 semanas · mañana', ok: 'Ir' });
    if (!v) return;
    const d = parseGoTo(v, this.state.today);
    if (!d) { toast('No he entendido la fecha. Prueba con «15 marzo», «semana 12» o «+3 semanas».', { kind: 'error' }); return; }
    const view: ViewKind = /semana/i.test(v) ? 'week' : /^\D*$/.test(v) && /enero|febrero|marzo|abril|mayo|junio|julio|agosto|sep|octubre|noviembre|diciembre/i.test(v) ? 'month' : this.view === 'year' ? 'week' : this.view;
    this.goTo(view, d);
    this.announce(longDate(d));
  }

  // ---------- Selección de varios días ----------

  select(dates: string[], mode: 'replace' | 'toggle' | 'extend') {
    if (mode === 'replace') this.selection = new Set(dates);
    else if (mode === 'toggle') for (const d of dates) { if (this.selection.has(d)) this.selection.delete(d); else this.selection.add(d); }
    else {
      const anchor = this.cursor;
      const target = dates[0];
      const [a, b] = anchor < target ? [anchor, target] : [target, anchor];
      this.selection = new Set(range(a, b));
    }
    this.body.querySelectorAll<HTMLElement>('[data-date]').forEach((c) => {
      const on = this.selection.has(c.dataset.date!);
      c.classList.toggle('is-selected', on);
      if (c.getAttribute('role') === 'gridcell') c.setAttribute('aria-selected', String(on));
    });
    this.updateSelBar();
  }

  private updateSelBar() {
    const n = this.selection.size;
    this.selBar.hidden = n < 2;
    if (n < 2) return;
    const dates = [...this.selection].sort();
    const ids = this.tasksOn(dates).map((t) => t.id);
    const b = (ic: string, label: string, run: () => void, cls = 'btn btn-sm btn-ghost') => h('button', { type: 'button', class: cls, onclick: run }, h('span', { html: icon(ic, 15) }), label);
    this.selBar.replaceChildren(
      h('span', { class: 'ag-selbar-count' }, `${n} días seleccionados · ${shortDate(dates[0])} – ${shortDate(dates[dates.length - 1])}`),
      b('plus', 'Añadir tarea a todos', () => void taskDialog(this, this.app, { dates }), 'btn btn-sm btn-primary'),
      b('copy', 'Copiar (Ctrl+C)', () => this.copySelection()),
      b('chevronRight', 'Mover…', () => void this.moveSelection(ids)),
      b('moon', 'Marcar descanso', () => void this.markRest(dates)),
      b('trash', 'Borrar sus tareas', () => void this.deleteDays(ids, n)),
      h('div', { class: 'spacer' }),
      h('button', { type: 'button', class: 'icon-btn', title: 'Quitar selección (Esc)', 'aria-label': 'Quitar selección', html: icon('x', 15), onclick: () => this.select([], 'replace') }));
  }

  private tasksOn(dates: string[]) {
    const set = new Set(dates);
    return this.tasks.filter((t) => set.has(t.date));
  }

  private copySelection() {
    const dates = [...this.selection].sort();
    const from = dates[0] ?? this.cursor;
    const tasks = this.tasksOn(dates.length ? dates : [this.cursor]).filter((t) => !t.auto);
    this.clipboard = { tasks, from };
    toast(`${tasks.length} ${tasks.length === 1 ? 'tarea copiada' : 'tareas copiadas'}. Elige el primer día de destino y pulsa Ctrl+V.`, { ms: 4000 });
  }

  private async paste() {
    if (!this.clipboard?.tasks.length) { toast('No hay tareas copiadas. Selecciona días y pulsa Ctrl+C.'); return; }
    const target = this.cursor;
    const shift = Math.round((toDate(target).getTime() - toDate(this.clipboard.from).getTime()) / 86400000);
    const list = this.clipboard.tasks.map((t) => ({ ...t, id: '', date: addDays(t.date, shift), repeat: null, occurrenceOf: undefined, seriesId: undefined, done: false, auto: false }));
    await this.state.saveTasks(list, `${list.length} ${list.length === 1 ? 'tarea pegada' : 'tareas pegadas'} desde el ${shortDate(target)}`);
  }

  private async moveSelection(ids: string[]) {
    if (!ids.length) { toast('Los días seleccionados no tienen tareas.'); return; }
    const v = await promptText('Mover las tareas de los días seleccionados', 'Días: 1 = un día después, -2 = dos días antes, 7 = una semana después', '1', { ok: 'Mover' });
    const n = Number(v);
    if (!v || !Number.isFinite(n) || !n) return;
    await this.state.moveTasks(ids, Math.round(n), `${ids.length} ${ids.length === 1 ? 'tarea movida' : 'tareas movidas'} ${Math.abs(n)} ${Math.abs(n) === 1 ? 'día' : 'días'} ${n > 0 ? 'después' : 'antes'}`);
  }

  private async markRest(dates: string[]) {
    const type = this.state.types.find((t) => !t.countsAsStudy && !t.fixed) ?? this.state.types[this.state.types.length - 1];
    await this.state.saveTasks(dates.map((d) => ({ id: '', title: 'Descanso', typeId: type.id, date: d, kind: 'rest', done: false })), `${dates.length} días marcados como descanso: el plan no pondrá estudio`);
    if (this.state.topics.length) await this.state.plan(true);
  }

  private async deleteDays(ids: string[], n: number) {
    if (!ids.length) { toast('Los días seleccionados no tienen tareas.'); return; }
    if (!await confirmDialog(`¿Borrar las ${ids.length} tareas de estos ${n} días?`, 'Las tareas que se repiten solo se quitan de estos días. Se puede deshacer con Ctrl+Z.', 'Borrar', true)) return;
    await this.state.deleteTasks(ids, 'one', `${ids.length} tareas borradas`);
  }

  // ---------- Acciones sobre tareas (las usan las vistas) ----------

  openTask(t: Task) { void taskDialog(this, this.app, { task: t }); }

  newTask(date: string, start?: string, minutes?: number) { void taskDialog(this, this.app, { date, start, minutes }); }

  toggleDone(t: Task) {
    if (t.circle) return; // los eventos compartidos no se marcan como hechos
    if (!t.done && (t.topicId || t.kind === 'mock' || this.state.type(t.typeId).countsAsStudy)) { void doneDialog(this, t); return; }
    void this.state.setDone(t.id, !t.done).then(() => this.announce(t.done ? `«${t.title}» pendiente` : `«${t.title}» hecha`));
  }

  async moveTask(t: Task, date: string, start?: string) {
    if (t.date === date && t.start === start) return;
    const scope = t.occurrenceOf ? await askScope('Mover una tarea que se repite') : 'one';
    if (!scope) return void this.reload();
    const moved = { ...t, date, start, pinned: t.auto ? true : t.pinned };
    await this.state.saveTask(moved, scope as Scope);
    this.announce(`«${t.title}» movida al ${longDate(date, false)}${start ? ` a las ${start}` : ''}`);
  }

  async resizeTask(t: Task, minutes: number) {
    const scope = t.occurrenceOf ? await askScope('Cambiar la duración de una tarea que se repite') : 'one';
    if (!scope) return void this.reload();
    await this.state.saveTask({ ...t, minutes, pinned: t.auto ? true : t.pinned }, scope as Scope);
    this.announce(`«${t.title}» dura ahora ${minutes} minutos`);
  }

  async deleteTask(t: Task) {
    const scope = t.occurrenceOf ? await askScope('Borrar una tarea que se repite') : 'one';
    if (!scope) return;
    await this.state.deleteTasks([t.id], scope as Scope, `«${t.title}» borrada`);
  }

  memoryPanel(t: Task): HTMLElement | null { return memoryPanel(this, t); }

  announce(msg: string) {
    this.live.textContent = '';
    requestAnimationFrame(() => { this.live.textContent = msg; });
  }

  private showReport(force = false) {
    const r = this.state.lastReport;
    const warnings = r?.warnings ?? [];
    this.banner.hidden = !warnings.length && !force;
    this.banner.classList.toggle('is-ok', !warnings.length);
    if (this.banner.hidden || !r) return;
    const finish = r.finishDate ? `Terminarás el temario el ${longDate(r.finishDate, true)}.` : '';
    this.banner.replaceChildren(...[
      h('span', { class: 'ag-banner-ic', html: icon(warnings.length ? 'alert' : 'checkCircle', 18) }),
      h('div', { class: 'ag-banner-text' },
        ...(warnings.length ? warnings.map((w) => h('p', {}, w)) : [h('p', {}, `Plan al día: ${r.studies} bloques de estudio y ${r.reviews} repasos hasta ${longDate(r.horizon, true)}. ${finish}`)])),
      warnings.length ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => void planDialog(this) }, 'Ajustar el plan') : null,
      h('button', { type: 'button', class: 'icon-btn', title: 'Cerrar', 'aria-label': 'Cerrar aviso', html: icon('x', 15), onclick: () => { this.banner.hidden = true; } }),
    ].filter((x): x is HTMLElement => !!x));
  }

  // ---------- Teclado ----------

  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable="true"]') || e.isComposing) return;
    const k = e.key;
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    if (e.ctrlKey && !e.altKey && k.toLowerCase() === 'z') { e.preventDefault(); void this.state.undo(); return; }
    if (e.ctrlKey && !e.altKey && k.toLowerCase() === 'c' && (this.selection.size || this.view !== 'year')) { e.preventDefault(); this.copySelection(); return; }
    if (e.ctrlKey && !e.altKey && k.toLowerCase() === 'v') { e.preventDefault(); void this.paste(); return; }
    if (e.ctrlKey && k === ' ') { e.preventDefault(); this.quick.focus(); return; }
    if (!plain) return;
    const inGrid = !!t.closest('[role="gridcell"]');
    switch (k.toLowerCase()) {
      case 'd': this.setView('day'); break;
      case 's': this.setView('week'); break;
      case 'm': this.setView('month'); break;
      case 'a': this.setView('year'); break;
      case 'h': this.goTo(this.view, this.state.today); this.announce('Hoy'); break;
      case 'g': void this.promptGoTo(); break;
      case 'n': this.newTask(this.cursor); break;
      case '/': this.quick.focus(); break;
      case 'pageup': this.step(-1); break;
      case 'pagedown': this.step(1); break;
      case 'arrowleft': if (inGrid) return; this.step(-1); break;
      case 'arrowright': if (inGrid) return; this.step(1); break;
      case 'escape': if (!this.selection.size) return; this.select([], 'replace'); break;
      default: return;
    }
    e.preventDefault();
  }

  /** Muestra la agenda (al cambiar de espacio). */
  show() {
    this.root.hidden = false;
    if (this.started) void this.reload();
  }

  hide() { this.root.hidden = true; }

  /** Primer día del mes visible y último (para el minicalendario). */
  monthBounds(): [string, string] { return [startOfMonth(this.cursor), endOfMonth(this.cursor)]; }
}
