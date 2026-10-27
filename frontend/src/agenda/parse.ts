// Analizador de frases en español para crear tareas escribiendo o dictando:
// «de lunes a viernes de 9 a 11 estudio tema 4 hasta el 20 de diciembre».
// Funciona por reglas, sin conexión. Cada regla reconoce un trozo de la frase y
// lo borra; lo que queda es el título.
import type { Repeat, TaskType } from './model';
import { addDays, addMonths, daysBetween, endOfMonth, hhmm, iso, minutesOf, weekday } from './dates';
import { fold, parseDuration, parseTime, wordsToDigits } from './time';

export interface Draft {
  title: string;
  date: string;
  start?: string;
  minutes?: number;
  repeat?: Repeat;
  typeId?: string;
  topicNumber?: number;
  /** Aviso: minutos antes del inicio (0 = a la hora). */
  remind?: number;
  /** Partes de la frase que se han entendido, para mostrarlas al confirmar. */
  understood: string[];
}

const WD: Record<string, number> = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7 };
const WD_RE = '(lunes|martes|miercoles|jueves|viernes|sabado|domingo)s?';
const MONTH: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const MONTH_RE = '(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)';
const HOUR = '(\\d{1,2}(?:[:.h]\\d{2})?(?:\\s*y\\s*(?:media|cuarto|\\d{1,2}))?(?:\\s*menos\\s*cuarto)?)';
const DAYPART = '(?:\\s*(de la manana|de la tarde|de la noche|de la madrugada|por la manana|por la tarde|por la noche|am|pm))?';

/** Separa varias tareas dictadas seguidas («… y luego …», «…; …»). */
export function splitPhrases(text: string): string[] {
  return text
    .split(/\s*(?:;|\.\s+|,?\s+y\s+luego\s+|,?\s+luego\s+|,?\s+y\s+despu[eé]s\s+|,?\s+despu[eé]s\s+|,\s+y\s+(?=(?:a las|el|ma[nñ]ana|hoy|de\s+\d)))\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Interpreta varias frases; las que no dicen fecha heredan la de la anterior. */
export function parseMany(text: string, today: string, types: TaskType[]): Draft[] {
  const out: Draft[] = [];
  for (const phrase of splitPhrases(text)) {
    const d = parse(phrase, today, types, out[out.length - 1]?.date);
    if (d.title || d.start) out.push(d);
  }
  return out;
}

/**
 * Interpreta una frase. `fallbackDate` es la fecha de la tarea anterior cuando
 * se dictan varias seguidas.
 */
export function parse(text: string, today: string, types: TaskType[], fallbackDate?: string): Draft {
  const original = wordsToDigits(text.normalize('NFC')).replace(/\s+/g, ' ').trim();
  let work = fold(original); // mismas posiciones que `original`
  const understood: string[] = [];
  const draft: Draft = { title: '', date: '', understood };

  /** Busca un patrón, lo borra de la frase y devuelve el resultado. */
  const take = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(work);
    if (!m) return null;
    work = work.slice(0, m.index) + ' '.repeat(m[0].length) + work.slice(m.index + m[0].length);
    return m;
  };
  const nextWeekday = (wd: number, from = today, includeToday = false) => {
    let n = (wd - weekday(from) + 7) % 7;
    if (n === 0 && !includeToday) n = 7;
    return addDays(from, n);
  };
  const dayMonth = (day: number, month: number, year?: number) => {
    const y = year ?? Number(today.slice(0, 4));
    let d = iso(new Date(y, month - 1, day, 12));
    if (!year && d < today) d = iso(new Date(y + 1, month - 1, day, 12));
    return d;
  };
  /** Horas «a las 5» sin «de la mañana»: de 1 a 7 se entiende por la tarde. */
  const hour = (raw: string, part?: string, pmHint = false): string | null => {
    const t = parseTime(raw + (part ? ' ' + part : ''));
    if (!t) return null;
    let m = minutesOf(t);
    if (!part && m < 8 * 60 && m >= 60 && (pmHint || !/^0/.test(raw))) m += 12 * 60;
    return hhmm(m);
  };

  // ---------- Repetición ----------
  let repeat: Repeat | undefined;
  let m: RegExpExecArray | null;
  if ((m = take(/\b(?:todos los dias|cada dia|a diario|diariamente)\b/))) {
    repeat = { freq: 'daily', interval: 1 };
    understood.push('todos los días');
  } else if ((m = take(/\b(?:cada (\d+) dias)\b/))) {
    repeat = { freq: 'daily', interval: +m[1] };
    understood.push(`cada ${m[1]} días`);
  } else if ((m = take(/\b(?:de lunes a viernes|entre semana|los dias laborables|dias laborables)\b/))) {
    repeat = { freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] };
    understood.push('de lunes a viernes');
  } else if ((m = take(/\b(?:los |cada |todos los )?fines? de semana\b/))) {
    repeat = { freq: 'weekly', interval: 1, weekdays: [6, 7] };
    understood.push('los fines de semana');
  } else if ((m = take(new RegExp(`\\b(?:cada|todos los|los)\\s+${WD_RE}((?:\\s*(?:,|y)\\s*${WD_RE})*)`)))) {
    const days = [...m[0].matchAll(new RegExp(WD_RE, 'g'))].map((x) => WD[x[1]]);
    repeat = { freq: 'weekly', interval: 1, weekdays: [...new Set(days)].sort() };
    understood.push('cada ' + m[0].replace(/^(cada|todos los|los)\s+/, ''));
  } else if ((m = take(new RegExp(`\\bde ${WD_RE} a ${WD_RE}\\b`)))) {
    const a = WD[m[1]], b = WD[m[2]];
    const days: number[] = [];
    for (let d = a; ; d = (d % 7) + 1) { days.push(d); if (d === b || days.length > 7) break; }
    repeat = { freq: 'weekly', interval: 1, weekdays: days.sort() };
    understood.push(m[0]);
  }
  if ((m = take(/\b(?:cada (\d+) semanas|semanas alternas|una semana si y otra no)\b/))) {
    repeat ??= { freq: 'weekly', interval: 1 };
    repeat.freq = 'weekly';
    repeat.interval = m[1] ? +m[1] : 2;
    understood.push(m[1] ? `cada ${m[1]} semanas` : 'semanas alternas');
  } else if ((m = take(/\b(?:cada semana|todas las semanas|semanalmente)\b/))) {
    repeat ??= { freq: 'weekly', interval: 1 };
    understood.push('cada semana');
  } else if ((m = take(/\b(?:cada (\d+) meses)\b/))) {
    repeat = { freq: 'monthly', interval: +m[1] };
    understood.push(`cada ${m[1]} meses`);
  } else if ((m = take(/\b(?:cada mes|todos los meses|mensualmente)\b/))) {
    repeat = { freq: 'monthly', interval: 1 };
    understood.push('cada mes');
  }
  if (repeat && (m = take(new RegExp(`\\bhasta (?:el )?(?:(\\d{1,2}) de ${MONTH_RE}(?: de (\\d{4}))?|(?:final(?:es)? de |fin de )?${MONTH_RE}(?: de (\\d{4}))?|(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{2,4}))?)\\b`)))) {
    if (m[1]) repeat.until = dayMonth(+m[1], MONTH[m[2]], m[3] ? +m[3] : undefined);
    else if (m[4]) {
      const y = m[5] ? +m[5] : Number(today.slice(0, 4));
      let end = endOfMonth(`${y}-${String(MONTH[m[4]]).padStart(2, '0')}-01`);
      if (!m[5] && end < today) end = endOfMonth(addMonths(end, 12));
      repeat.until = end;
    } else repeat.until = dayMonth(+m[6], +m[7], m[8] ? (+m[8] < 100 ? 2000 + +m[8] : +m[8]) : undefined);
    understood.push(`hasta el ${repeat.until}`);
  }
  if (repeat) draft.repeat = repeat;

  // ---------- Aviso ----------
  // «avísame 10 minutos antes», «con aviso media hora antes», «el día antes»;
  // va antes que las horas y la duración, que se llevarían «10 minutos»
  if ((m = take(/\b(?:(?:y |con )?(?:avisame|avisamelo|recuerdamelo|aviso|avisar)\s+)?(media hora|(?:un |una |\d+ ?)?(?:horas?|minutos?|mins?|dias?))\s+antes\b/))) {
    const raw = m[1];
    const n = /^media/.test(raw) ? 1 : Number(/\d+/.exec(raw)?.[0] ?? 1);
    draft.remind = /^media/.test(raw) ? 30 : /hora/.test(raw) ? n * 60 : /dia/.test(raw) ? n * 1440 : n;
  } else if ((m = take(/\b(?:(?:y |con )?(?:avisame|aviso) )?(?:el dia antes|la vispera)\b/))) draft.remind = 1440;
  if ((m = take(/\b(?:recuerdame|recordarme|recordatorio(?: de| para)?|avisame(?: de| para)?|avisamelo|recuerdamelo|con aviso)\b/))) draft.remind ??= 0;
  if (draft.remind !== undefined) understood.push(draft.remind === 0 ? 'con aviso' : `aviso ${draft.remind} min antes`);

  // ---------- Horas ----------
  if ((m = take(new RegExp(`\\b(?:de(?:sde)?(?: las?)?|entre las?)\\s+${HOUR}${DAYPART}\\s+(?:a|hasta|y)(?: las?)?\\s+${HOUR}${DAYPART}`)))) {
    const endT = hour(m[3], m[4]);
    const pmHint = !!endT && minutesOf(endT) >= 12 * 60 && !m[2];
    const startT = hour(m[1], m[2] ?? (m[4] && /tarde|noche|pm/.test(m[4]) ? m[4] : undefined), pmHint);
    if (startT && endT) {
      let mins = minutesOf(endT) - minutesOf(startT);
      if (mins <= 0) mins += 12 * 60;
      draft.start = startT;
      draft.minutes = mins;
      understood.push(`de ${startT} a ${endT}`);
    }
  } else if ((m = take(new RegExp(`\\b(?:a las?|sobre las?|hacia las?|para las?)\\s+${HOUR}${DAYPART}`)))) {
    const t = hour(m[1], m[2]);
    if (t) { draft.start = t; understood.push(`a las ${t}`); }
  } else if ((m = take(/\b(\d{1,2}[:.h]\d{2})\b/))) {
    const t = parseTime(m[1]);
    if (t) { draft.start = t; understood.push(`a las ${t}`); }
  } else if ((m = take(/\b(?:al )?mediodia\b/))) {
    draft.start = '12:00';
    understood.push('a mediodía');
  }

  // ---------- Duración ----------
  if (draft.minutes === undefined) {
    const dur = take(/\b(?:durante\s+)?(?<!tema )(media hora|(?:una |1 )?hora y media|(?:un |1 )?cuarto de hora|\d+ horas? y (?:media|cuarto)|\d+(?:[.,]\d+)?\s*(?:h|horas?)(?:\s*(?:y\s*)?\d{1,2}\s*(?:m|min|minutos?))?|\d+\s*(?:m|min|mins|minutos?))\b/);
    if (dur) {
      const n = parseDuration(dur[1]);
      if (n) { draft.minutes = n; understood.push(`durante ${n} min`); }
    }
  }

  // ---------- Fecha ----------
  let date = '';
  if ((m = take(/\bpasado manana\b/))) date = addDays(today, 2);
  else if ((m = take(/\b(?:hoy|esta tarde|esta noche|esta manana)\b/))) date = today;
  else if ((m = take(/\b(?<!la )manana\b/))) date = addDays(today, 1);
  else if ((m = take(/\b(?:dentro de|en) (\d+) (dias?|semanas?|mes(?:es)?)\b/))) {
    const n = +m[1];
    date = m[2].startsWith('dia') ? addDays(today, n) : m[2].startsWith('semana') ? addDays(today, n * 7) : addMonths(today, n);
  } else if ((m = take(/\b(?:la semana que viene|la proxima semana|la semana proxima)\b/))) date = nextWeekday(1);
  else if ((m = take(new RegExp(`\\b(?:el |este |el proximo |el que viene )?${WD_RE}(?: que viene| proximo)?(?! a )\\b`)))) {
    if (!repeat) date = nextWeekday(WD[m[1]], today, /\beste\b/.test(m[0]));
  } else if ((m = take(new RegExp(`\\b(?:el )?(?:dia )?(\\d{1,2}) de ${MONTH_RE}(?: de (\\d{4}))?\\b`)))) date = dayMonth(+m[1], MONTH[m[2]], m[3] ? +m[3] : undefined);
  else if ((m = take(/\b(?:el )?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/))) date = dayMonth(+m[1], +m[2], m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : undefined);
  else if ((m = take(/\bel dia (\d{1,2})\b/))) {
    const day = +m[1];
    date = `${today.slice(0, 8)}${String(day).padStart(2, '0')}`;
    if (date < today) date = addMonths(date, 1);
  }
  if (date) understood.push(date === today ? 'hoy' : daysBetween(today, date) === 1 ? 'mañana' : `el ${date}`);
  if (!date && repeat?.weekdays?.length) {
    // La serie empieza el primer día que toca desde hoy
    date = repeat.weekdays.map((wd) => nextWeekday(wd, today, true)).sort()[0];
  }
  draft.date = date || fallbackDate || today;

  // ---------- Tipo y prioridad ----------
  const byPriority = (p: number) => [...types].sort((a, b) => Math.abs(a.priority - p) - Math.abs(b.priority - p))[0];
  if ((m = take(/(?:^|\s)!([1-5])\b/)) || (m = take(/\bprioridad (\d)\b/))) {
    const t = byPriority(+m[1]);
    if (t) { draft.typeId = t.id; understood.push(t.name); }
  } else if ((m = take(/\b(?:prioridad (maxima|alta|media|baja)|(urgente))\b/))) {
    const p = m[2] ? 1 : ({ maxima: 1, alta: 2, media: 3, baja: 4 } as Record<string, number>)[m[1]];
    const t = byPriority(p);
    if (t) { draft.typeId = t.id; understood.push(t.name); }
  }
  const kindWords: [RegExp, string][] = [
    [/\b(?:simulacro|examen|test)\b/, 'mock'], [/\b(?:repaso|repasar)\b/, 'review'],
    [/\b(?:estudio|estudiar)\b/, 'study'], [/\b(?:clase|trabajo|trabajar)\b/, 'work'],
  ];
  if (!draft.typeId) {
    // Primero los nombres de los tipos propios, luego las palabras habituales
    for (const t of types) {
      const name = fold(t.name).split(/[\s/]+/)[0];
      if (name.length > 3 && new RegExp(`\\b${name}\\b`).test(work)) { draft.typeId = t.id; break; }
    }
    if (!draft.typeId) for (const [re, id] of kindWords) if (re.test(work) && types.some((t) => t.id === id)) { draft.typeId = id; break; }
    if (draft.typeId) understood.push(types.find((t) => t.id === draft.typeId)!.name);
  }

  // ---------- Tema ----------
  const topic = /\btema (\d{1,3})\b/.exec(work);
  if (topic) draft.topicNumber = +topic[1];

  // ---------- Título: lo que queda ----------
  let title = '';
  for (let i = 0; i < original.length; i++) title += work[i] === ' ' && original[i] !== ' ' ? ' ' : original[i];
  title = title.replace(/\s+/g, ' ')
    .replace(/^\s*(?:ap[uú]ntame|ap[uú]nta|an[oó]tame|an[oó]ta|p[oó]nme|pon|crea|a[nñ]ade)\s+/i, '') // «apunta fisio…»
    .replace(/^(?:\s*(?:el|la|los|las|de|a|y|en|para|que|con|durante)\b)+/i, '')
    .replace(/(?:\b(?:el|la|los|las|de|a|y|en|para|que|con|durante|desde|hasta)\s*)+$/i, '')
    .replace(/\s+([,.;])/g, '$1').replace(/^[,.;\s]+|[,.;\s]+$/g, '').trim();
  draft.title = title ? title[0].toUpperCase() + title.slice(1) : '';
  return draft;
}

/** Fecha de un texto suelto como «15 marzo», «semana 12», «+3 semanas», «mañana» (para «Ir a»). */
export function parseGoTo(text: string, today: string): string | null {
  const s = fold(wordsToDigits(text.trim()));
  let m: RegExpExecArray | null;
  if (!s) return null;
  if ((m = /^\+?(-?\d+)\s*(d|dias?|s|semanas?|m|mes(?:es)?)$/.exec(s))) {
    const n = +m[1];
    return m[2].startsWith('d') ? addDays(today, n) : m[2].startsWith('s') ? addDays(today, n * 7) : addMonths(today, n);
  }
  if ((m = /^(?:semana|sem\.?)\s*(\d{1,2})(?:\s+de\s+(\d{4}))?$/.exec(s))) {
    const y = m[2] ? +m[2] : Number(today.slice(0, 4));
    const jan4 = iso(new Date(y, 0, 4, 12));
    return addDays(addDays(jan4, 1 - weekday(jan4)), (+m[1] - 1) * 7);
  }
  if ((m = new RegExp(`^${MONTH_RE}(?: de)?(?: (\\d{4}))?$`).exec(s))) {
    const y = m[2] ? +m[2] : Number(today.slice(0, 4));
    return `${y}-${String(MONTH[m[1]]).padStart(2, '0')}-01`;
  }
  if ((m = new RegExp(`^(\\d{1,2})(?: de)? ${MONTH_RE}(?:(?: de)? (\\d{4}))?$`).exec(s))) {
    const y = m[3] ? +m[3] : Number(today.slice(0, 4));
    return iso(new Date(y, MONTH[m[2]] - 1, +m[1], 12));
  }
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return s;
  if ((m = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(s))) {
    const y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : Number(today.slice(0, 4));
    return iso(new Date(y, +m[2] - 1, +m[1], 12));
  }
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  const d = parse(text, today, []);
  return d.understood.length ? d.date : null;
}

