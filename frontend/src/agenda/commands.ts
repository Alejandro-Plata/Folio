// Órdenes de la barra rápida, por reglas y sin conexión. Además de crear
// tareas («mañana a las 10 dentista»), la barra entiende:
//  - Consultas: «¿qué tengo mañana?», «qué hay el jueves», «esta semana».
//  - Mover: «mueve el dentista al viernes a las 12», «pasa inglés a las 18».
//  - Borrar: «cancela la reunión del jueves», «borra dentista».
//  - Hecha: «marca inglés como hecha», «ya he hecho el repaso».
//  - Avisar: «avísame del dentista 30 minutos antes».
// Cada orden se muestra antes de aplicarla; nada cambia sin Intro o un clic.
import { addDays, startOfWeek } from './dates';
import type { Task } from './model';
import { parse, parseMany, type Draft } from './parse';
import { fold } from './time';
import type { TaskType } from './model';

export type Command =
  | { kind: 'create'; drafts: Draft[] }
  | { kind: 'query'; from: string; to: string; label: string }
  | { kind: 'move'; query: string; on?: string; date?: string; start?: string }
  | { kind: 'delete'; query: string; on?: string }
  | { kind: 'done'; query: string; on?: string }
  | { kind: 'remind'; query: string; on?: string; minutes: number };

const MOVE = /^(?:mueve(?:me)?|mover|pasa(?:me)?|pasar|cambia(?:me)?|cambiar|aplaza(?:me)?|aplazar|retrasa(?:me)?|retrasar|adelanta(?:me)?|adelantar|lleva|llevar)\s+/;
const DELETE = /^(?:borra(?:me)?|borrar|cancela(?:me)?|cancelar|elimina(?:me)?|eliminar|quita(?:me)?|quitar|anula(?:r)?)\s+/;
const DONE_A = /^(?:marca(?:r)?|pon(?:er)?)\s+(.+?)\s+como\s+(?:hecha|hecho|terminada|terminado|completada|completado)$/;
const DONE_B = /^(?:ya\s+)?(?:he\s+)?(?:hecho|terminado|acabado|completado|termine|acabe|hice)\s+(.+)$/;
const REMIND = /^(?:avisame|recuerdame|pon(?:me)?\s+(?:un\s+)?aviso)\s+(?:de|del|para|de la|en)\s+(.+)$/;
const QUERY = /^(?:¿\s*)?(?:que\s+(?:tengo|hay|me\s+toca|toca)|tengo\s+algo|agenda\s+(?:de|del|para)|que\s+hago)\b\s*(.*?)\s*\??$/;

/** Entiende una frase de la barra. Lo que no es una orden se trata como tareas nuevas. */
export function parseCommand(text: string, today: string, types: TaskType[]): Command | null {
  const raw = text.trim();
  if (!raw) return null;
  const f = fold(raw).replace(/[¿?¡!.]+/g, ' ').replace(/\s+/g, ' ').trim();

  let m: RegExpExecArray | null;
  if ((m = QUERY.exec(f))) return query(m[1], today);

  if ((m = DONE_A.exec(f)) || (m = DONE_B.exec(f))) return { kind: 'done', ...target(m[1], today, types) };

  if ((m = REMIND.exec(f))) {
    // «avísame del dentista 30 minutos antes»: la frase de aviso la entiende parse
    const d = parse(m[1], today, types);
    return { kind: 'remind', ...target(m[1], today, types), minutes: d.remind ?? 0 };
  }

  if (DELETE.test(f)) return { kind: 'delete', ...target(f.replace(DELETE, ''), today, types) };

  if (MOVE.test(f)) {
    // «mueve X al viernes a las 12»: lo de después de «a/al/para» es el destino
    const rest = f.replace(MOVE, '');
    const cut = /\s(?:al|a|para el|para|hasta el|hasta)\s(?=(?:el\s)?(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|manana|pasado|hoy|\d|la semana|las?\s+\d|mediodia|dentro))/.exec(rest);
    const what = cut ? rest.slice(0, cut.index) : rest;
    const where = cut ? rest.slice(cut.index + cut[0].length) : '';
    const dest = where ? parse(where.replace(/^(?=las?\s+\d)/, 'a ').replace(/^(?=\d{1,2}(?::\d{2})?\b(?!\s*de))/, 'a las '), today, types) : null;
    const { query: q, on } = target(what, today, types);
    const hasDate = !!dest && dest.understood.some((u) => !/^a las|^de /.test(u) && !/min$/.test(u));
    return { kind: 'move', query: q, on, date: hasDate ? dest!.date : undefined, start: dest?.start };
  }

  const drafts = parseMany(raw, today, types);
  return drafts.length ? { kind: 'create', drafts } : null;
}

/** Qué tarea se nombra y, si la frase lo dice, de qué día («la reunión del jueves»). */
function target(text: string, today: string, types: TaskType[]): { query: string; on?: string } {
  const d = parse(text, today, types);
  const dated = d.understood.some((u) => u === 'hoy' || u === 'mañana' || u.startsWith('el '));
  const q = fold(d.title || text).replace(/^(?:el|la|los|las|mi|lo de|de)\s+/, '').replace(/\s+(?:de|del)$/, '').trim();
  return { query: q, on: dated ? d.date : undefined };
}

function query(rest: string, today: string): Command {
  const r = rest.replace(/^(?:para|el|de|del)\s+/, '').trim();
  if (!r || /^hoy\b/.test(r)) return { kind: 'query', from: today, to: today, label: 'Hoy' };
  if (/^pasado manana/.test(r)) return { kind: 'query', from: addDays(today, 2), to: addDays(today, 2), label: 'Pasado mañana' };
  if (/^manana/.test(r)) return { kind: 'query', from: addDays(today, 1), to: addDays(today, 1), label: 'Mañana' };
  if (/^(?:esta )?semana(?! que viene| proxima)/.test(r)) return { kind: 'query', from: today, to: addDays(startOfWeek(today), 6), label: 'Esta semana' };
  if (/semana (?:que viene|proxima)|proxima semana/.test(r)) {
    const a = addDays(startOfWeek(today), 7);
    return { kind: 'query', from: a, to: addDays(a, 6), label: 'La semana que viene' };
  }
  if (/fin de semana|finde/.test(r)) {
    const sat = addDays(startOfWeek(today), 5);
    return { kind: 'query', from: sat < today ? today : sat, to: addDays(sat, 1), label: 'El fin de semana' };
  }
  const d = parse(r, today, []);
  return { kind: 'query', from: d.date, to: d.date, label: '' };
}

/**
 * Tareas que encajan con lo nombrado: todas las palabras de la búsqueda están
 * en el título (sin tildes ni mayúsculas). Se prefieren las de ese día y, si no
 * lo dice, las próximas.
 */
export function matchTasks(tasks: Task[], q: string, today: string, on?: string): Task[] {
  const words = fold(q).split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
  if (!words.length) return [];
  const hits = tasks.filter((t) => {
    if (on && t.date !== on) return false;
    const title = fold(t.title);
    return words.every((w) => title.includes(w) || title.includes(w.replace(/s$/, '')));
  });
  const dist = (t: Task) => (t.date >= today ? 0 : 1e6) + Math.abs(Date.parse(t.date) - Date.parse(today)) / 864e5 + (t.done ? 1e3 : 0);
  return hits.sort((a, b) => dist(a) - dist(b) || (a.start ?? '').localeCompare(b.start ?? ''));
}

const STOP = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'a', 'al', 'en', 'mi', 'con', 'y', 'que', 'tarea', 'evento', 'cita']);
