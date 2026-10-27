// Vista de lista (la principal en el móvil): los próximos días uno tras otro,
// cada uno con su cabecera y sus tareas como filas grandes. Los días sin tareas
// se agrupan para no ocupar la pantalla.
import { h } from '../../ui/dom';
import { icon } from '../../ui/icons';
import type { Task } from '../model';
import { addDays, duration, longDate, range, relativeDate, shortDate, timeLabel } from '../dates';
import { doneBox, taskChip, visible, type ViewHost } from './common';

export const LIST_STEP = 14;

export function renderList(host: ViewHost, root: HTMLElement, from: string, days: number, tasks: Task[], more: () => void) {
  const list = visible(host, tasks);
  const byDay = new Map<string, Task[]>();
  for (const t of list) (byDay.get(t.date) ?? byDay.set(t.date, []).get(t.date)!).push(t);
  const wrap = h('div', { class: 'ag-list', role: 'list', 'aria-label': 'Tareas por días' });
  const all = range(from, addDays(from, days - 1));
  let emptyRun: string[] = [];
  const flushEmpty = () => {
    if (!emptyRun.length) return;
    const a = emptyRun[0], b = emptyRun[emptyRun.length - 1];
    wrap.append(h('button', {
      type: 'button', class: 'ag-list-empty', title: 'Añadir una tarea', onclick: () => host.newTask(a),
    }, h('span', { html: icon('plus', 14), 'aria-hidden': 'true' }), a === b ? `Sin tareas el ${shortDate(a)}` : `Sin tareas del ${shortDate(a)} al ${shortDate(b)}`));
    emptyRun = [];
  };
  for (const d of all) {
    const tasks = byDay.get(d) ?? [];
    if (!tasks.length && d !== host.today) { emptyRun.push(d); continue; }
    flushEmpty();
    const study = tasks.filter((t) => host.state.type(t.typeId).countsAsStudy).reduce((n, t) => n + (t.minutes || 0), 0);
    const day = h('section', { class: `ag-list-day ${d === host.today ? 'is-today' : ''}`, role: 'listitem', 'aria-label': longDate(d) });
    day.append(h('header', { class: 'ag-list-head' },
      h('div', {}, h('strong', {}, d === host.today ? 'Hoy' : relativeDate(d, host.today) === shortDate(d) ? longDate(d, false) : capitalize(relativeDate(d, host.today))),
        h('span', { class: 'muted small' }, ` · ${longDate(d, false)}`)),
      h('span', { class: 'muted small' }, study ? duration(study) : ''),
      h('button', { type: 'button', class: 'icon-btn', title: `Añadir una tarea el ${shortDate(d)}`, 'aria-label': `Añadir una tarea el ${shortDate(d)}`, html: icon('plus', 18), onclick: () => host.newTask(d) })));
    if (!tasks.length) day.append(h('p', { class: 'ag-list-none muted small' }, 'Nada planificado para hoy.'));
    for (const t of tasks) {
      const type = host.state.type(t.typeId);
      day.append(h('div', { class: `ag-list-row ${t.done ? 'is-done' : ''}` },
        doneBox(host, t),
        h('div', { class: 'ag-list-time' }, t.start ? timeLabel(t.start) : '', t.minutes ? h('span', { class: 'muted small' }, duration(t.minutes)) : null),
        taskChip(host, t, { showTime: false }),
        h('span', { class: 'ag-list-type muted small' }, type.name),
        t.done ? null : host.memoryPanel(t)));
    }
    wrap.append(day);
  }
  flushEmpty();
  wrap.append(h('button', { type: 'button', class: 'btn ag-list-more', onclick: more }, 'Ver más días'));
  root.replaceChildren(wrap);
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
