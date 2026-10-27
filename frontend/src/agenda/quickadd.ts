// Barra rápida: se escribe (o se dicta) una frase y se ve qué se ha entendido
// antes de crear nada. Intro crea, Mayús+Intro abre el editor completo.
// También entiende órdenes sobre la agenda (consultar, mover, borrar, marcar
// como hecha, poner un aviso): ver commands.ts.
import type { App } from '../app';
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import { pushBack } from '../platform/back';
import type { Task } from './model';
import { WEEKDAYS_SHORT, addDays, duration, longDate, relativeDate, timeLabel } from './dates';
import type { Draft } from './parse';
import { matchTasks, parseCommand, type Command } from './commands';
import { getDefaultRemind, remindLabel } from '../platform/reminders';
import { taskDialog } from './editor';
import { Dictation } from './dictation';
import type { AgendaView } from './view';

export class QuickAdd {
  input = h('input', {
    class: 'ag-quick-input', type: 'text', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'Añadir o pedir: «mañana a las 10 dentista» · «¿qué tengo el jueves?» · «mueve inglés al viernes»',
    'aria-label': 'Añadir tareas o pedir algo a la agenda escribiendo una frase', 'aria-describedby': 'ag-quick-help',
  });
  private preview = h('div', { class: 'ag-preview', role: 'region', 'aria-label': 'Lo que se va a crear', 'aria-live': 'polite', hidden: true });
  private mic: HTMLButtonElement;
  el: HTMLElement;
  private drafts: Draft[] = [];
  /** Orden que no es crear (consultar, mover…) y las tareas que encajan. */
  private cmd: Exclude<Command, { kind: 'create' }> | null = null;
  private found: Task[] = [];
  private pick = 0;
  private seq = 0;
  dictation: Dictation;

  constructor(private view: AgendaView, private app: App) {
    this.dictation = new Dictation(this.app, (text) => this.receive(text));
    this.mic = h('button', {
      type: 'button', class: 'ag-mic', title: 'Dictar (mantén Ctrl+Mayús+Espacio)', 'aria-label': 'Dictar una tarea', html: icon('mic', 16),
      onclick: () => void this.dictation.toggle(this.mic),
    });
    this.el = h('div', { class: 'ag-quick' },
      h('span', { class: 'ag-quick-ic', html: icon('plus', 16), 'aria-hidden': 'true' }),
      this.input, this.mic, this.preview,
      h('span', { id: 'ag-quick-help', class: 'sr-only' }, 'Intro crea lo que se muestra debajo. Mayús e Intro abre el editor completo. Escape cancela.'));
    // Analizar la frase en cada letra es caro en móviles: se espera a que se deje de teclear
    let t: ReturnType<typeof setTimeout> | undefined;
    this.input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.update(), this.input.value.length < 3 ? 0 : 90); });
    this.input.addEventListener('focus', () => this.update());
    this.input.addEventListener('blur', () => setTimeout(() => { if (!this.el.contains(document.activeElement)) this.preview.hidden = true; }, 150));
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); if (this.cmd) { void this.run(); return; } this.update(); void (e.shiftKey ? this.edit(0) : this.create()); }
      else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && this.cmd && this.found.length > 1) {
        e.preventDefault();
        this.pick = (this.pick + (e.key === 'ArrowDown' ? 1 : this.found.length - 1)) % this.found.length;
        this.renderCommand();
      }
      else if (e.key === 'Escape') { e.preventDefault(); this.clear(); this.input.blur(); }
    });
    // Pulsar para hablar: mantener Ctrl+Mayús+Espacio
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && e.ctrlKey && e.shiftKey && !e.repeat && !this.view.root.hidden) { e.preventDefault(); void this.dictation.start(this.mic, true); }
    });
    window.addEventListener('keyup', (e) => {
      if ((e.code === 'Space' || e.key === 'Control' || e.key === 'Shift') && this.dictation.pushToTalk) void this.dictation.stop();
    });
  }

  focus() { this.input.focus(); this.input.select(); }

  /** Móvil: la barra rápida sube sobre el teclado como una hoja pequeña. */
  openMobile() {
    const body = document.body;
    if (body.classList.contains('m-quick-open')) { this.input.focus(); return; }
    body.classList.add('m-quick-open');
    const off = pushBack(() => close());
    const close = () => {
      off();
      body.classList.remove('m-quick-open');
      this.clear();
      this.input.blur();
      this.closeMobile = null;
    };
    this.closeMobile = close;
    setTimeout(() => this.input.focus(), 50);
  }

  /** Cierra la barra rápida del móvil (tras crear una tarea). */
  closeMobile: (() => void) | null = null;

  /** Dictar mientras se mantiene pulsado el botón flotante. */
  startHold() { void this.dictation.start(this.mic, true); }
  endHold() { void this.dictation.stop(); }

  private clear() { this.input.value = ''; this.drafts = []; this.cmd = null; this.found = []; this.preview.hidden = true; }

  /** Texto dictado: se pone en la barra y se muestra la vista previa. */
  private receive(text: string) {
    this.input.value = text;
    this.input.focus();
    this.update();
    this.view.announce(text ? `Dictado: ${text}` : 'No se ha entendido nada');
  }

  private update() {
    const text = this.input.value.trim();
    const st = this.view.state;
    const cmd = text ? parseCommand(text, st.today, st.types) : null;
    const seq = ++this.seq;
    if (cmd && cmd.kind !== 'create') {
      this.drafts = [];
      this.cmd = cmd;
      void this.resolve(cmd, seq);
      return;
    }
    this.cmd = null;
    this.drafts = cmd?.drafts ?? [];
    this.preview.hidden = !this.drafts.length;
    if (!this.drafts.length) return;
    this.preview.replaceChildren(...this.drafts.map((d, i) => this.row(d, i)),
      h('div', { class: 'ag-preview-foot' },
        h('span', { class: 'muted small ag-preview-keys' }, h('kbd', {}, 'Intro'), ` crear${this.drafts.length > 1 ? ` las ${this.drafts.length}` : ''} · `, h('kbd', {}, 'Mayús+Intro'), ' editar · ', h('kbd', {}, 'Esc'), ' cancelar'),
        h('div', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-sm btn-primary', onmousedown: (e: MouseEvent) => e.preventDefault(), onclick: () => void this.create() }, this.drafts.length > 1 ? `Crear ${this.drafts.length}` : 'Crear')));
  }

  private row(d: Draft, i: number): HTMLElement {
    const st = this.view.state;
    const type = st.type(d.typeId ?? this.defaultType());
    const topic = st.topicByNumber(d.topicNumber);
    const rep = d.repeat
      ? d.repeat.freq === 'daily' ? (d.repeat.interval > 1 ? `cada ${d.repeat.interval} días` : 'todos los días')
        : d.repeat.freq === 'monthly' ? 'cada mes'
          : `${d.repeat.interval > 1 ? `cada ${d.repeat.interval} semanas, ` : 'cada '}${(d.repeat.weekdays ?? []).map((w) => WEEKDAYS_SHORT[w - 1]).join(', ')}`
      : '';
    const pill = (ic: string, text: string) => h('span', { class: 'ag-pill' }, h('span', { html: icon(ic, 12) }), text);
    return h('div', { class: 'ag-preview-row' },
      h('span', { class: `ag-type-dot pat-${type.pattern}`, style: { '--c': type.color }, title: type.name }),
      h('div', { class: 'ag-preview-main' },
        h('strong', {}, d.title || type.name),
        h('div', { class: 'ag-pills' },
          pill('calendar', relativeDate(d.date, st.today)),
          d.start ? pill('clock', `${timeLabel(d.start)}${d.minutes ? ` · ${duration(d.minutes)}` : ''}`) : d.minutes ? pill('clock', duration(d.minutes)) : null,
          rep ? pill('repeat', rep + (d.repeat?.until ? ` hasta ${relativeDate(d.repeat.until, st.today)}` : '')) : null,
          pill(type.icon, type.name),
          topic ? pill('layers', `Tema ${topic.number}`) : d.topicNumber ? pill('alert', `El tema ${d.topicNumber} no está en el temario`) : null,
          d.remind !== undefined ? pill('bell', remindLabel(d.remind, !d.start)) : null)),
      h('button', { type: 'button', class: 'icon-btn', title: 'Editar antes de crear', 'aria-label': `Editar «${d.title}» antes de crear`, html: icon('pencil', 14), onmousedown: (e: MouseEvent) => e.preventDefault(), onclick: () => void this.edit(i) }));
  }

  private defaultType() {
    const st = this.view.state;
    return st.types.find((t) => t.id === 'personal')?.id ?? st.types[st.types.length - 1]?.id ?? '';
  }

  private toTask(d: Draft): Task {
    const st = this.view.state;
    const topic = st.topicByNumber(d.topicNumber);
    const typeId = d.typeId ?? (topic ? 'study' : this.defaultType());
    return {
      id: '', title: d.title || st.type(typeId).name, typeId, date: d.date, start: d.start, minutes: d.minutes, repeat: d.repeat ?? null,
      topicId: topic?.id, docId: topic?.docId, kind: topic ? (typeId === 'review' ? 'review' : typeId === 'mock' ? 'mock' : 'study') : '', done: false,
      remind: d.remind ?? (d.start ? getDefaultRemind() : null),
    };
  }

  // ---------- Órdenes ----------

  /** Busca las tareas a las que se refiere la orden y la muestra para confirmarla. */
  private async resolve(cmd: Exclude<Command, { kind: 'create' }>, seq: number) {
    const st = this.view.state;
    const tasks = cmd.kind === 'query'
      ? await st.range(cmd.from, cmd.to)
      : matchTasks(await st.range(addDays(st.today, -7), addDays(st.today, 90)), cmd.query, st.today, cmd.on).slice(0, 4);
    if (seq !== this.seq) return; // ha cambiado la frase mientras se buscaba
    this.found = cmd.kind === 'query' ? tasks.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? '')) : tasks;
    this.pick = 0;
    this.renderCommand();
  }

  private renderCommand() {
    const cmd = this.cmd;
    if (!cmd) return;
    const st = this.view.state;
    const when = (t: Task) => `${relativeDate(t.date, st.today)}${t.start ? ` · ${timeLabel(t.start)}` : ''}`;
    const taskRow = (t: Task, i: number, selectable: boolean) => {
      const type = st.type(t.typeId);
      return h('div', {
        class: `ag-preview-row ${selectable && i === this.pick ? 'is-picked' : ''}`, role: selectable ? 'option' : undefined, 'aria-selected': selectable ? String(i === this.pick) : undefined,
        onmousedown: (e: MouseEvent) => e.preventDefault(), onclick: () => { if (selectable) { this.pick = i; void this.run(); } else this.view.goTo('day', t.date); },
      },
      h('span', { class: `ag-type-dot pat-${type.pattern}`, style: { '--c': type.color }, title: type.name }),
      h('div', { class: 'ag-preview-main' }, h('strong', { class: t.done ? 'is-done' : '' }, t.title), h('span', { class: 'muted small' }, when(t))));
    };
    const foot = (keys: string, label: string | null) => h('div', { class: 'ag-preview-foot' },
      h('span', { class: 'muted small ag-preview-keys' }, h('kbd', {}, 'Intro'), ` ${keys} · `, h('kbd', {}, 'Esc'), ' cancelar'),
      h('div', { class: 'spacer' }),
      label ? h('button', { type: 'button', class: `btn btn-sm ${cmd.kind === 'delete' ? 'btn-danger' : 'btn-primary'}`, onmousedown: (e: MouseEvent) => e.preventDefault(), onclick: () => void this.run() }, label) : null);

    if (cmd.kind === 'query') {
      const label = cmd.label || longDate(cmd.from);
      this.preview.replaceChildren(...kids(
        h('div', { class: 'ag-preview-head' }, h('span', { html: icon('calendar', 14) }), label, h('span', { class: 'muted small' }, this.found.length ? ` · ${this.found.length} ${this.found.length === 1 ? 'tarea' : 'tareas'}` : '')),
        ...(this.found.length ? this.found.slice(0, 8).map((t, i) => taskRow(t, i, false)) : [h('p', { class: 'muted small ag-preview-empty' }, 'Nada previsto.')]),
        this.found.length > 8 ? h('p', { class: 'muted small ag-preview-empty' }, `Y ${this.found.length - 8} más.`) : null,
        foot(cmd.from === cmd.to ? 'ir a ese día' : 'ir a la semana', null)));
      this.preview.hidden = false;
      return;
    }
    const verb = { move: 'Mover', delete: 'Borrar', done: 'Marcar como hecha', remind: 'Poner aviso' }[cmd.kind];
    const detail = cmd.kind === 'move'
      ? `→ ${cmd.date ? relativeDate(cmd.date, st.today) : 'mismo día'}${cmd.start ? ` · ${timeLabel(cmd.start)}` : ''}`
      : cmd.kind === 'remind' ? `· ${remindLabel(cmd.minutes)}` : '';
    const nothing = cmd.kind === 'move' && !cmd.date && !cmd.start;
    this.preview.replaceChildren(...kids(
      h('div', { class: 'ag-preview-head' }, h('span', { html: icon(cmd.kind === 'move' ? 'calendar' : cmd.kind === 'delete' ? 'trash' : cmd.kind === 'done' ? 'check' : 'bell', 14) }), `${verb} ${detail}`),
      ...(this.found.length
        ? this.found.map((t, i) => taskRow(t, i, true))
        : [h('p', { class: 'muted small ag-preview-empty' }, cmd.query ? `No encuentro «${cmd.query}»${cmd.on ? ` el ${longDate(cmd.on, false)}` : ' en los próximos tres meses'}.` : 'Falta decir qué tarea.')]),
      nothing ? h('p', { class: 'muted small ag-preview-empty' }, 'Di adónde: «al viernes», «a las 18», «mañana a las 10».') : null,
      foot(this.found.length > 1 ? `${verb.toLowerCase()} la marcada (↑↓ para elegir)` : verb.toLowerCase(), this.found.length && !nothing ? verb : null)));
    this.preview.hidden = false;
  }

  /** Aplica la orden mostrada. */
  private async run() {
    const cmd = this.cmd;
    if (!cmd) return;
    if (cmd.kind === 'query') {
      this.clear();
      this.view.goTo(cmd.from === cmd.to ? 'day' : 'week', cmd.from);
      return;
    }
    const t = this.found[this.pick];
    if (!t) return;
    this.clear();
    this.closeMobile?.();
    if (cmd.kind === 'move') { if (cmd.date || cmd.start) await this.view.moveTask(t, cmd.date ?? t.date, cmd.start ?? t.start); }
    else if (cmd.kind === 'delete') await this.view.deleteTask(t);
    else if (cmd.kind === 'done') { if (!t.done) this.view.toggleDone(t); }
    else await this.view.state.saveTask({ ...t, remind: cmd.minutes }, t.occurrenceOf ? 'all' : 'one', `Aviso puesto: ${t.title} · ${remindLabel(cmd.minutes, !t.start)}`);
  }

  private async create() {
    if (!this.drafts.length) { this.update(); if (!this.drafts.length) return; }
    const tasks = this.drafts.map((d) => this.toTask(d));
    const r = await this.view.state.saveTasks(tasks, tasks.length > 1 ? `${tasks.length} tareas creadas` : `Creada: ${tasks[0].title} · ${relativeDate(tasks[0].date, this.view.state.today)}`);
    if (r) {
      this.clear();
      this.closeMobile?.();
      if (tasks.length === 1 && tasks[0].date !== this.view.cursor) this.view.setCursor(tasks[0].date);
    }
  }

  private async edit(i: number) {
    const d = this.drafts[i];
    if (!d) return;
    const t = this.toTask(d);
    this.clear();
    await taskDialog(this.view, this.app, { date: t.date, draft: t });
  }
}

const kids = (...c: (Node | string | null | false | undefined)[]) => c.filter((x): x is Node | string => !!x);
