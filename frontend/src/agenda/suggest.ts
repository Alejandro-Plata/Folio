// Sugerencias a partir de las últimas acciones: horas de inicio, duraciones y
// tiempo de estudio por día que la persona suele usar. Se calculan sobre las
// últimas 4 semanas, con más peso para lo reciente y para el mismo día de la
// semana. Nunca se aplican solas: se muestran como chips.
import type { Session, Task } from './model';
import { daysBetween, minutesOf, weekday } from './dates';

/** Valores recomendados cuando aún no hay historial. */
export const DEFAULT_STARTS = ['16:00', '17:00', '09:00'];
export const DEFAULT_DURATIONS = [50, 25, 90];

function rank<T extends string | number>(items: { value: T; weight: number }[], limit: number): T[] {
  const score = new Map<T, number>();
  for (const it of items) score.set(it.value, (score.get(it.value) ?? 0) + it.weight);
  return [...score.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limit).map(([v]) => v);
}

function weightFor(date: string, today: string, targetWeekday?: number): number {
  const age = daysBetween(date, today);
  if (age < 0 || age > 28) return 0;
  let w = 1 - age / 35;
  if (targetWeekday && weekday(date) === targetWeekday) w *= 2;
  return w;
}

/** Horas de inicio frecuentes (para un tipo y día de la semana, si se indican). */
export function suggestStarts(tasks: Task[], today: string, opts: { typeId?: string; weekday?: number; exclude?: string } = {}): string[] {
  const items = tasks
    .filter((t) => t.start && !t.auto && (!opts.typeId || t.typeId === opts.typeId))
    .map((t) => ({ value: t.start!, weight: weightFor(t.date, today, opts.weekday) }))
    .filter((x) => x.weight > 0);
  let out = rank(items, 4).filter((v) => v !== opts.exclude);
  if (out.length < 3) out = [...out, ...DEFAULT_STARTS.filter((v) => !out.includes(v) && v !== opts.exclude)];
  return out.slice(0, 3);
}

/** Duraciones frecuentes en minutos. */
export function suggestDurations(tasks: Task[], sessions: Session[], today: string, opts: { typeId?: string; exclude?: number } = {}): number[] {
  const items = [
    ...tasks.filter((t) => t.minutes && !t.auto && (!opts.typeId || t.typeId === opts.typeId)).map((t) => ({ value: t.minutes!, weight: weightFor(t.date, today) })),
    ...sessions.filter((s) => s.minutes && (!opts.typeId || s.typeId === opts.typeId)).map((s) => ({ value: Math.round(s.minutes / 5) * 5, weight: weightFor(s.date, today) * 1.5 })),
  ].filter((x) => x.weight > 0 && x.value > 0);
  let out = rank(items, 4).filter((v) => v !== opts.exclude);
  if (out.length < 3) out = [...out, ...DEFAULT_DURATIONS.filter((v) => !out.includes(v) && v !== opts.exclude)];
  return out.slice(0, 3);
}

/** Minutos estudiados de media por día de la semana (solo días con estudio). */
export function studiedByWeekday(sessions: Session[], today: string): Record<number, number> {
  const perDay = new Map<string, number>();
  for (const s of sessions) if (daysBetween(s.date, today) <= 56) perDay.set(s.date, (perDay.get(s.date) ?? 0) + s.minutes);
  const sum: Record<number, number> = {}, count: Record<number, number> = {};
  for (const [d, m] of perDay) { const wd = weekday(d); sum[wd] = (sum[wd] ?? 0) + m; count[wd] = (count[wd] ?? 0) + 1; }
  const out: Record<number, number> = {};
  for (const wd of Object.keys(sum).map(Number)) out[wd] = Math.round(sum[wd] / count[wd] / 5) * 5;
  return out;
}

/** Sugerencias de capacidad para un día de la semana: lo que suele estudiar y valores redondos. */
export function suggestCapacity(sessions: Session[], today: string, wd: number, current: number): number[] {
  const usual = studiedByWeekday(sessions, today)[wd];
  const out: number[] = [];
  if (usual && usual !== current) out.push(usual);
  for (const v of [120, 180, 240, 90, 60]) if (!out.includes(v) && v !== current && out.length < 3) out.push(v);
  return out;
}

/** Franjas frecuentes: la primera y la última hora con tareas de estudio ese día de la semana. */
export function suggestWindowStarts(tasks: Task[], today: string, wd: number): string[] {
  const starts = tasks.filter((t) => t.start && weekday(t.date) === wd).map((t) => ({ value: t.start!, weight: weightFor(t.date, today, wd) })).filter((x) => x.weight > 0);
  const out = rank(starts, 3).sort((a, b) => minutesOf(a) - minutesOf(b));
  return out.length ? out : DEFAULT_STARTS;
}
