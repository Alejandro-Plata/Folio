// Pestaña Resumen: una cifra protagonista (lo gastado en el mes y lo que queda
// del presupuesto), el ritmo frente al mes anterior, cifras clave, reparto por
// categoría, calendario de calor, evolución y los últimos movimientos.
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import { daysInMonth } from '../agenda/dates';
import type { Movement } from './model';
import { fmtMoney, monthName } from './model';
import { calendarHeat, monthlyTrend, paceChart } from './charts';
import { categoryTotals, cumulative, dailyTotals, elapsedDays, expenses, incomes, pctChange, shiftMonth, sum } from './calc';
import { row } from './list';
import type { GastosView } from './view';

let topMode: 'recent' | 'largest' = 'recent';
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
    hero(view, spent, prevAtDay, sum(prevExp), elapsed, days, curCum, prevCum),
    h('div', { class: 'gx-kpis' },
      kpi('Ingresos', fmtMoney(income, cur), delta(income, sum(prevInc), true, prevMonth)),
      kpi('Ahorro', fmtMoney(income - spent, cur), income > 0
        ? h('span', { class: `gx-kpi-sub ${income - spent >= 0 ? 'is-good' : 'is-bad'}` }, income - spent >= 0 ? `Guardas el ${Math.round(((income - spent) / income) * 100)} % de lo que ingresas` : 'Gastas más de lo que ingresas')
        : h('span', { class: 'gx-kpi-sub' }, 'Sin ingresos este mes'), (income - spent) < 0),
      kpi('Saldo', fmtMoney(view.summary?.balanceCents ?? 0, cur), h('span', { class: 'gx-kpi-sub' }, 'Con todos los movimientos hasta hoy'), (view.summary?.balanceCents ?? 0) < 0)),
    h('div', { class: 'gx-grid' },
      card('Por categoría', categories(view, exp, prevExp), spent ? h('span', { class: 'muted small' }, `${exp.length} ${exp.length === 1 ? 'gasto' : 'gastos'}`) : null),
      card('Día a día', h('div', {},
        calendarHeat(month, dailyTotals(exp, month), dailyTotals(inc, month), st.today, cur, (d) => view.pickDay(d)),
        h('p', { class: 'gx-card-foot muted small' }, elapsed && spent ? `Media de ${fmtMoney(Math.round(spent / elapsed), cur)} al día · pulsa un día para ver sus movimientos` : 'Pulsa un día para ver sus movimientos')), null),
      card('Evolución', monthlyTrend((view.summary?.trend ?? []).slice(-6), cur, month, view.mobile), null),
      latest(view)),
  ));
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

function kpi(label: string, value: string, sub: HTMLElement, negative = false): HTMLElement {
  return h('div', { class: 'gx-kpi' },
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

function latest(view: GastosView): HTMLElement {
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
  return card('Movimientos', box, seg);
}
