// Aplicar las órdenes de la barra rápida y de Folito sobre la agenda. Va
// aparte de commands.ts para que el analizador no dependa de la interfaz (se
// prueba con Node).
import { addDays } from './dates';
import type { Task } from './model';
import type { Draft } from './parse';
import type { AgendaState } from './state';
import type { AgendaView } from './view';
import { matchTasks, type Command } from './commands';
import { getDefaultRemind, remindLabel } from '../platform/reminders';

export type Order = Exclude<Command, { kind: 'create' }>;

function defaultType(st: AgendaState) {
  return st.types.find((t) => t.id === 'personal')?.id ?? st.types[st.types.length - 1]?.id ?? '';
}

/** Tarea nueva a partir de lo entendido en una frase. */
export function draftToTask(st: AgendaState, d: Draft): Task {
  const topic = st.topicByNumber(d.topicNumber);
  const typeId = d.typeId ?? (topic ? 'study' : defaultType(st));
  return {
    id: '', title: d.title || st.type(typeId).name, typeId, date: d.date, start: d.start, minutes: d.minutes, repeat: d.repeat ?? null,
    topicId: topic?.id, docId: topic?.docId, kind: topic ? (typeId === 'review' ? 'review' : typeId === 'mock' ? 'mock' : 'study') : '', done: false,
    remind: d.remind ?? (d.start ? getDefaultRemind() : null),
  };
}

/** Tareas a las que se refiere una orden (las del periodo, si es una consulta). */
export async function findTargets(st: AgendaState, cmd: Order): Promise<Task[]> {
  if (cmd.kind === 'query') {
    const list = await st.range(cmd.from, cmd.to);
    return list.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? ''));
  }
  return matchTasks(await st.range(addDays(st.today, -7), addDays(st.today, 90)), cmd.query, st.today, cmd.on).slice(0, 4);
}

/** Aplica una orden sobre una tarea ya elegida. */
export async function applyOrder(view: AgendaView, cmd: Order, t: Task | undefined) {
  if (cmd.kind === 'query') { view.goTo(cmd.from === cmd.to ? 'day' : 'week', cmd.from); return; }
  if (!t) return;
  if (cmd.kind === 'move') { if (cmd.date || cmd.start) await view.moveTask(t, cmd.date ?? t.date, cmd.start ?? t.start); }
  else if (cmd.kind === 'delete') await view.deleteTask(t);
  else if (cmd.kind === 'done') { if (!t.done) view.toggleDone(t); }
  else await view.state.saveTask({ ...t, remind: cmd.minutes }, t.occurrenceOf ? 'all' : 'one', `Aviso puesto: ${t.title} · ${remindLabel(cmd.minutes, !t.start)}`);
}
