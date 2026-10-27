// Fechas como texto «AAAA-MM-DD» (días locales) y utilidades en español.

export const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
export const WEEKDAYS_SHORT = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
export const WEEKDAYS_LETTER = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Día local a mediodía (sumar días nunca cruza mal un cambio de hora). */
export function toDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function iso(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export function todayISO(): string { return iso(new Date()); }

export function addDays(date: string, n: number): string {
  const d = toDate(date);
  d.setDate(d.getDate() + n);
  return iso(d);
}

export function addMonths(date: string, n: number): string {
  const d = toDate(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return iso(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}

/** 1 = lunes … 7 = domingo. */
export function weekday(date: string): number { return ((toDate(date).getDay() + 6) % 7) + 1; }

export function startOfWeek(date: string): string { return addDays(date, 1 - weekday(date)); }
export function startOfMonth(date: string): string { return date.slice(0, 8) + '01'; }
export function endOfMonth(date: string): string { return addDays(addMonths(startOfMonth(date), 1), -1); }
export function daysInMonth(date: string): number { return Number(endOfMonth(date).slice(8)); }

/** Semana ISO 8601. */
export function isoWeek(date: string): number {
  const d = toDate(date);
  d.setDate(d.getDate() + 4 - (((d.getDay() + 6) % 7) + 1));
  const y = new Date(d.getFullYear(), 0, 1, 12);
  return Math.ceil(((d.getTime() - y.getTime()) / 86400000 + 1) / 7);
}

/** Lunes de la semana ISO n del año. */
export function mondayOfWeek(year: number, n: number): string {
  const jan4 = iso(new Date(year, 0, 4, 12));
  return addDays(startOfWeek(jan4), (n - 1) * 7);
}

export function range(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** «martes, 27 de octubre de 2026» */
export function longDate(date: string, withYear = true): string {
  const d = toDate(date);
  return `${WEEKDAYS[weekday(date) - 1]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}${withYear ? ` de ${d.getFullYear()}` : ''}`;
}

/** «27 oct» */
export function shortDate(date: string): string {
  const d = toDate(date);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/** Fecha relativa para humanos: «hoy», «mañana», «el jueves», «12 nov». */
export function relativeDate(date: string, today = todayISO()): string {
  const n = daysBetween(today, date);
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  if (n === -1) return 'ayer';
  if (n === 2) return 'pasado mañana';
  if (n > 2 && n < 7) return `el ${WEEKDAYS[weekday(date) - 1]}`;
  return shortDate(date) + (date.slice(0, 4) !== today.slice(0, 4) ? ` ${date.slice(0, 4)}` : '');
}

/** Minutos desde medianoche de «HH:MM» (-1 si no es válida). */
export function minutesOf(hhmm: string | undefined): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  if (!m) return -1;
  const h = Number(m[1]), mm = Number(m[2]);
  return h <= 24 && mm < 60 ? h * 60 + mm : -1;
}

export function hhmm(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** «1 h 30 min», «45 min», «2 h». */
export function duration(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** «9:30» (sin cero inicial, como se lee en español). */
export function timeLabel(t: string | undefined): string {
  const m = minutesOf(t);
  return m < 0 ? '' : `${Math.floor(m / 60)}:${pad(m % 60)}`;
}
