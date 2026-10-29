// Cálculos de Gastos sobre los movimientos de un mes: totales por día y por
// categoría, gasto acumulado y cuánto del mes ha pasado. Las vistas solo pintan.
import { MONTHS_SHORT, addDays, addMonths, daysInMonth, endOfMonth, shortDate, startOfWeek } from '../agenda/dates';
import type { Movement, Settings } from './model';
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

export type Period = 'week' | 'month' | 'year';

export interface PeriodPoint {
  key: string;
  /** Etiqueta corta del eje («6 oct», «oct», «2026»). */
  label: string;
  /** Nombre completo («semana del 6 de octubre», «octubre de 2026», «2026»). */
  title: string;
  from: string;
  to: string;
  income: number;
  expense: number;
  /** Saldo al cerrar el periodo (o hoy, si no ha cerrado); null antes del saldo inicial o en el futuro. */
  balance: number | null;
}

const PERIODS = { week: 12, month: 12, year: 8 };

/**
 * Ingresos, gastos y saldo de los últimos periodos, terminando en el que
 * contiene «end». El saldo sigue la misma regla que el backend: saldo inicial
 * más los movimientos desde openingDate hasta hoy.
 */
export function periodSeries(all: Movement[], period: Period, end: string, today: string, settings: Settings): PeriodPoint[] {
  const ranges: [string, string, string, string, string][] = [];
  if (period === 'week') {
    const last = startOfWeek(end);
    for (let i = PERIODS.week - 1; i >= 0; i--) {
      const from = addDays(last, -7 * i), to = addDays(from, 6);
      ranges.push([from, from, to, shortDate(from), `semana del ${Number(from.slice(8))} de ${monthName(from.slice(0, 7))}${from.slice(0, 4) !== today.slice(0, 4) ? ` de ${from.slice(0, 4)}` : ''}`]);
    }
  } else if (period === 'month') {
    for (let i = PERIODS.month - 1; i >= 0; i--) {
      const m = shiftMonth(end.slice(0, 7), -i);
      const [from, to] = monthBounds(m);
      ranges.push([m, from, to, MONTHS_SHORT[Number(m.slice(5, 7)) - 1], `${monthName(m)} de ${m.slice(0, 4)}`]);
    }
  } else {
    const endYear = Number(end.slice(0, 4));
    const first = all.reduce((y, m) => Math.min(y, Number(m.date.slice(0, 4))), endYear);
    for (let y = Math.max(first, endYear - PERIODS.year + 1); y <= endYear; y++) ranges.push([String(y), `${y}-01-01`, `${y}-12-31`, String(y), String(y)]);
  }

  const opening = settings.openingDate || '';
  return ranges.map(([key, from, to, label, title]) => {
    let income = 0, expense = 0, net = 0;
    const until = to < today ? to : today;
    for (const m of all) {
      if (m.date >= from && m.date <= to) {
        if (m.kind === 'income') income += m.amountCents; else expense += m.amountCents;
      }
      if (m.date >= opening && m.date <= until) net += m.kind === 'income' ? m.amountCents : -m.amountCents;
    }
    const balance = from > today || (opening && to < opening) ? null : settings.openingCents + net;
    return { key, label, title, from, to, income, expense, balance };
  });
}

/** Variación en % (null si no hay base con la que comparar). */
export function pctChange(now: number, before: number): number | null {
  return before ? Math.round(((now - before) / Math.abs(before)) * 100) : null;
}
