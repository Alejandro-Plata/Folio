// Lista de movimientos agrupada por día, con el neto de cada día y una fila
// por movimiento (icono de la categoría, nombre, subtítulo e importe).
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import { longDate, relativeDate, shortDate } from '../agenda/dates';
import type { Movement } from './model';
import { fmtMoney } from './model';
import type { GastosView } from './view';

const METHOD_LABEL: Record<string, string> = { card: 'Tarjeta', cash: 'Efectivo', bizum: 'Bizum', transfer: 'Transferencia', monthly: 'Nómina' };
const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function renderList(view: GastosView, root: HTMLElement, movements: Movement[]) {
  if (!movements.length) {
    root.replaceChildren(h('div', { class: 'gx-empty' },
      h('span', { class: 'gx-empty-ic', html: icon('wallet', 32) }),
      h('p', {}, 'Aún no hay movimientos en este periodo.'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => view.newMovement() }, 'Añadir el primero')));
    return;
  }
  const today = view.state.today;
  const byDay = new Map<string, Movement[]>();
  for (const m of movements) (byDay.get(m.date) ?? byDay.set(m.date, []).get(m.date)!).push(m);
  const days = [...byDay.keys()].sort().reverse();
  const wrap = h('div', { class: 'gx-list', role: 'list', 'aria-label': 'Movimientos por día' });
  for (const d of days) {
    const list = byDay.get(d)!;
    const net = list.reduce((n, m) => n + (m.kind === 'income' ? m.amountCents : -m.amountCents), 0);
    const label = d === today ? 'Hoy' : relativeDate(d, today) === shortDate(d) ? longDate(d, false) : capitalize(relativeDate(d, today));
    wrap.append(h('section', { class: 'gx-day', role: 'listitem', 'aria-label': longDate(d) },
      h('header', { class: 'gx-day-head' },
        h('strong', {}, label), d === today || relativeDate(d, today) !== shortDate(d) ? h('span', { class: 'muted small' }, ` · ${longDate(d, false)}`) : null,
        h('span', { class: 'spacer' }),
        h('span', { class: `gx-day-net ${net < 0 ? 'is-neg' : net > 0 ? 'is-pos' : ''}` }, `${net > 0 ? '+' : net < 0 ? '−' : ''}${fmtMoney(Math.abs(net), view.state.settings.currency)}`)),
      ...list.map((m) => row(view, m))));
  }
  root.replaceChildren(wrap);
}

export function row(view: GastosView, m: Movement): HTMLElement {
  const cat = m.kind === 'expense' ? view.state.category(m.categoryId) : undefined;
  const color = cat?.color ?? 'var(--ok)';
  const ic = cat?.icon ?? 'arrowDownLeft';
  const sub = [cat?.name, m.method ? METHOD_LABEL[m.method] : null, m.counterparty].filter(Boolean).join(' · ');
  const selected = view.selection.has(m.id);
  const cur = view.state.settings.currency;
  return h('div', { class: `gx-row ${selected ? 'is-selected' : ''}`, role: 'listitem' },
    view.selection.size > 0 ? h('input', {
      type: 'checkbox', class: 'gx-row-check', checked: selected, 'aria-label': `Seleccionar «${m.name}»`,
      onclick: (e: MouseEvent) => { e.stopPropagation(); view.toggleSelect(m.id); },
    }) : null,
    h('button', {
      type: 'button', class: 'gx-row-main-btn',
      onclick: (e: MouseEvent) => {
        if (!view.mobile && (e.ctrlKey || e.metaKey || e.shiftKey)) { view.toggleSelect(m.id); return; }
        view.openMovement(m);
      },
    },
    h('span', { class: 'gx-row-ic', style: { '--c': color }, html: icon(ic, 16) }),
    h('div', { class: 'gx-row-main' },
      h('span', { class: 'gx-row-name' }, m.name),
      sub ? h('span', { class: 'gx-row-sub' }, sub) : null),
    h('span', { class: `gx-row-amount ${m.kind === 'income' ? 'is-income' : 'is-expense'}` }, `${m.kind === 'income' ? '+' : '−'}${fmtMoney(m.amountCents, cur)}`)));
}
