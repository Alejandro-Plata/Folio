// Pestaña Resumen de Gastos: cifras del periodo frente al anterior, gasto
// por categoría, evolución mensual y los mayores gastos.
import { api } from '../api';
import { h } from '../ui/dom';
import { addDays, addMonths, daysBetween, endOfMonth, startOfMonth } from '../agenda/dates';
import type { Filter, Summary } from './model';
import { fmtMoney } from './model';
import { barsByCategory, monthlyTrend } from './charts';
import { row } from './list';
import type { GastosView } from './view';

export async function renderSummary(view: GastosView, root: HTMLElement, stillValid: () => boolean = () => true) {
  const s = view.summary;
  if (!s) return;
  const cur = view.state.settings.currency;
  const prev = await previousSummary(view);
  if (!stillValid()) return;

  const savings = s.incomeCents - s.expenseCents;
  const prevSavings = prev ? prev.incomeCents - prev.expenseCents : null;
  const top = s.top ?? [];

  root.replaceChildren(h('div', { class: 'gx-summary' },
    h('div', { class: 'gx-stat-row' },
      statCard('Gastos', s.expenseCents, prev?.expenseCents ?? null, false, cur),
      statCard('Ingresos', s.incomeCents, prev?.incomeCents ?? null, true, cur),
      statCard('Ahorro', savings, prevSavings, true, cur)),
    h('section', { class: 'ag-chart-box' }, h('h3', {}, 'Por categoría'), barsByCategory(s.byCategory ?? [], view.state.categories, cur)),
    h('section', { class: 'ag-chart-box' }, h('h3', {}, 'Evolución mensual'), monthlyTrend(s.trend ?? [], cur)),
    top.length ? h('section', { class: 'ag-chart-box' }, h('h3', {}, 'Mayores gastos'), h('div', { class: 'gx-list', role: 'list' }, ...top.map((m) => row(view, m)))) : null));
}

function statCard(label: string, value: number, prevValue: number | null, positiveIsGood: boolean, currency: string): HTMLElement {
  const delta = prevValue ? ((value - prevValue) / Math.abs(prevValue)) * 100 : null;
  const good = delta == null ? null : positiveIsGood ? delta >= 0 : delta <= 0;
  return h('div', { class: 'gx-stat' },
    h('span', { class: 'gx-stat-label' }, label),
    h('span', { class: 'gx-stat-value' }, fmtMoney(value, currency)),
    delta != null
      ? h('span', { class: `gx-stat-delta ${good ? 'is-good' : 'is-bad'}` }, `${delta >= 0 ? '+' : ''}${Math.round(delta)} % frente al periodo anterior`)
      : h('span', { class: 'gx-stat-delta muted' }, 'Sin periodo anterior'));
}

/** Mismo filtro, desplazado al periodo inmediatamente anterior; null si el periodo es «General». */
async function previousSummary(view: GastosView): Promise<Summary | null> {
  const from = view.rangeFrom, to = view.rangeTo;
  if (!from || !to) return null;
  let pf: string, pt: string;
  if (view.period === 'month') { pf = startOfMonth(addMonths(from, -1)); pt = endOfMonth(pf); }
  else if (view.period === 'week') { pf = addDays(from, -7); pt = addDays(to, -7); }
  else { const len = daysBetween(from, to) + 1; pf = addDays(from, -len); pt = addDays(from, -1); }
  const filter: Filter = { ...view.filter, from: pf, to: pt };
  return api.GastosSummary(filter);
}
