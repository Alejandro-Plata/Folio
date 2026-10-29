// Pestaña Resumen: el dinero que hay en la cuenta con los ingresos y gastos del
// mes, lo gastado y su ritmo frente al mes anterior, la evolución semanal,
// mensual y anual, el reparto por categoría, el calendario y los movimientos.
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import type { Movement } from './model';
import { fmtMoney, monthName } from './model';
import { daysInMonth, startOfWeek } from '../agenda/dates';
import { calendarHeat, evolutionChart, paceChart } from './charts';
import type { Period } from './calc';
import { categoryTotals, cumulative, dailyTotals, elapsedDays, expenses, incomes, monthBounds, pctChange, periodSeries, shiftMonth, sum } from './calc';
import { balanceDialog } from './settings';
import { row } from './list';
import type { GastosView } from './view';

let topMode: 'recent' | 'largest' = 'recent';
const PERIOD_KEY = 'folio-gastos-period';
let period: Period = (() => {
  try {
    const p = localStorage.getItem(PERIOD_KEY);
    return p === 'week' || p === 'year' ? p : 'month';
  } catch { return 'month'; }
})();
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function renderSummary(view: GastosView, root: HTMLElement) {
  const st = view.state;
  const cur = view.currency;
  const month = view.month;
  const prevMonth = shiftMonth(month, -1);
  const exp = expenses(view.monthMovs), inc = incomes(view.monthMovs);
  const prevExp = expenses(view.prevMovs), prevInc = incomes(view.prevMovs);

  if (!view.monthMovs.length && !view.prevMovs.length && !(view.summary?.budget ?? []).length) {
    root.replaceChildren(h('div', { class: 'gx-onboard' },
      h('span', { class: 'gx-onboard-ic', html: icon('wallet', 28) }),
      h('h3', {}, view.isCurrentMonth ? 'Empieza a llevar tus cuentas' : `No hay movimientos en ${monthName(month)}`),
      h('p', { class: 'muted' }, 'Apunta un gasto en segundos: el importe, la categoría y listo. Folio te dirá a qué ritmo gastas y cuánto te queda de cada presupuesto.'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => view.newMovement() }, h('span', { html: icon('plus', 15) }), 'Añadir el primer gasto')));
    return;
  }

  const spent = sum(exp), income = sum(inc);
  const days = daysInMonth(`${month}-01`);
  const elapsed = elapsedDays(month, st.today);
  const curCum = cumulative(dailyTotals(exp, month)).slice(0, elapsed);
  const prevCum = cumulative(dailyTotals(prevExp, prevMonth));
  const prevAtDay = prevCum.length ? prevCum[Math.min(prevCum.length, Math.max(1, elapsed)) - 1] : 0;

  root.replaceChildren(h('div', { class: 'gx-dash' },
    account(view, income, spent, sum(prevInc), sum(prevExp), prevMonth),
    hero(view, spent, prevAtDay, sum(prevExp), elapsed, days, curCum, prevCum),
    evolution(view),
    h('div', { class: 'gx-grid' },
      card('Por categoría', categories(view, exp, prevExp), spent ? h('span', { class: 'muted small' }, `${exp.length} ${exp.length === 1 ? 'gasto' : 'gastos'}`) : null),
      card('Día a día', h('div', {},
        calendarHeat(month, dailyTotals(exp, month), dailyTotals(inc, month), st.today, cur, (d) => view.pickDay(d)),
        h('p', { class: 'gx-card-foot muted small' }, elapsed && spent ? `Media de ${fmtMoney(Math.round(spent / elapsed), cur)} al día · pulsa un día para ver sus movimientos` : 'Pulsa un día para ver sus movimientos')), null),
      latest(view, 'gx-card-wide')),
  ));
}

/** El dinero que hay en la cuenta hoy y, junto a él, lo que ha entrado y salido en el mes. */
function account(view: GastosView, income: number, spent: number, prevInc: number, prevExp: number, prevMonth: string): HTMLElement {
  const cur = view.currency;
  const s = view.state.settings;
  const balance = view.summary?.balanceCents ?? 0;
  const configured = !!(s.openingCents || s.openingDate);
  const when = view.isCurrentMonth ? 'este mes' : `en ${monthName(view.month)}`;
  const saved = income - spent;
  return h('section', { class: 'gx-account' },
    h('div', { class: 'gx-account-main' },
      h('span', { class: 'gx-hero-label' }, 'En tu cuenta ahora'),
      h('span', { class: `gx-account-amount ${balance < 0 ? 'is-neg' : ''}` }, fmtMoney(balance, cur)),
      h('span', { class: 'gx-kpi-sub' }, configured ? 'Saldo inicial más todos los movimientos hasta hoy' : 'Solo suma tus movimientos: indica tu saldo real para que cuadre con el banco'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost gx-account-adjust', onclick: () => void balanceDialog(view) },
        h('span', { html: icon('pencil', 14) }), configured ? 'Ajustar saldo' : 'Indicar cuánto tengo')),
    h('div', { class: 'gx-account-figs' },
      kpi(`Ingresos ${when}`, fmtMoney(income, cur), delta(income, prevInc, true, prevMonth), false, 'is-inc'),
      kpi(`Gastos ${when}`, fmtMoney(spent, cur), delta(spent, prevExp, false, prevMonth), false, 'is-exp'),
      kpi('Ahorro', fmtMoney(saved, cur), income > 0
        ? h('span', { class: `gx-kpi-sub ${saved >= 0 ? 'is-good' : 'is-bad'}` }, saved >= 0 ? `Guardas el ${Math.round((saved / income) * 100)} % de lo que ingresas` : 'Gastas más de lo que ingresas')
        : h('span', { class: 'gx-kpi-sub' }, spent ? 'Sin ingresos este mes' : 'Sin movimientos'), saved < 0)));
}

/** Evolución por semanas, meses o años: saldo, ingresos y gastos. */
function evolution(view: GastosView): HTMLElement {
  const cur = view.currency;
  const today = view.state.today;
  const end = view.isCurrentMonth ? today : monthBounds(view.month)[1];
  const box = h('div', { class: 'gx-evo-body' });
  const seg = h('div', { class: 'seg seg-sm', role: 'tablist', 'aria-label': 'Periodo de la evolución' });
  const names = { week: ['Semana', 'semana', 'Esta semana'], month: ['Mes', 'mes', 'Este mes'], year: ['Año', 'año', 'Este año'] } as const;
  const draw = () => {
    seg.replaceChildren(...(['week', 'month', 'year'] as const).map((p) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(period === p), class: `seg-btn ${period === p ? 'on' : ''}`,
      onclick: () => { period = p; try { localStorage.setItem(PERIOD_KEY, p); } catch { /* */ } draw(); },
    }, names[p][0])));
    const points = periodSeries(view.allMovs, period, end, today, view.state.settings);
    const key = period === 'week' ? startOfWeek(end) : period === 'month' ? view.month : end.slice(0, 4);
    const now = points.find((p) => p.key === key) ?? points[points.length - 1];
    const isNow = now.from <= today && today <= now.to;
    // La media, solo con periodos ya cerrados y desde el primer movimiento
    const first = view.allMovs.reduce((d, m) => (m.date < d ? m.date : d), today);
    const closed = points.filter((p) => p.to < today && p.to >= first);
    const avg = closed.length ? Math.round(closed.reduce((n, p) => n + p.expense, 0) / closed.length) : null;
    box.replaceChildren(
      evolutionChart(points, cur, key, view.mobile),
      h('div', { class: 'gx-evo-stats' },
        h('span', { class: 'gx-evo-stat-title' }, isNow ? names[period][2] : cap(now.title)),
        h('span', {}, 'Ingresos ', h('strong', { class: 'is-good' }, fmtMoney(now.income, cur))),
        h('span', {}, 'Gastos ', h('strong', {}, fmtMoney(now.expense, cur))),
        h('span', {}, 'Ahorro ', h('strong', { class: now.income - now.expense < 0 ? 'is-bad' : '' }, fmtMoney(now.income - now.expense, cur))),
        avg !== null ? h('span', { class: 'muted' }, `Gasto medio por ${names[period][1]}: ${fmtMoney(avg, cur)}`) : null));
  };
  draw();
  return card('Evolución', box, seg, 'gx-card-evo');
}

function hero(view: GastosView, spent: number, prevAtDay: number, prevTotal: number, elapsed: number, days: number, curCum: number[], prevCum: number[]): HTMLElement {
  const cur = view.currency;
  const month = view.month;
  const lines = view.summary?.budget ?? [];
  const limit = lines.reduce((n, l) => n + l.limitCents, 0);
  const budgetSpent = lines.reduce((n, l) => n + l.spentCents, 0);
  const left = limit - budgetSpent;

  // Comparación justa: lo de este mes hasta hoy frente a lo del anterior hasta el mismo día
  let compare: HTMLElement | null = null;
  if (prevTotal) {
    const ref = view.isCurrentMonth ? prevAtDay : prevTotal;
    const diff = spent - ref;
    const when = view.isCurrentMonth ? 'que el mes pasado a estas alturas' : `que en ${monthName(shiftMonth(month, -1))}`;
    compare = h('span', { class: `gx-pill ${diff <= 0 ? 'is-good' : 'is-bad'}` },
      h('span', { html: icon(diff <= 0 ? 'trendDown' : 'trendUp', 14) }),
      Math.abs(diff) < 100 ? `Igual ${when}` : `${fmtMoney(Math.abs(diff), cur)} ${diff < 0 ? 'menos' : 'más'} ${when}`);
  }

  const budget = limit ? h('button', { type: 'button', class: `gx-hero-budget ${left < 0 ? 'is-over' : ''}`, onclick: () => view.setTab('budget') },
    h('span', { class: 'gx-hero-budget-label' }, left >= 0 ? 'Disponible' : 'Te has pasado'),
    h('strong', {}, fmtMoney(Math.abs(left), cur)),
    h('span', { class: 'muted small' }, `de ${fmtMoney(limit, cur)} presupuestados${view.isCurrentMonth ? ` · ${days - elapsed + 1 === 1 ? 'queda 1 día' : `quedan ${days - elapsed + 1} días`}` : ''}`)) : null;

  return h('section', { class: 'gx-hero' },
    h('div', { class: 'gx-hero-top' },
      h('div', { class: 'gx-hero-main' },
        h('span', { class: 'gx-hero-label' }, view.isCurrentMonth ? 'Gastado este mes' : `Gastado en ${monthName(month)}`),
        h('span', { class: 'gx-hero-amount' }, fmtMoney(spent, cur)),
        compare),
      budget),
    elapsed ? paceChart(curCum, prevCum, days, cur, view.mobile) : h('p', { class: 'muted small' }, 'Este mes todavía no ha empezado.'),
    h('div', { class: 'gx-legend' },
      h('span', {}, h('span', { class: 'gx-sw gx-sw-line' }), view.isCurrentMonth ? 'Este mes' : cap(monthName(month))),
      prevCum.length && prevCum[prevCum.length - 1] ? h('span', {}, h('span', { class: 'gx-sw gx-sw-dash' }), cap(monthName(shiftMonth(month, -1)))) : null));
}

function kpi(label: string, value: string, sub: HTMLElement, negative = false, cls = ''): HTMLElement {
  return h('div', { class: `gx-kpi ${cls}` },
    h('span', { class: 'gx-kpi-label' }, label),
    h('span', { class: `gx-kpi-value ${negative ? 'is-neg' : ''}` }, value),
    sub);
}

function delta(now: number, before: number, upIsGood: boolean, prevMonth: string): HTMLElement {
  const p = pctChange(now, before);
  if (p === null) return h('span', { class: 'gx-kpi-sub' }, `Sin datos de ${monthName(prevMonth)}`);
  const good = upIsGood ? p >= 0 : p <= 0;
  return h('span', { class: `gx-kpi-sub ${p === 0 ? '' : good ? 'is-good' : 'is-bad'}` }, `${p > 0 ? '+' : ''}${p} % frente a ${monthName(prevMonth)}`);
}

function card(title: string, content: HTMLElement, aside: HTMLElement | null, cls = ''): HTMLElement {
  return h('section', { class: `gx-card ${cls}` }, h('header', { class: 'gx-card-head' }, h('h3', {}, title), aside), content);
}

function categories(view: GastosView, exp: Movement[], prevExp: Movement[]): HTMLElement {
  const cur = view.currency;
  const totals = categoryTotals(exp);
  const prev = categoryTotals(prevExp);
  const total = [...totals.values()].reduce((n, t) => n + t.cents, 0);
  if (!total) return h('p', { class: 'muted small gx-card-empty' }, 'Todavía no hay gastos este mes.');
  const entries = [...totals].map(([id, t]) => ({ id, ...t, cat: view.state.category(id) }));
  return h('div', { class: 'gx-cats' },
    h('div', { class: 'gx-stack', role: 'img', 'aria-label': entries.map((e) => `${e.cat?.name ?? 'Otros'} ${Math.round((e.cents / total) * 100)} %`).join(', ') },
      ...entries.map((e) => h('span', { style: { flexGrow: String(e.cents), '--c': e.cat?.color ?? 'var(--text-faint)' }, title: `${e.cat?.name}: ${fmtMoney(e.cents, cur)}` }))),
    h('div', { class: 'gx-cat-list' }, ...entries.map((e) => {
      const p = pctChange(e.cents, prev.get(e.id)?.cents ?? 0);
      return h('button', { type: 'button', class: 'gx-cat-row', onclick: () => view.openCategory(e.id) },
        h('span', { class: 'gx-row-ic', style: { '--c': e.cat?.color ?? 'var(--text-faint)' }, html: icon(e.cat?.icon ?? 'wallet', 15) }),
        h('span', { class: 'gx-cat-main' },
          h('span', { class: 'gx-cat-name' }, e.cat?.name ?? 'Sin categoría'),
          h('span', { class: 'gx-cat-sub' }, `${Math.round((e.cents / total) * 100)} % · ${e.count} ${e.count === 1 ? 'gasto' : 'gastos'}`)),
        h('span', { class: 'gx-cat-right' },
          h('span', { class: 'gx-cat-amt' }, fmtMoney(e.cents, cur)),
          p !== null && Math.abs(p) >= 1 ? h('span', { class: `gx-cat-delta ${p > 0 ? 'is-bad' : 'is-good'}`, title: 'Frente al mes anterior' }, `${p > 0 ? '↑' : '↓'} ${Math.abs(p)} %`) : null));
    })));
}

function latest(view: GastosView, cls = ''): HTMLElement {
  const box = h('div', {});
  const seg = h('div', { class: 'seg seg-sm' });
  const draw = () => {
    seg.replaceChildren(...([['recent', 'Recientes'], ['largest', 'Mayores']] as const).map(([v, l]) => h('button', {
      type: 'button', class: `seg-btn ${topMode === v ? 'on' : ''}`, onclick: () => { topMode = v; draw(); },
    }, l)));
    const list = topMode === 'recent' ? view.monthMovs.slice(0, 5) : expenses(view.monthMovs).sort((a, b) => b.amountCents - a.amountCents).slice(0, 5);
    box.replaceChildren(...(list.length ? [
      h('div', { class: 'gx-list gx-list-compact', role: 'list' }, ...list.map((m) => row(view, m, true))),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost gx-card-more', onclick: () => view.setTab('movs') }, 'Ver todos los movimientos', h('span', { html: icon('chevronRight', 14) })),
    ] : [h('p', { class: 'muted small gx-card-empty' }, 'Sin movimientos este mes.')]));
  };
  draw();
  return card('Movimientos', box, seg, cls);
}
