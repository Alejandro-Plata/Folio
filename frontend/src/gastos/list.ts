// Pestaña Movimientos: búsqueda y filtros a la vista, totales de lo que se ve y
// la lista agrupada por día, con el neto de cada día.
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import { longDate, relativeDate, shortDate } from '../agenda/dates';
import type { Kind, Movement } from './model';
import { fmtMoney, monthName } from './model';
import { expenses, incomes, sum } from './calc';
import { filtersDialog } from './filters';
import type { GastosView } from './view';

const METHOD_LABEL: Record<string, string> = { card: 'Tarjeta', cash: 'Efectivo', bizum: 'Bizum', transfer: 'Transferencia', monthly: 'Nómina' };
const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** La barra de búsqueda se conserva entre repintados para no perder el foco al escribir. */
const toolbars = new WeakMap<GastosView, { el: HTMLElement; host: HTMLElement; sync: () => void }>();

function toolbar(view: GastosView) {
  let tb = toolbars.get(view);
  if (tb) { tb.sync(); return tb; }
  const search = h('input', { class: 'input gx-search-input', type: 'search', placeholder: 'Buscar movimientos', 'aria-label': 'Buscar movimientos' });
  let timer = 0;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => view.setFilter({ ...view.filter, query: search.value.trim() || undefined }), 220);
  });
  const kindSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Tipo' });
  const scopeSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Periodo' });
  const moreBtn = h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => void filtersDialog(view) });
  const chips = h('div', { class: 'gx-active' });
  const el = h('div', { class: 'gx-toolbar' },
    h('label', { class: 'gx-search' }, h('span', { class: 'gx-search-ic', html: icon('search', 15) }), search),
    h('div', { class: 'gx-toolbar-row' }, kindSeg, scopeSeg, h('div', { class: 'spacer' }), moreBtn),
    chips);
  const sync = () => {
    const f = view.filter;
    if (document.activeElement !== search) search.value = f.query ?? '';
    const kinds: [Kind | '', string][] = [['', 'Todo'], ['expense', 'Gastos'], ['income', 'Ingresos']];
    kindSeg.replaceChildren(...kinds.map(([k, l]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String((f.kind ?? '') === k), class: `seg-btn ${(f.kind ?? '') === k ? 'on' : ''}`,
      onclick: () => view.setFilter({ ...view.filter, kind: k || undefined }),
    }, l)));
    scopeSeg.replaceChildren(...([['month', capitalize(monthName(view.month))], ['all', 'Historial']] as const).map(([s, l]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(view.scope === s), class: `seg-btn ${view.scope === s ? 'on' : ''}`, onclick: () => view.setScope(s),
    }, l)));
    const extra = (f.methods?.length ? 1 : 0) + (f.minCents ? 1 : 0) + (f.maxCents ? 1 : 0) + (f.sort === 'amount' ? 1 : 0);
    moreBtn.replaceChildren(h('span', { html: icon('filter', 15) }), extra ? `Filtros (${extra})` : 'Filtros');
    const active: HTMLElement[] = [];
    const chip = (label: string, color: string | undefined, remove: () => void) => h('button', {
      type: 'button', class: 'gx-chip', style: color ? { '--c': color } : {}, 'aria-label': `Quitar el filtro ${label}`, onclick: remove,
    }, color ? h('span', { class: 'gx-side-dot' }) : null, label, h('span', { html: icon('x', 12) }));
    if (view.day) active.push(chip(capitalize(longDate(view.day, false)), undefined, () => view.clearDay()));
    for (const id of f.categoryIds ?? []) {
      const c = view.state.category(id);
      active.push(chip(c?.name ?? id, c?.color, () => {
        const ids = (view.filter.categoryIds ?? []).filter((x) => x !== id);
        view.setFilter({ ...view.filter, categoryIds: ids.length ? ids : undefined });
      }));
    }
    chips.replaceChildren(...active);
    chips.hidden = !active.length;
  };
  tb = { el, host: h('div', {}), sync };
  toolbars.set(view, tb);
  sync();
  return tb;
}

export function renderMovements(view: GastosView, root: HTMLElement) {
  const tb = toolbar(view);
  const movements = view.day ? view.listMovs.filter((m) => m.date === view.day) : view.listMovs;
  const f = view.filter;
  const filtered = !!(view.day || f.kind || f.query || f.categoryIds?.length || f.methods?.length || f.minCents || f.maxCents);
  const cur = view.currency;

  let content: HTMLElement;
  if (!movements.length) {
    content = h('div', { class: 'gx-empty' },
      h('span', { class: 'gx-empty-ic', html: icon(filtered ? 'search' : 'wallet', 28) }),
      h('p', {}, filtered ? 'Ningún movimiento coincide con lo que buscas.' : view.scope === 'all' ? 'Aún no hay movimientos.' : `Aún no hay movimientos en ${monthName(view.month)}.`),
      filtered
        ? h('button', { type: 'button', class: 'btn', onclick: () => { view.day = ''; view.setFilter({ sort: view.filter.sort }); } }, 'Quitar los filtros')
        : h('button', { type: 'button', class: 'btn btn-primary', onclick: () => view.newMovement() }, 'Añadir el primero'));
  } else {
    const out = sum(expenses(movements)), inn = sum(incomes(movements));
    const totals = h('div', { class: 'gx-totals' },
      h('span', {}, `${movements.length} ${movements.length === 1 ? 'movimiento' : 'movimientos'}`),
      out ? h('span', { class: 'gx-totals-out' }, `−${fmtMoney(out, cur)}`) : null,
      inn ? h('span', { class: 'gx-totals-in' }, `+${fmtMoney(inn, cur)}`) : null);
    content = h('div', {}, totals, f.sort === 'amount'
      ? h('div', { class: 'gx-list', role: 'list' }, ...movements.map((m) => row(view, m, true)))
      : byDay(view, movements));
  }
  // Sin sacar la barra del documento: si no, la búsqueda pierde el foco al escribir
  if (tb.el.parentElement !== root || tb.host.parentElement !== root) root.replaceChildren(tb.el, tb.host);
  tb.host.replaceChildren(content);
}

function byDay(view: GastosView, movements: Movement[]): HTMLElement {
  const today = view.state.today;
  const groups = new Map<string, Movement[]>();
  for (const m of movements) (groups.get(m.date) ?? groups.set(m.date, []).get(m.date)!).push(m);
  const wrap = h('div', { class: 'gx-list', role: 'list', 'aria-label': 'Movimientos por día' });
  for (const d of [...groups.keys()].sort().reverse()) {
    const list = groups.get(d)!;
    const net = list.reduce((n, m) => n + (m.kind === 'income' ? m.amountCents : -m.amountCents), 0);
    const rel = relativeDate(d, today);
    const label = rel === shortDate(d) || rel.startsWith('el ') ? capitalize(longDate(d, d.slice(0, 4) !== today.slice(0, 4))) : capitalize(rel);
    wrap.append(h('section', { class: 'gx-day', role: 'listitem', 'aria-label': longDate(d) },
      h('header', { class: 'gx-day-head' },
        h('span', { class: 'gx-day-label' }, label),
        h('span', { class: 'spacer' }),
        h('span', { class: `gx-day-net ${net < 0 ? 'is-neg' : net > 0 ? 'is-pos' : ''}` }, `${net > 0 ? '+' : net < 0 ? '−' : ''}${fmtMoney(Math.abs(net), view.currency)}`)),
      ...list.map((m) => row(view, m))));
  }
  return wrap;
}

/** Fila de un movimiento; con `withDate`, la fecha va en el subtítulo (listas sin agrupar). */
export function row(view: GastosView, m: Movement, withDate = false): HTMLElement {
  const cat = m.kind === 'expense' ? view.state.category(m.categoryId) : undefined;
  const color = cat?.color ?? 'var(--ok)';
  const ic = cat?.icon ?? 'arrowDownLeft';
  const title = m.name || cat?.name || 'Ingreso';
  const sub = [
    withDate ? shortDate(m.date) : null,
    cat && cat.name !== title ? cat.name : !cat ? 'Ingreso' : null,
    m.method ? METHOD_LABEL[m.method] : null,
    m.counterparty, m.concept,
  ].filter(Boolean).join(' · ');
  const selected = view.selection.has(m.id);
  return h('div', { class: `gx-row ${selected ? 'is-selected' : ''}`, role: 'listitem' },
    view.selection.size > 0 ? h('input', {
      type: 'checkbox', class: 'gx-row-check', checked: selected, 'aria-label': `Seleccionar «${title}»`,
      onclick: (e: MouseEvent) => { e.stopPropagation(); view.toggleSelect(m.id); },
    }) : null,
    h('button', {
      type: 'button', class: 'gx-row-main-btn', title: view.mobile ? undefined : 'Ctrl+clic para seleccionar varios',
      onclick: (e: MouseEvent) => {
        if (!view.mobile && (e.ctrlKey || e.metaKey || e.shiftKey)) { view.toggleSelect(m.id); return; }
        view.openMovement(m);
      },
    },
    h('span', { class: 'gx-row-ic', style: { '--c': color }, html: icon(ic, 16) }),
    h('span', { class: 'gx-row-main' },
      h('span', { class: 'gx-row-name' }, title),
      sub ? h('span', { class: 'gx-row-sub' }, sub) : null),
    h('span', { class: `gx-row-amount ${m.kind === 'income' ? 'is-income' : 'is-expense'}` }, `${m.kind === 'income' ? '+' : '−'}${fmtMoney(m.amountCents, view.currency)}`)));
}
