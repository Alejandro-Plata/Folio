// Piezas comunes de las vistas: chip de tarea accesible (color + icono + trama)
// y la interfaz que el controlador ofrece a las vistas.
import { h } from '../../ui/dom';
import { icon } from '../../ui/icons';
import type { Session, Task, TaskType } from '../model';
import { duration, hhmm, minutesOf, relativeDate, timeLabel } from '../dates';
import type { AgendaState } from '../state';

/** Lo que una vista puede pedir al controlador. */
export interface ViewHost {
  state: AgendaState;
  today: string;
  cursor: string;
  selection: Set<string>;
  hidden: Set<string>; // tipos ocultos en el filtro
  sessions: Session[];
  taskById(id: string): Task | undefined;
  openTask(t: Task): void;
  toggleDone(t: Task): void;
  newTask(date: string, start?: string, minutes?: number): void;
  moveTask(t: Task, date: string, start?: string): void;
  resizeTask(t: Task, minutes: number): void;
  deleteTask(t: Task): void;
  setCursor(date: string, focus?: boolean): void;
  select(dates: string[], mode: 'replace' | 'toggle' | 'extend'): void;
  goTo(view: 'day' | 'week' | 'month' | 'year', date: string): void;
  announce(msg: string): void;
  /** Panel plegable con la curva del olvido del tema de la tarea (null si no tiene tema). */
  memoryPanel(t: Task): HTMLElement | null;
}

export function taskEnd(t: Task): string {
  return t.start ? hhmm(minutesOf(t.start) + (t.minutes || 30)) : '';
}

/** Descripción completa para lectores de pantalla. */
export function taskLabel(t: Task, type: TaskType, today: string): string {
  const parts = [type.name, t.title, relativeDate(t.date, today)];
  if (t.start) parts.push(`de ${timeLabel(t.start)} a ${timeLabel(taskEnd(t))}`);
  else if (t.minutes) parts.push(duration(t.minutes));
  if (t.repeat || t.occurrenceOf) parts.push('se repite');
  if (t.remind != null) parts.push('con aviso');
  if (t.auto) parts.push(t.pinned ? 'del plan, fijada' : 'del plan');
  if (t.done) parts.push('hecha');
  if (t.circle) {
    parts.push(t.circle.kind === 'couple' ? 'evento de pareja' : 'evento compartido');
    if (t.circle.by) parts.push(`lo creó ${t.circle.mine ? 'tú' : t.circle.by}`);
    return parts.join(', ');
  }
  parts.push(`prioridad ${type.priority}`);
  return parts.join(', ');
}

/** Título corto para vistas compactas: el tipo ya lo dicen el icono y el color. */
export function shortTitle(t: Task): string {
  return t.auto ? t.title.replace(/^(Estudio|Repaso) · /, '') : t.title;
}

export function typeStyle(type: TaskType): Record<string, string> {
  return { '--c': type.color };
}

/** Chip compacto (mes, lista del día, panel lateral). */
export function taskChip(host: ViewHost, t: Task, opts: { showTime?: boolean; draggable?: boolean } = {}): HTMLElement {
  const type = host.state.type(t.typeId);
  const chip = h('button', {
    type: 'button',
    class: `ag-chip pat-${type.pattern} ${t.done ? 'is-done' : ''} ${t.auto ? 'is-auto' : ''}`,
    style: typeStyle(type),
    'aria-label': taskLabel(t, type, host.today),
    title: taskLabel(t, type, host.today),
    draggable: opts.draggable ? 'true' : undefined,
    dataset: { id: t.id },
  },
  h('span', { class: 'ag-chip-ic', html: icon(t.done ? 'checkCircle' : type.icon, 12) }),
  opts.showTime !== false && t.start ? h('span', { class: 'ag-chip-time' }, timeLabel(t.start)) : null,
  h('span', { class: 'ag-chip-title' }, shortTitle(t)),
  t.repeat || t.occurrenceOf ? h('span', { class: 'ag-chip-rep', html: icon('repeat', 11), 'aria-hidden': 'true' }) : null,
  t.remind != null ? h('span', { class: 'ag-chip-rep', html: icon('bell', 11), title: 'Con aviso' }) : null);
  chip.addEventListener('click', (e) => { e.stopPropagation(); host.openTask(t); });
  chip.addEventListener('keydown', (e) => {
    if (e.key === ' ') { e.preventDefault(); host.toggleDone(t); }
    else if (e.key === 'Delete') { e.preventDefault(); host.deleteTask(t); }
  });
  if (opts.draggable) {
    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('application/x-folio-task', t.id);
      e.dataTransfer!.effectAllowed = 'move';
      chip.classList.add('dragging');
    });
    chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
  }
  return chip;
}

/** Casilla de «hecha» independiente del chip. */
export function doneBox(host: ViewHost, t: Task): HTMLElement {
  // Los eventos de un círculo son de todos: no se marcan como hechos; se ve de quién son
  if (t.circle) {
    const label = `${t.circle.kind === 'couple' ? 'Pareja' : 'Círculo'} «${t.circle.name ?? ''}»${t.circle.by ? ` · lo creó ${t.circle.mine ? 'tú' : t.circle.by}` : ''}`;
    // Iniciales de quien lo creó: el icono del círculo ya va en el título
    const by = t.circle.mine ? 'Tú' : t.circle.by;
    const ini = by ? by.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() : '';
    return h('span', { class: 'ag-done ag-circle-mark', title: label, 'aria-label': label, html: ini ? '' : icon(t.circle.kind === 'couple' ? 'heart' : 'users', 12) }, ini);
  }
  return h('button', {
    type: 'button', class: `ag-done ${t.done ? 'on' : ''}`, role: 'checkbox', 'aria-checked': String(!!t.done),
    'aria-label': t.done ? `Marcar «${t.title}» como pendiente` : `Marcar «${t.title}» como hecha`,
    title: t.done ? 'Hecha · clic para desmarcar' : 'Marcar como hecha', html: icon('check', 12),
    onclick: (e: MouseEvent) => { e.stopPropagation(); host.toggleDone(t); },
  });
}

/** Filtra por tipos visibles. */
export function visible(host: ViewHost, list: Task[]): Task[] {
  return host.hidden.size ? list.filter((t) => !host.hidden.has(t.typeId)) : list;
}
