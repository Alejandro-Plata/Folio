// Panel lateral de la agenda: minicalendario para saltar a cualquier día,
// lo próximo de hoy, tipos (con filtro y editor) y accesos al temario, al plan
// y al progreso.
import type { App } from '../app';
import { h, modal } from '../ui/dom';
import { icon } from '../ui/icons';
import type { Task, TaskType } from './model';
import { MONTHS, WEEKDAYS_LETTER, addDays, addMonths, longDate, minutesOf, range, startOfMonth, startOfWeek, toDate } from './dates';
import { taskChip } from './views/common';
import { planDialog } from './plansettings';
import { topicsDialog } from './topics';
import { statsDialog } from './stats';
import type { AgendaView } from './view';

const ICONS = ['bookOpen', 'history', 'target', 'graduation', 'users', 'pencil', 'flask', 'heart', 'activity', 'clipboard', 'calendar', 'star', 'lightbulb', 'globe', 'music', 'leaf'];
const PATTERNS: [TaskType['pattern'], string][] = [['solid', 'Liso'], ['stripes', 'Rayas'], ['dots', 'Puntos'], ['grid', 'Cuadrícula']];

export class AgendaSidebar {
  el = h('div', { class: 'ag-side' });
  private miniMonth = '';
  private nextTasks: Task[] = [];
  /** Hay cambios sin pintar porque el panel estaba oculto. */
  stale = true;

  constructor(private view: AgendaView, private app: App) {}

  async render() {
    // Oculto (otro modo o móvil): se pinta al volver a mostrarse
    if (!this.el.isConnected || this.el.closest('[hidden]')) { this.stale = true; return; }
    this.stale = false;
    const v = this.view;
    if (!this.miniMonth || !v.cursor.startsWith(this.miniMonth)) this.miniMonth = v.cursor.slice(0, 7);
    const today = v.state.today;
    const upcoming = (await v.state.range(today, addDays(today, 1))).filter((t) => !t.done && (t.date > today || !t.start || minutesOf(t.start) + (t.minutes || 30) >= new Date().getHours() * 60 + new Date().getMinutes()));
    this.nextTasks = upcoming.slice(0, 6);
    this.el.replaceChildren(this.mini(), this.next(), this.nav(), this.types(), this.circles());
  }

  /** Minicalendario (también lo usa el móvil, en una hoja). */
  miniCalendar(): HTMLElement { return this.mini(); }

  private mini(): HTMLElement {
    const v = this.view;
    const first = `${this.miniMonth}-01`;
    const busy = new Set(v.state.recent.map((t) => t.date));
    const head = h('div', { class: 'ag-mini-head' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mes anterior', html: icon('chevronLeft', 14), onclick: () => { this.miniMonth = addMonths(first, -1).slice(0, 7); void this.render(); } }),
      h('button', { type: 'button', class: 'ag-mini-title', onclick: () => v.goTo('month', first) }, `${MONTHS[toDate(first).getMonth()]} ${first.slice(0, 4)}`),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mes siguiente', html: icon('chevronRight', 14), onclick: () => { this.miniMonth = addMonths(first, 1).slice(0, 7); void this.render(); } }));
    const grid = h('div', { class: 'ag-mini', role: 'group', 'aria-label': 'Minicalendario: elige un día' }, ...WEEKDAYS_LETTER.map((l) => h('span', { class: 'ag-mini-wd', 'aria-hidden': 'true' }, l)));
    const start = startOfWeek(startOfMonth(first));
    const [vfrom, vto] = v.view === 'week' ? [startOfWeek(v.cursor), addDays(startOfWeek(v.cursor), 6)] : [v.cursor, v.cursor];
    for (const d of range(start, addDays(start, 41))) {
      grid.append(h('button', {
        type: 'button',
        class: `ag-mini-day ${d.slice(0, 7) !== this.miniMonth ? 'is-other' : ''} ${d === v.state.today ? 'is-today' : ''} ${d >= vfrom && d <= vto ? 'is-in' : ''} ${busy.has(d) ? 'has-tasks' : ''} ${d === v.state.settings.examDate ? 'is-exam' : ''}`,
        'aria-label': longDate(d) + (d === v.state.settings.examDate ? ', examen' : ''),
        onclick: () => v.goTo(v.view === 'year' || v.view === 'month' ? 'week' : v.view, d),
      }, String(toDate(d).getDate())));
    }
    return h('section', { class: 'ag-side-sec' }, head, grid);
  }

  private next(): HTMLElement {
    const v = this.view;
    const list = h('div', { class: 'ag-next' });
    if (!this.nextTasks.length) list.append(h('p', { class: 'sb-empty' }, 'Nada pendiente para hoy ni mañana.'));
    let lastDate = '';
    for (const t of this.nextTasks) {
      if (t.date !== lastDate) {
        lastDate = t.date;
        list.append(h('div', { class: 'ag-next-day' }, t.date === v.state.today ? 'Hoy' : 'Mañana'));
      }
      // Fila compacta; el detalle del repaso está en la propia tarea
      list.append(taskChip(v, t, { draggable: true }));
    }
    return h('section', { class: 'ag-side-sec' }, h('div', { class: 'sb-title' }, 'Próximo'), list);
  }

  private types(): HTMLElement {
    const v = this.view;
    const box = h('div', { class: 'ag-legend' });
    for (const t of v.state.types) {
      const hidden = v.hidden.has(t.id);
      box.append(h('button', {
        type: 'button', class: `ag-legend-item ${hidden ? 'is-off' : ''}`, 'aria-pressed': String(!hidden),
        title: hidden ? `Mostrar «${t.name}»` : `Ocultar «${t.name}»`, onclick: () => { v.toggleType(t.id); void this.render(); },
      },
      h('span', { class: `ag-type-dot pat-${t.pattern}`, style: { '--c': t.color } }),
      h('span', { class: 'ag-legend-name' }, t.name),
      h('span', { class: 'ag-legend-p', title: 'Prioridad' }, String(t.priority))));
    }
    return h('section', { class: 'ag-side-sec' },
      h('div', { class: 'sb-title' }, h('span', {}, 'Tipos y prioridades'),
        h('button', { type: 'button', class: 'icon-btn sb-title-btn', title: 'Editar tipos', 'aria-label': 'Editar tipos', html: icon('pencil', 13), onclick: () => void typesDialog(v) })),
      box);
  }

  /** Círculos: mostrar u ocultar sus eventos, abrir cada uno y las citas. */
  private circles(): HTMLElement {
    const v = this.view;
    const social = this.app.social;
    const title = h('div', { class: 'sb-title' }, h('span', {}, 'Círculos'),
      h('button', { type: 'button', class: 'icon-btn sb-title-btn', title: 'Gestionar círculos', 'aria-label': 'Gestionar círculos', html: icon('settings', 13),
        onclick: () => void import('../social/circles').then((m) => m.circlesDialog(this.app)) }));
    if (!social.snap.configured) return h('span', { hidden: true });
    if (!social.snap.signedIn) {
      return h('section', { class: 'ag-side-sec' }, h('div', { class: 'sb-title' }, h('span', {}, 'Círculos')),
        h('button', { type: 'button', class: 'sb-item', onclick: () => void import('../social/account').then((m) => m.accountDialog(this.app)) },
          h('span', { class: 'sb-ic', html: icon('users') }), h('span', { class: 'sb-label' }, 'Entra para compartir eventos')));
    }
    const box = h('div', { class: 'ag-legend' });
    for (const c of social.circles) {
      const id = `circle:${c.id}`;
      const hidden = v.hidden.has(id);
      box.append(h('button', {
        type: 'button', class: `ag-legend-item ${hidden ? 'is-off' : ''}`, 'aria-pressed': String(!hidden),
        title: hidden ? `Mostrar los eventos de «${c.name}»` : `Ocultar los eventos de «${c.name}»`, onclick: () => { v.toggleType(id); void this.render(); },
      }, h('span', { class: 'ag-legend-circle', style: { '--c': c.color }, html: icon(c.kind === 'couple' ? 'heart' : 'users', 11) }), h('span', { class: 'ag-legend-name' }, c.name),
      h('span', { class: 'ag-legend-p', title: 'Personas' }, String(c.circle_members.length))));
    }
    const pending = social.pending.length;
    return h('section', { class: 'ag-side-sec' }, title,
      social.circles.length ? box : h('button', { type: 'button', class: 'sb-item', onclick: () => void import('../social/circles').then((m) => m.circlesDialog(this.app)) },
        h('span', { class: 'sb-ic', html: icon('plus') }), h('span', { class: 'sb-label' }, 'Crear o unirte a un círculo')),
      social.couples.length ? h('button', { type: 'button', class: 'sb-item', onclick: () => void import('../social/dates').then((m) => m.datesDialog(this.app)) },
        h('span', { class: 'sb-ic', html: icon('heart') }), h('span', { class: 'sb-label' }, 'Citas'), pending ? h('span', { class: 'sb-count', title: 'Por responder' }, String(pending)) : null) : null);
  }

  private nav(): HTMLElement {
    const v = this.view;
    const item = (ic: string, label: string, hint: string, run: () => void) =>
      h('button', { type: 'button', class: 'sb-item', onclick: run, title: hint }, h('span', { class: 'sb-ic', html: icon(ic) }), h('span', { class: 'sb-label' }, label));
    const topics = v.state.topics.filter((t) => !t.archived);
    const studied = topics.filter((t) => t.studied).length;
    return h('section', { class: 'ag-side-sec ag-side-nav' }, h('div', { class: 'sb-title' }, 'Estudio'),
      item('layers', `Temario${topics.length ? ` · ${studied}/${topics.length}` : ''}`, 'Temas de la oposición', () => void topicsDialog(v, this.app)),
      item('clock', 'Plan de estudio', 'Examen, tiempo de estudio y repasos', () => void planDialog(v)),
      item('barChart', 'Progreso', 'Horas, temario y repasos', () => void statsDialog(v, this.app)));
  }
}

/** Editor de tipos: nombre, prioridad (orden), color, icono, trama y si cuenta como estudio. */
export async function typesDialog(view: AgendaView) {
  const list: TaskType[] = view.state.types.map((t) => ({ ...t }));
  const box = h('div', { class: 'ag-typelist' });
  const draw = () => {
    list.forEach((t, i) => { t.priority = i + 1; });
    box.replaceChildren(...list.map((t, i) => {
      const name = h('input', { class: 'input input-sm', value: t.name, 'aria-label': `Nombre del tipo ${i + 1}` });
      name.addEventListener('input', () => { t.name = name.value; });
      const color = h('input', { type: 'color', class: 'ag-color', value: t.color, 'aria-label': `Color de ${t.name}` });
      color.addEventListener('input', () => { t.color = color.value; swatch.style.setProperty('--c', color.value); });
      const ic = h('select', { class: 'input input-sm', 'aria-label': `Icono de ${t.name}` }, ...ICONS.map((x) => h('option', { value: x, selected: x === t.icon }, x)));
      ic.addEventListener('change', () => { t.icon = ic.value; swatch.innerHTML = icon(t.icon, 14); });
      const pat = h('select', { class: 'input input-sm', 'aria-label': `Trama de ${t.name}` }, ...PATTERNS.map(([v, l]) => h('option', { value: v, selected: v === t.pattern }, l)));
      pat.addEventListener('change', () => { t.pattern = pat.value as TaskType['pattern']; swatch.className = `ag-type-swatch pat-${t.pattern}`; });
      const study = h('input', { type: 'checkbox', checked: t.countsAsStudy });
      study.addEventListener('change', () => { t.countsAsStudy = study.checked; });
      const fixed = h('input', { type: 'checkbox', checked: t.fixed });
      fixed.addEventListener('change', () => { t.fixed = fixed.checked; });
      const swatch = h('span', { class: `ag-type-swatch pat-${t.pattern}`, style: { '--c': t.color }, html: icon(t.icon, 14) });
      const btn = (ic2: string, label: string, run: () => void, disabled = false) => h('button', { type: 'button', class: 'icon-btn', title: label, 'aria-label': label, html: icon(ic2, 14), disabled, onclick: run });
      return h('div', { class: 'ag-typerow' },
        h('span', { class: 'ag-typerow-p', title: 'Prioridad' }, String(i + 1)), swatch, name, color, ic, pat,
        h('label', { class: 'ag-check', title: 'Sus minutos cuentan como tiempo de estudio' }, study, 'Estudio'),
        h('label', { class: 'ag-check', title: 'El planificador nunca la mueve' }, fixed, 'Fija'),
        btn('chevronUp', 'Subir prioridad', () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); }, i === 0),
        btn('chevronDown', 'Bajar prioridad', () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; draw(); }, i === list.length - 1),
        btn('trash', 'Quitar tipo', () => { list.splice(i, 1); draw(); }, list.length <= 1 || ['study', 'review'].includes(t.id)));
    }));
  };
  draw();
  const add = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { list.push({ id: '', name: 'Nuevo tipo', priority: list.length + 1, color: '#6b6560', icon: 'star', pattern: 'solid', countsAsStudy: false, fixed: false }); draw(); } }, h('span', { html: icon('plus', 14) }), 'Añadir tipo');
  const body = h('div', { class: 'ag-form' },
    h('p', { class: 'muted small' }, 'El orden es la prioridad (1 = máxima): decide qué va primero en un día y qué se recoloca antes si no cabe todo. Cada tipo tiene color, icono y trama para distinguirlo sin depender del color.'),
    box, add);
  const res = await modal('Tipos y prioridades', body, [{ label: 'Cancelar', value: null, kind: 'ghost' }, { label: 'Guardar', value: 'ok', kind: 'primary' }], { wide: true, className: 'ag-modal' });
  if (res === 'ok') await view.state.setTypes(list);
}

