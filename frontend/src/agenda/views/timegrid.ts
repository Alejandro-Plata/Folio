// Vistas de día y de semana: rejilla horaria de 15 minutos. Se arrastra en un
// hueco para crear, se arrastra una tarea para moverla y su borde inferior
// para cambiar la duración. Con el teclado: Alt+↑/↓ mueve 15 min,
// Alt+Mayús+↑/↓ cambia la duración y Alt+←/→ la pasa a otro día.
import { h } from '../../ui/dom';
import { icon } from '../../ui/icons';
import type { Task } from '../model';
import { WEEKDAYS, WEEKDAYS_SHORT, addDays, duration, hhmm, longDate, minutesOf, timeLabel, toDate } from '../dates';
import { doneBox, shortTitle, taskChip, taskEnd, taskLabel, typeStyle, visible, type ViewHost } from './common';

const PX_PER_MIN = 1; // 60 px por hora
const SNAP = 15;

interface Placed { t: Task; top: number; height: number; col: number; cols: number }

/** Reparte en columnas las tareas que se solapan. */
function layout(tasks: Task[], dayStart: number): Placed[] {
  const items = tasks.filter((t) => t.start).map((t) => {
    const from = minutesOf(t.start);
    return { t, from, to: from + Math.max(t.minutes || 30, 15) };
  }).sort((a, b) => a.from - b.from || b.to - a.to);
  const out: Placed[] = [];
  let group: typeof items = [];
  let groupEnd = -1;
  const flush = () => {
    const colsEnd: number[] = [];
    const placed = group.map((it) => {
      let col = colsEnd.findIndex((end) => end <= it.from);
      if (col < 0) { col = colsEnd.length; colsEnd.push(it.to); } else colsEnd[col] = it.to;
      return { it, col };
    });
    for (const p of placed) out.push({ t: p.it.t, top: (p.it.from - dayStart) * PX_PER_MIN, height: Math.max(18, (p.it.to - p.it.from) * PX_PER_MIN - 2), col: p.col, cols: colsEnd.length });
    group = [];
  };
  for (const it of items) {
    if (it.from >= groupEnd && group.length) flush();
    group.push(it);
    groupEnd = Math.max(groupEnd, it.to);
  }
  if (group.length) flush();
  return out;
}

export function renderTimeGrid(host: ViewHost, root: HTMLElement, days: string[], tasks: Task[]) {
  const set = host.state.settings;
  const dayStart = Math.max(0, Math.min(minutesOf(set.dayStart) >= 0 ? minutesOf(set.dayStart) : 7 * 60, earliest(tasks)));
  const dayEnd = Math.min(24 * 60, Math.max(minutesOf(set.dayEnd) > 0 ? minutesOf(set.dayEnd) : 23 * 60, latest(tasks)));
  const list = visible(host, tasks);
  const byDay = new Map<string, Task[]>(days.map((d) => [d, []]));
  for (const t of list) byDay.get(t.date)?.push(t);

  const single = days.length === 1;
  const grid = h('div', { class: `ag-tg ${single ? 'is-day' : 'is-week'}`, style: { '--days': String(days.length) } });

  // Cabecera con los días y la fila «todo el día»
  const head = h('div', { class: 'ag-tg-head' }, h('div', { class: 'ag-tg-gutter' }));
  const allDay = h('div', { class: 'ag-tg-allday' }, h('div', { class: 'ag-tg-gutter ag-tg-allday-label' }, 'Todo el día'));
  for (const d of days) {
    const dt = toDate(d);
    const isToday = d === host.today;
    const capacity = studyLoad(host, byDay.get(d)!);
    head.append(h('button', {
      type: 'button', class: `ag-tg-day ${isToday ? 'is-today' : ''} ${host.selection.has(d) ? 'is-selected' : ''}`,
      'aria-label': `${longDate(d)}${isToday ? ', hoy' : ''}. Abrir el día`, title: 'Ver el día',
      onclick: (e: MouseEvent) => {
        if (e.shiftKey || e.ctrlKey) host.select([d], e.shiftKey ? 'extend' : 'toggle');
        else if (single) host.newTask(d);
        else host.goTo('day', d);
      },
    },
    h('span', { class: 'ag-tg-dname' }, single ? WEEKDAYS[(dt.getDay() + 6) % 7] : WEEKDAYS_SHORT[(dt.getDay() + 6) % 7]),
    h('span', { class: 'ag-tg-dnum' }, String(dt.getDate())),
    capacity ? h('span', { class: 'ag-tg-load', title: 'Estudio planificado' }, duration(capacity)) : null));
    const cell = h('div', { class: 'ag-tg-allday-cell', 'data-date': d });
    for (const t of byDay.get(d)!.filter((x) => !x.start)) {
      const row = h('div', { class: 'ag-allday-item' }, doneBox(host, t), taskChip(host, t, { draggable: true }));
      cell.append(row);
    }
    dropTarget(host, cell, d);
    allDay.append(cell);
  }

  // Cuerpo con las horas
  const body = h('div', { class: 'ag-tg-body' });
  const gutter = h('div', { class: 'ag-tg-gutter ag-tg-hours', 'aria-hidden': 'true' });
  for (let m = Math.ceil(dayStart / 60) * 60; m < dayEnd; m += 60) {
    gutter.append(h('div', { class: 'ag-tg-hour', style: { top: `${(m - dayStart) * PX_PER_MIN}px` } }, `${m / 60}:00`));
  }
  body.append(gutter);
  const height = (dayEnd - dayStart) * PX_PER_MIN;
  for (const d of days) {
    const col = h('div', {
      class: `ag-tg-col ${d === host.today ? 'is-today' : ''} ${host.selection.has(d) ? 'is-selected' : ''}`,
      style: { height: `${height}px` }, 'data-date': d, role: 'group', 'aria-label': longDate(d),
    });
    // Franja de estudio del día
    const w = set.windows?.[String(((toDate(d).getDay() + 6) % 7) + 1)];
    if (w && minutesOf(w.start) >= 0 && minutesOf(w.end) > minutesOf(w.start) && !set.restDays.includes(((toDate(d).getDay() + 6) % 7) + 1)) {
      col.append(h('div', { class: 'ag-tg-window', title: `Franja de estudio ${timeLabel(w.start)}–${timeLabel(w.end)}`, style: { top: `${(minutesOf(w.start) - dayStart) * PX_PER_MIN}px`, height: `${(minutesOf(w.end) - minutesOf(w.start)) * PX_PER_MIN}px` } }));
    }
    for (let m = Math.ceil(dayStart / 60) * 60; m < dayEnd; m += 60) col.append(h('div', { class: 'ag-tg-line', style: { top: `${(m - dayStart) * PX_PER_MIN}px` } }));
    if (d === host.today) {
      const now = new Date();
      const nm = now.getHours() * 60 + now.getMinutes();
      if (nm >= dayStart && nm <= dayEnd) col.append(h('div', { class: 'ag-tg-now', style: { top: `${(nm - dayStart) * PX_PER_MIN}px` }, 'aria-hidden': 'true' }));
    }
    for (const p of layout(byDay.get(d)!, dayStart)) col.append(block(host, p, d, days));
    createByDrag(host, col, d, dayStart, dayEnd);
    dropTarget(host, col, d, dayStart);
    body.append(col);
  }
  const scroll = h('div', { class: 'ag-tg-scroll' }, body);
  grid.append(head, allDay, scroll);
  root.replaceChildren(grid);
  // Al abrir, se ve la franja de estudio o la hora actual
  requestAnimationFrame(() => {
    const now = new Date().getHours() * 60;
    const focusMin = days.includes(host.today) ? now - 90 : minutesOf(set.windows?.['1']?.start ?? '16:00') - 120;
    scroll.scrollTop = Math.max(0, (Math.max(dayStart, focusMin) - dayStart) * PX_PER_MIN);
  });
}

function earliest(tasks: Task[]) { return Math.min(24 * 60, ...tasks.filter((t) => t.start).map((t) => Math.floor(minutesOf(t.start) / 60) * 60)); }
function latest(tasks: Task[]) { return Math.max(0, ...tasks.filter((t) => t.start).map((t) => Math.ceil((minutesOf(t.start) + (t.minutes || 30)) / 60) * 60)); }

function studyLoad(host: ViewHost, tasks: Task[]) {
  return tasks.filter((t) => host.state.type(t.typeId).countsAsStudy).reduce((n, t) => n + (t.minutes || 0), 0);
}

function block(host: ViewHost, p: Placed, date: string, days: string[]): HTMLElement {
  const t = p.t;
  const type = host.state.type(t.typeId);
  const el = h('div', {
    class: `ag-block pat-${type.pattern} ${t.done ? 'is-done' : ''} ${t.auto ? 'is-auto' : ''} ${p.height < 34 ? 'is-short' : ''}`,
    style: { ...typeStyle(type), top: `${p.top}px`, height: `${p.height}px`, left: `calc(${(p.col / p.cols) * 100}% + 2px)`, width: `calc(${100 / p.cols}% - 4px)` },
    'data-id': t.id,
  });
  const main = h('button', {
    type: 'button', class: 'ag-block-main', 'aria-label': taskLabel(t, type, host.today) + '. Intro para abrir, espacio para marcar hecha, Alt y flechas para mover.',
    title: `${t.title}\n${timeLabel(t.start)}–${timeLabel(taskEnd(t))}${t.notes ? '\n' + t.notes : ''}`,
  },
  h('span', { class: 'ag-block-title' }, h('span', { class: 'ag-block-ic', html: icon(type.icon, 12) }), shortTitle(t)),
  h('span', { class: 'ag-block-time' }, `${timeLabel(t.start)}–${timeLabel(taskEnd(t))}`, t.repeat || t.occurrenceOf ? h('span', { html: icon('repeat', 10) }) : null, t.pinned ? h('span', { html: icon('pin', 10), title: 'Fijada' }) : null));
  main.addEventListener('click', () => { if (!moved) host.openTask(t); });
  main.addEventListener('keydown', (e) => {
    if (e.key === ' ') { e.preventDefault(); host.toggleDone(t); return; }
    if (e.key === 'Delete') { e.preventDefault(); host.deleteTask(t); return; }
    if (!e.altKey) return;
    const start = minutesOf(t.start);
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' ? -1 : 1;
      if (e.shiftKey) host.resizeTask(t, Math.max(15, (t.minutes || 30) + dir * SNAP));
      else host.moveTask(t, date, hhmm(Math.max(0, Math.min(24 * 60 - 15, start + dir * SNAP))));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      host.moveTask(t, addDays(date, e.key === 'ArrowLeft' ? -1 : 1), t.start);
    }
  });
  el.append(doneBox(host, t), main);

  // Arrastrar para mover (también a otro día) y el borde para la duración
  const grip = h('div', { class: 'ag-block-resize', title: 'Arrastra para cambiar la duración', 'aria-hidden': 'true' });
  el.append(grip);
  let moved = false;
  /** Arrastre común a ratón y táctil: devuelve lo que hay que llamar al mover y al soltar. */
  const beginDrag = (mode: 'move' | 'resize', startX: number, startY: number) => {
    moved = false;
    const origTop = p.top, origH = p.height;
    const col = el.parentElement as HTMLElement;
    let targetDate = date;
    let newStart = minutesOf(t.start), newMin = t.minutes || 30;
    const onMove = (x: number, y: number, force = false) => {
      const dy = y - startY;
      if (!force && Math.abs(dy) < 4 && Math.abs(x - startX) < 4 && !moved) return;
      moved = true;
      el.classList.add('is-dragging');
      const snapped = Math.round(dy / PX_PER_MIN / SNAP) * SNAP;
      if (mode === 'resize') {
        newMin = Math.max(15, (t.minutes || 30) + snapped);
        el.style.height = `${Math.max(18, origH + snapped * PX_PER_MIN)}px`;
      } else {
        newStart = Math.max(0, Math.min(24 * 60 - 15, minutesOf(t.start) + snapped));
        el.style.top = `${origTop + snapped * PX_PER_MIN}px`;
        // ¿Otro día de la semana?
        const over = document.elementsFromPoint(x, y).find((e) => (e as HTMLElement).classList?.contains('ag-tg-col')) as HTMLElement | undefined;
        if (over && over.dataset.date && days.includes(over.dataset.date)) {
          targetDate = over.dataset.date;
          if (over !== el.parentElement) over.append(el);
        }
      }
      el.dataset.hint = mode === 'resize' ? duration(newMin) : `${timeLabel(hhmm(newStart))}`;
    };
    const onUp = () => {
      el.classList.remove('is-dragging');
      if (!moved) { if (el.parentElement !== col) col.append(el); return; }
      if (mode === 'resize') host.resizeTask(t, newMin);
      else host.moveTask(t, targetDate, hhmm(newStart));
      setTimeout(() => { moved = false; }, 0);
    };
    const cancel = () => {
      el.classList.remove('is-dragging');
      el.style.top = `${origTop}px`; el.style.height = `${origH}px`;
      if (el.parentElement !== col) col.append(el);
      moved = false;
    };
    return { onMove, onUp, cancel };
  };
  const drag = (mode: 'move' | 'resize') => (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const d = beginDrag(mode, e.clientX, e.clientY);
    const move = (ev: MouseEvent) => d.onMove(ev.clientX, ev.clientY);
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      d.onUp();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };
  main.addEventListener('mousedown', drag('move'));
  grip.addEventListener('mousedown', drag('resize'));

  // Táctil: el asa inferior arrastra al instante; el resto del bloque, tras una pulsación
  // larga (si no, el dedo desplaza la rejilla). Con el arrastre en marcha se bloquea el desplazamiento.
  const touchDrag = (mode: 'move' | 'resize', wait: number) => (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    const t0 = e.touches[0];
    let d: ReturnType<typeof beginDrag> | null = null;
    let last = { x: t0.clientX, y: t0.clientY };
    const start = () => { d = beginDrag(mode, t0.clientX, t0.clientY); d.onMove(last.x, last.y, true); navigator.vibrate?.(12); };
    const timer = wait ? setTimeout(start, wait) : (start(), undefined);
    const move = (ev: TouchEvent) => {
      const p1 = ev.touches[0];
      last = { x: p1.clientX, y: p1.clientY };
      if (d) { ev.preventDefault(); d.onMove(last.x, last.y, true); }
      else if (Math.hypot(last.x - t0.clientX, last.y - t0.clientY) > 8) { clearTimeout(timer); end(false); }
    };
    const end = (finish: boolean, ev?: Event) => {
      clearTimeout(timer);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onCancel);
      if (d && finish) { ev?.preventDefault(); d.onUp(); } else d?.cancel();
    };
    const onEnd = (ev: TouchEvent) => end(true, ev);
    const onCancel = () => end(false);
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: false });
    document.addEventListener('touchcancel', onCancel);
  };
  main.addEventListener('touchstart', touchDrag('move', 380), { passive: true });
  grip.addEventListener('touchstart', touchDrag('resize', 0), { passive: true });
  // Sin menú contextual del sistema al mantener pulsado
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  return el;
}

/** Arrastrar en un hueco crea una tarea con esa franja. */
function createByDrag(host: ViewHost, col: HTMLElement, date: string, dayStart: number, dayEnd: number) {
  col.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target !== col && !(e.target as HTMLElement).classList.contains('ag-tg-line') && !(e.target as HTMLElement).classList.contains('ag-tg-window')) return;
    e.preventDefault();
    const rect = col.getBoundingClientRect();
    const at = (y: number) => Math.max(dayStart, Math.min(dayEnd, dayStart + Math.floor((y - rect.top) / PX_PER_MIN / SNAP) * SNAP));
    const from = at(e.clientY);
    let to = from + 60;
    const ghost = h('div', { class: 'ag-ghost', style: { top: `${(from - dayStart) * PX_PER_MIN}px`, height: `${60 * PX_PER_MIN}px` } });
    col.append(ghost);
    let dragged = false;
    const onMove = (ev: MouseEvent) => {
      dragged = true;
      to = Math.max(from + SNAP, at(ev.clientY) + SNAP);
      ghost.style.height = `${(to - from) * PX_PER_MIN}px`;
      ghost.textContent = `${timeLabel(hhmm(from))}–${timeLabel(hhmm(to))}`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      ghost.remove();
      host.newTask(date, hhmm(from), dragged ? to - from : 60);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/** Soltar aquí un chip arrastrado (desde «todo el día» o el panel lateral). */
function dropTarget(host: ViewHost, el: HTMLElement, date: string, dayStart?: number) {
  el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('application/x-folio-task')) { e.preventDefault(); el.classList.add('is-drop'); } });
  el.addEventListener('dragleave', () => el.classList.remove('is-drop'));
  el.addEventListener('drop', (e) => {
    el.classList.remove('is-drop');
    const id = e.dataTransfer?.getData('application/x-folio-task');
    if (!id) return;
    e.preventDefault();
    const t = host.taskById(id);
    if (!t) return;
    let start: string | undefined;
    if (dayStart !== undefined) {
      const rect = el.getBoundingClientRect();
      start = hhmm(dayStart + Math.floor((e.clientY - rect.top) / PX_PER_MIN / SNAP) * SNAP);
    }
    host.moveTask(t, date, start);
  });
}
