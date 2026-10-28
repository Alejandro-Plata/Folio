// Cálculos de Gastos sobre los movimientos de un mes: totales por día y por
// categoría, gasto acumulado y cuánto del mes ha pasado. Las vistas solo pintan.
import { addMonths, daysInMonth, endOfMonth } from '../agenda/dates';
import type { Movement } from './model';
import { monthName } from './model';

/** Primer y último día de un «AAAA-MM». */
export function monthBounds(month: string): [string, string] {
  const from = `${month}-01`;
  return [from, endOfMonth(from)];
}

export function shiftMonth(month: string, n: number): string {
  return addMonths(`${month}-01`, n).slice(0, 7);
}

/** «Octubre 2026», o solo «Octubre» si es el año de hoy. */
export function monthTitle(month: string, today: string): string {
  const name = monthName(month);
  const cap = name[0].toUpperCase() + name.slice(1);
  return month.slice(0, 4) === today.slice(0, 4) ? cap : `${cap} ${month.slice(0, 4)}`;
}

export const sum = (list: Movement[]) => list.reduce((n, m) => n + m.amountCents, 0);
export const expenses = (list: Movement[]) => list.filter((m) => m.kind === 'expense');
export const incomes = (list: Movement[]) => list.filter((m) => m.kind === 'income');

/** Días del mes ya transcurridos (hoy incluido): todos si es pasado, 0 si es futuro. */
export function elapsedDays(month: string, today: string): number {
  const days = daysInMonth(`${month}-01`);
  const cur = today.slice(0, 7);
  if (month < cur) return days;
  if (month > cur) return 0;
  return Number(today.slice(8, 10));
}

/** Importe de cada día del mes (índice 0 = día 1). */
export function dailyTotals(list: Movement[], month: string): number[] {
  const out = new Array<number>(daysInMonth(`${month}-01`)).fill(0);
  for (const m of list) if (m.date.startsWith(month)) out[Number(m.date.slice(8, 10)) - 1] += m.amountCents;
  return out;
}

export function cumulative(daily: number[]): number[] {
  let acc = 0;
  return daily.map((v) => (acc += v));
}

/** Gasto por categoría, de mayor a menor. */
export function categoryTotals(list: Movement[]): Map<string, { cents: number; count: number }> {
  const out = new Map<string, { cents: number; count: number }>();
  for (const m of expenses(list)) {
    const id = m.categoryId ?? '';
    const t = out.get(id) ?? { cents: 0, count: 0 };
    t.cents += m.amountCents;
    t.count++;
    out.set(id, t);
  }
  return new Map([...out].sort((a, b) => b[1].cents - a[1].cents));
}

/** Variación en % (null si no hay base con la que comparar). */
export function pctChange(now: number, before: number): number | null {
  return before ? Math.round(((now - before) / Math.abs(before)) * 100) : null;
}
