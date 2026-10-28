// Gráficas de Gastos: barras horizontales por categoría, evolución mensual
// (SVG, patrón de agenda/stats.ts) y barra de progreso del presupuesto.
import { h } from '../ui/dom';
import { MONTHS_SHORT } from '../agenda/dates';
import type { BudgetLine, CategoryTotal, Category, MonthPoint } from './model';
import { fmtMoney, monthName } from './model';

const ns = 'http://www.w3.org/2000/svg';
function el(tag: string, attrs: Record<string, string | number>, text?: string) {
  const e = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text) e.textContent = text;
  return e;
}

/** «1,2 k€» para el eje Y; por debajo de mil, el importe entero. */
function abbrev(cents: number, currency: string): string {
  const sym = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency;
  return Math.abs(cents) >= 100000 ? `${(cents / 100000).toFixed(1).replace('.', ',')} k${sym}` : `${Math.round(cents / 100)}${sym}`;
}

/** Barras horizontales por categoría, de mayor a menor gasto. */
export function barsByCategory(totals: CategoryTotal[], categories: Category[], currency: string): HTMLElement {
  if (!totals.length) return h('p', { class: 'muted small' }, 'No hay gastos en este periodo.');
  const rows = totals.map((t) => {
    const cat = categories.find((c) => c.id === t.categoryId);
    const pct = Math.round(t.share * 100);
    return h('div', { class: 'gx-bar-row', role: 'listitem' },
      h('span', { class: 'gx-bar-label' },
        h('span', { class: 'gx-bar-dot', style: { '--c': cat?.color ?? 'var(--text-faint)' } }),
        h('span', {}, cat?.name ?? 'Sin categoría')),
      h('span', { class: 'gx-bar-track' }, h('span', { class: 'gx-bar-fill', style: { width: `${pct}%`, '--c': cat?.color ?? 'var(--text-faint)' } })),
      h('span', { class: 'gx-bar-amt' }, `${fmtMoney(t.cents, currency)} · ${pct} %`));
  });
  return h('div', { class: 'gx-bars', role: 'list', 'aria-label': 'Gastos por categoría' }, ...rows);
}

/** Columnas agrupadas de gasto e ingreso por mes, con el eje Y abreviado. */
export function monthlyTrend(points: MonthPoint[], currency: string): HTMLElement {
  if (!points.length) return h('p', { class: 'muted small' }, 'Sin datos suficientes.');
  const W = 640, H = 200, pad = { l: 44, r: 8, t: 12, b: 24 };
  const n = points.length;
  const top = Math.max(1, ...points.map((p) => Math.max(p.expense, p.income)));
  const groupW = (W - pad.l - pad.r) / n;
  const barW = Math.max(3, groupW / 2 - 4);
  const x = (i: number) => pad.l + i * groupW;
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ag-chart', role: 'img', 'aria-label': 'Evolución mensual de ingresos y gastos' });
  for (let i = 0; i <= 4; i++) {
    const v = (top * i) / 4;
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'ag-grid' }));
    svg.append(el('text', { x: pad.l - 6, y: y(v) + 4, class: 'ag-axis', 'text-anchor': 'end' }, abbrev(v, currency)));
  }
  points.forEach((p, i) => {
    const gx = x(i);
    const expH = Math.max(p.expense ? 2 : 0, y(0) - y(p.expense));
    const incH = Math.max(p.income ? 2 : 0, y(0) - y(p.income));
    const expRect = el('rect', { x: gx + groupW / 2 - barW - 2, y: y(p.expense), width: barW, height: expH, rx: 2, class: 'gx-trend-exp' });
    expRect.append(el('title', {}, `${monthFull(p.month)}: gastos ${fmtMoney(p.expense, currency)}`));
    const incRect = el('rect', { x: gx + groupW / 2 + 2, y: y(p.income), width: barW, height: incH, rx: 2, class: 'gx-trend-inc' });
    incRect.append(el('title', {}, `${monthFull(p.month)}: ingresos ${fmtMoney(p.income, currency)}`));
    svg.append(expRect, incRect);
    svg.append(el('text', { x: gx + groupW / 2, y: H - 6, class: 'ag-axis', 'text-anchor': 'middle' }, MONTHS_SHORT[Number(p.month.slice(5, 7)) - 1]));
  });
  const legend = h('div', { class: 'ag-cov-legend' },
    h('span', { class: 'ag-cov-key' }, h('span', { class: 'gx-trend-sw gx-trend-sw-exp' }), 'Gastos'),
    h('span', { class: 'ag-cov-key' }, h('span', { class: 'gx-trend-sw gx-trend-sw-inc' }), 'Ingresos'));
  const table = h('table', { class: 'sr-only' }, h('tr', {}, h('th', {}, 'Mes'), h('th', {}, 'Gastos'), h('th', {}, 'Ingresos')),
    ...points.map((p) => h('tr', {}, h('td', {}, monthFull(p.month)), h('td', {}, fmtMoney(p.expense, currency)), h('td', {}, fmtMoney(p.income, currency)))));
  return h('div', {}, h('div', { class: 'ag-chart-wrap' }, svg as unknown as HTMLElement, table), legend);
}

function monthFull(month: string): string {
  return `${monthName(month)} de ${month.slice(0, 4)}`;
}

/** Barra de progreso del presupuesto: verde, ámbar o roja según el gasto. */
export function budgetMeter(line: BudgetLine, label: string, color: string | undefined, currency: string): HTMLElement {
  const pct = Math.round(line.ratio * 100);
  const cls = line.ratio >= 1 ? 'is-over' : line.ratio >= 0.8 ? 'is-warn' : 'is-ok';
  const remaining = line.limitCents - line.spentCents;
  const sub = remaining >= 0
    ? `${fmtMoney(line.spentCents, currency)} de ${fmtMoney(line.limitCents, currency)} · quedan ${fmtMoney(remaining, currency)}`
    : `te has pasado ${fmtMoney(-remaining, currency)}`;
  return h('div', { class: 'gx-budget-row' },
    h('div', { class: 'gx-budget-head' },
      color ? h('span', { class: 'gx-bar-dot', style: { '--c': color } }) : null,
      h('span', { class: 'gx-budget-name' }, label),
      h('span', { class: `gx-budget-pct ${cls}` }, `${pct} %`)),
    h('div', { class: `gx-meter ${cls}` }, h('span', { style: { width: `${Math.min(100, Math.max(0, pct))}%` } })),
    h('p', { class: 'muted small gx-budget-sub' }, sub));
}
