// Vista de año: 12 meses pequeños. Cada día se colorea según las horas de
// estudio: las realizadas (sesiones) en el pasado y las planificadas en el
// futuro. Clic lleva a la semana; arrastrar selecciona un rango de días.
import { h } from '../../ui/dom';
import type { Task } from '../model';
import { MONTHS, WEEKDAYS_LETTER, addDays, duration, longDate, range, startOfWeek, toDate } from '../dates';
import { gridKeys } from './month';
import type { ViewHost } from './common';

/** Niveles del mapa de calor (minutos). */
const LEVELS = [1, 60, 120, 180, 240];

export function renderYear(host: ViewHost, root: HTMLElement, tasks: Task[]) {
  const year = Number(host.cursor.slice(0, 4));
  const planned = new Map<string, number>();
  for (const t of tasks) if (host.state.type(t.typeId).countsAsStudy && !host.hidden.has(t.typeId)) planned.set(t.date, (planned.get(t.date) ?? 0) + (t.minutes || 0));
  const studied = new Map<string, number>();
  for (const s of host.sessions) studied.set(s.date, (studied.get(s.date) ?? 0) + s.minutes);
  const exam = host.state.settings.examDate;

  const wrap = h('div', { class: 'ag-year', role: 'grid', 'aria-label': `Año ${year}` });
  let dragFrom = '';
  for (let m = 0; m < 12; m++) {
    const first = `${year}-${String(m + 1).padStart(2, '0')}-01`;
    const box = h('section', { class: 'ag-ymonth', 'aria-label': MONTHS[m] });
    box.append(h('button', { type: 'button', class: 'ag-ymonth-title', onclick: () => host.goTo('month', first) }, MONTHS[m]));
    const g = h('div', { class: 'ag-ymonth-grid' }, ...WEEKDAYS_LETTER.map((l) => h('span', { class: 'ag-ywd', 'aria-hidden': 'true' }, l)));
    const start = startOfWeek(first);
    for (const d of range(start, addDays(start, 41))) {
      if (d.slice(0, 7) !== first.slice(0, 7)) { g.append(h('span', { class: 'ag-yday is-empty', 'aria-hidden': 'true' })); continue; }
      const past = d < host.today;
      const mins = past ? (studied.get(d) ?? 0) : (planned.get(d) ?? 0);
      const level = LEVELS.filter((l) => mins >= l).length;
      const cell = h('span', {
        class: `ag-yday lv-${level} ${past ? 'is-past' : 'is-future'} ${d === host.today ? 'is-today' : ''} ${d === exam ? 'is-exam' : ''} ${host.selection.has(d) ? 'is-selected' : ''}`,
        role: 'gridcell', tabindex: d === host.cursor ? '0' : '-1', 'data-date': d,
        'aria-label': `${longDate(d)}. ${mins ? `${duration(mins)} ${past ? 'estudiadas' : 'planificadas'}` : past ? 'sin estudio' : 'sin plan'}${d === exam ? '. Examen' : ''}`,
        title: `${longDate(d)}\n${mins ? `${duration(mins)} ${past ? 'estudiadas' : 'planificadas'}` : '—'}${d === exam ? '\nExamen' : ''}`,
      }, String(toDate(d).getDate()));
      cell.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.shiftKey) { host.select([d], 'extend'); return; }
        if (e.ctrlKey) { host.select([d], 'toggle'); return; }
        dragFrom = d;
        host.select([], 'replace');
        host.setCursor(d, true);
      });
      cell.addEventListener('mouseenter', () => {
        if (!dragFrom || dragFrom === d) return;
        const [a, b] = dragFrom < d ? [dragFrom, d] : [d, dragFrom];
        host.select(range(a, b), 'replace');
      });
      cell.addEventListener('mouseup', () => {
        if (dragFrom === d && !host.selection.size) host.goTo('week', d);
        dragFrom = '';
      });
      g.append(cell);
    }
    box.append(g);
    wrap.append(box);
  }
  const legend = h('div', { class: 'ag-ylegend', 'aria-hidden': 'true' },
    h('span', {}, 'Menos'), ...[0, 1, 2, 3, 4, 5].map((l) => h('span', { class: `ag-yday lv-${l} is-past` })), h('span', {}, 'Más'),
    h('span', { class: 'ag-ylegend-sep' }), h('span', {}, 'Pasado: horas estudiadas · futuro: horas planificadas'));
  document.addEventListener('mouseup', () => { dragFrom = ''; }, { once: true });
  gridKeys(host, wrap, 7);
  root.replaceChildren(h('div', { class: 'ag-year-wrap' }, wrap, legend));
}
