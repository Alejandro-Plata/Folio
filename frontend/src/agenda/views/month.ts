// Vista de mes: cuadrícula 6 × 7 accesible (role="grid", un solo elemento
// enfocable que se mueve con las flechas). Se seleccionan varios días
// arrastrando, con Mayús+clic o Ctrl+clic, y se sueltan tareas en otro día.
import { h } from '../../ui/dom';
import { icon } from '../../ui/icons';
import type { Task } from '../model';
import { WEEKDAYS, WEEKDAYS_SHORT, addDays, duration, longDate, range, startOfMonth, startOfWeek, toDate, weekday } from '../dates';
import { doneBox, taskChip, visible, type ViewHost } from './common';
import { timeLabel } from '../dates';


export function monthRange(cursor: string): [string, string] {
  const from = startOfWeek(startOfMonth(cursor));
  return [from, addDays(from, 41)];
}

export function renderMonth(host: ViewHost, root: HTMLElement, tasks: Task[]) {
  const [from, to] = monthRange(host.cursor);
  const month = host.cursor.slice(0, 7);
  const list = visible(host, tasks);
  const byDay = new Map<string, Task[]>();
  for (const t of list) (byDay.get(t.date) ?? byDay.set(t.date, []).get(t.date)!).push(t);

  const mobile = document.body.classList.contains('is-mobile');
  // Móvil: la lista del día elegido, debajo de la cuadrícula
  const dayList = h('section', { class: 'ag-mday', 'aria-live': 'polite', 'aria-label': 'Tareas del día elegido' });
  const drawDay = () => {
    const d = host.cursor;
    const tasks = byDay.get(d) ?? [];
    dayList.replaceChildren(
      h('header', { class: 'ag-mday-head' }, h('strong', {}, longDate(d, false)),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Añadir una tarea el ${longDate(d, false)}`, title: 'Añadir una tarea', html: icon('plus', 18), onclick: () => host.newTask(d) })),
      ...(tasks.length ? tasks.map((t) => h('div', { class: `ag-list-row ${t.done ? 'is-done' : ''}` }, doneBox(host, t), h('div', { class: 'ag-list-time' }, t.start ? timeLabel(t.start) : ''), taskChip(host, t, { showTime: false })))
        : [h('p', { class: 'muted small ag-list-none' }, 'Sin tareas este día.')]),
      h('button', { type: 'button', class: 'btn btn-sm ag-mday-open', onclick: () => host.goTo('day', d) }, 'Ver el día entero'));
  };
  // Cuántos chips caben en una celda con la altura disponible
  const rowH = Math.max(70, (root.clientHeight - 60) / 6);
  const MAX_CHIPS = Math.max(1, Math.floor((rowH - 30) / 24));
  let longTimer: ReturnType<typeof setTimeout> | undefined;
  let longPressed = false;
  const grid = h('div', { class: 'ag-month', role: 'grid', 'aria-label': 'Mes', 'aria-readonly': 'true' });
  grid.append(h('div', { class: 'ag-month-head', role: 'row' }, ...WEEKDAYS_SHORT.map((d, i) => h('div', { class: 'ag-month-wd', role: 'columnheader', 'aria-label': WEEKDAYS[i] }, d))));
  const days = range(from, to);
  let dragFrom = '';
  for (let r = 0; r < 6; r++) {
    const row = h('div', { class: 'ag-month-row', role: 'row' });
    for (const d of days.slice(r * 7, r * 7 + 7)) {
      const dayTasks = byDay.get(d) ?? [];
      const study = dayTasks.filter((t) => host.state.type(t.typeId).countsAsStudy).reduce((n, t) => n + (t.minutes || 0), 0);
      const isRest = dayTasks.some((t) => t.kind === 'rest') || host.state.settings.restDays.includes(weekday(d));
      const cell = h('div', {
        class: `ag-mcell ${d.slice(0, 7) !== month ? 'is-other' : ''} ${d === host.today ? 'is-today' : ''} ${host.selection.has(d) ? 'is-selected' : ''} ${isRest ? 'is-rest' : ''}`,
        role: 'gridcell', tabindex: d === host.cursor ? '0' : '-1', 'data-date': d,
        'aria-selected': String(host.selection.has(d)),
        'aria-label': `${longDate(d)}${d === host.today ? ', hoy' : ''}. ${dayTasks.length ? `${dayTasks.length} ${dayTasks.length === 1 ? 'tarea' : 'tareas'}` : 'Sin tareas'}${study ? `, ${duration(study)} de estudio` : ''}${isRest ? ', descanso' : ''}`,
      });
      const num = h('span', { class: 'ag-mcell-num' }, String(toDate(d).getDate()));
      const headRow = h('div', { class: 'ag-mcell-head' }, num, study ? h('span', { class: 'ag-mcell-load', title: 'Estudio planificado' }, duration(study)) : null);
      cell.append(headRow);
      const chips = h('div', { class: 'ag-mcell-tasks' });
      const shown = dayTasks.length > MAX_CHIPS ? MAX_CHIPS - 1 : MAX_CHIPS;
      if (mobile) {
        // Puntos de color; la forma cambia con el tipo para no depender solo del color
        for (const t of dayTasks.slice(0, 4)) {
          const ty = host.state.type(t.typeId);
          chips.append(h('span', { class: `ag-dot sh-${ty.pattern} ${t.done ? 'is-done' : ''}`, style: { '--c': ty.color }, 'aria-hidden': 'true' }));
        }
        if (dayTasks.length > 4) chips.append(h('span', { class: 'ag-dot-more', 'aria-hidden': 'true' }, `+${dayTasks.length - 4}`));
      } else {
        for (const t of dayTasks.slice(0, shown)) chips.append(taskChip(host, t, { draggable: true }));
        if (dayTasks.length > shown) {
          chips.append(h('button', { type: 'button', class: 'ag-more', onclick: (e: MouseEvent) => { e.stopPropagation(); host.goTo('day', d); } }, `+${dayTasks.length - shown} más`));
        }
      }
      cell.append(chips);
      // Ratón: clic selecciona y enfoca, doble clic crea, arrastrar selecciona varios días
      cell.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest('.ag-chip, .ag-more')) return;
        if (e.shiftKey) { host.select([d], 'extend'); return; }
        if (e.ctrlKey || e.metaKey) { host.select([d], 'toggle'); return; }
        dragFrom = d;
        host.setCursor(d, true);
        host.select([d], 'replace');
      });
      cell.addEventListener('mouseenter', () => {
        if (!dragFrom) return;
        const [a, b] = dragFrom < d ? [dragFrom, d] : [d, dragFrom];
        host.select(range(a, b), 'replace');
      });
      cell.addEventListener('dblclick', (e) => { if (!(e.target as HTMLElement).closest('.ag-chip')) host.newTask(d); });
      cell.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('application/x-folio-task')) { e.preventDefault(); cell.classList.add('is-drop'); } });
      cell.addEventListener('dragleave', () => cell.classList.remove('is-drop'));
      cell.addEventListener('drop', (e) => {
        cell.classList.remove('is-drop');
        const t = host.taskById(e.dataTransfer?.getData('application/x-folio-task') ?? '');
        if (t) { e.preventDefault(); host.moveTask(t, d, t.start); }
      });
      row.append(cell);
    }
    grid.append(row);
  }
  if (mobile) {
    // Tocar un día elige ese día; pulsación larga: selección de varios días
    grid.addEventListener('click', (e) => {
      const cell = (e.target as HTMLElement).closest('[data-date]') as HTMLElement | null;
      if (!cell || longPressed) { longPressed = false; return; }
      host.setCursor(cell.dataset.date!);
      grid.querySelectorAll('.is-cursor').forEach((c) => c.classList.remove('is-cursor'));
      cell.classList.add('is-cursor');
      drawDay();
    });
    grid.addEventListener('pointerdown', (e) => {
      const cell = (e.target as HTMLElement).closest('[data-date]') as HTMLElement | null;
      if (!cell) return;
      longTimer = setTimeout(() => { longPressed = true; navigator.vibrate?.(15); host.select([cell.dataset.date!], 'toggle'); }, 500);
    });
    for (const ev of ['pointerup', 'pointermove', 'pointercancel'] as const) grid.addEventListener(ev, () => clearTimeout(longTimer));
    grid.querySelector(`[data-date="${host.cursor}"]`)?.classList.add('is-cursor');
    drawDay();
  }
  const stop = () => { dragFrom = ''; document.removeEventListener('mouseup', stop); };
  grid.addEventListener('mousedown', () => document.addEventListener('mouseup', stop));
  gridKeys(host, grid, 7);
  root.replaceChildren(grid, ...(mobile ? [dayList] : []));
}

/**
 * Teclado de las cuadrículas: flechas por días, Inicio/Fin de la semana,
 * Mayús+flechas amplía la selección, Intro abre el día y N crea una tarea.
 */
export function gridKeys(host: ViewHost, grid: HTMLElement, rowLen: number) {
  grid.addEventListener('keydown', (e) => {
    const cell = (e.target as HTMLElement).closest('[data-date]') as HTMLElement | null;
    if (!cell || (e.target as HTMLElement).closest('.ag-chip, .ag-more')) return;
    const d = cell.dataset.date!;
    let next = '';
    switch (e.key) {
      case 'ArrowLeft': next = addDays(d, -1); break;
      case 'ArrowRight': next = addDays(d, 1); break;
      case 'ArrowUp': next = addDays(d, -rowLen); break;
      case 'ArrowDown': next = addDays(d, rowLen); break;
      case 'Home': next = startOfWeek(d); break;
      case 'End': next = addDays(startOfWeek(d), 6); break;
      case 'Enter': e.preventDefault(); host.goTo('day', d); return;
      case ' ': e.preventDefault(); host.select([d], 'toggle'); return;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) host.select([next], 'extend');
    host.setCursor(next, true);
  });
}
