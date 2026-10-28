// Pestaña Presupuestos: cuánto queda del mes, una barra por categoría con la
// marca del ritmo ideal de hoy y la proyección a fin de mes. Un límite se pone
// o se cambia tocando su fila; «Editar todos» abre la tabla completa.
import { h, modal } from '../ui/dom';
import { icon } from '../ui/icons';
import { daysInMonth } from '../agenda/dates';
import type { BudgetLine, Category } from './model';
import { fmtMoney, monthName, parseMoney } from './model';
import { categoryTotals, elapsedDays, shiftMonth } from './calc';
import { progressBar } from './charts';
import type { GastosView } from './view';

export function renderBudget(view: GastosView, root: HTMLElement) {
  const st = view.state;
  const cur = view.currency;
  const lines = view.summary?.budget ?? [];
  const byId = new Map(lines.map((l) => [l.categoryId, l]));
  const withLimit = st.categories.filter((c) => byId.has(c.id));
  const withoutLimit = st.categories.filter((c) => !byId.has(c.id));
  const spentNow = categoryTotals(view.monthMovs);
  const days = daysInMonth(`${view.month}-01`);
  const elapsed = elapsedDays(view.month, st.today);
  const pace = view.isCurrentMonth ? elapsed / days : undefined;
  // Proyección lineal a fin de mes: solo tiene sentido en el mes en curso y con unos días de datos
  const project = (spent: number) => (view.isCurrentMonth && elapsed >= 5 ? Math.round((spent / elapsed) * days) : null);

  if (!withLimit.length) {
    root.replaceChildren(h('div', { class: 'gx-budget' },
      h('div', { class: 'gx-onboard' },
        h('span', { class: 'gx-onboard-ic', html: icon('pieChart', 28) }),
        h('h3', {}, 'Pon un límite a lo que más te importa'),
        h('p', { class: 'muted' }, 'Elige cuánto quieres gastar al mes en cada categoría. Verás cuánto te queda, si vas por delante del ritmo y Folio te avisará al llegar al 80 % y al pasarte.'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => void budgetDialog(view) }, 'Crear el presupuesto')),
      unbudgeted(view, withoutLimit, spentNow)));
    return;
  }

  const limit = withLimit.reduce((n, c) => n + byId.get(c.id)!.limitCents, 0);
  const spent = withLimit.reduce((n, c) => n + byId.get(c.id)!.spentCents, 0);
  const left = limit - spent;
  const proj = project(spent);

  root.replaceChildren(h('div', { class: 'gx-budget' },
    h('section', { class: 'gx-hero gx-budget-hero' },
      h('div', { class: 'gx-hero-top' },
        h('div', { class: 'gx-hero-main' },
          h('span', { class: 'gx-hero-label' }, left >= 0 ? `Disponible en ${monthName(view.month)}` : `Te has pasado en ${monthName(view.month)}`),
          h('span', { class: `gx-hero-amount ${left < 0 ? 'is-neg' : ''}` }, fmtMoney(Math.abs(left), cur)),
          h('span', { class: 'muted small' }, `${fmtMoney(spent, cur)} de ${fmtMoney(limit, cur)} presupuestados${view.isCurrentMonth ? ` · ${days - elapsed + 1 === 1 ? 'queda 1 día' : `quedan ${days - elapsed + 1} días`}` : ''}`)),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => void budgetDialog(view) }, h('span', { html: icon('pencil', 14) }), 'Editar todos')),
      progressBar(limit ? spent / limit : 0, pace),
      proj !== null ? h('p', { class: `gx-proj ${proj > limit ? 'is-bad' : 'is-good'}` },
        h('span', { html: icon(proj > limit ? 'alertCircle' : 'checkCircle', 14) }),
        proj > limit ? `A este ritmo acabarás el mes en ${fmtMoney(proj, cur)}, ${fmtMoney(proj - limit, cur)} por encima.` : `A este ritmo acabarás el mes en ${fmtMoney(proj, cur)}, dentro del presupuesto.`) : null),
    h('section', { class: 'gx-card' },
      h('header', { class: 'gx-card-head' }, h('h3', {}, 'Por categoría'), pace !== undefined ? h('span', { class: 'muted small gx-pace-key' }, h('span', { class: 'gx-pace-key-mark' }), 'ritmo ideal de hoy') : null),
      h('div', { class: 'gx-blist' }, ...withLimit.map((c) => budgetRow(view, c, byId.get(c.id)!, pace, project)))),
    unbudgeted(view, withoutLimit, spentNow)));
}

function budgetRow(view: GastosView, c: Category, l: BudgetLine, pace: number | undefined, project: (s: number) => number | null): HTMLElement {
  const cur = view.currency;
  const left = l.limitCents - l.spentCents;
  const proj = project(l.spentCents);
  const status = left < 0 ? 'is-over' : l.ratio >= 0.8 ? 'is-warn' : '';
  return h('button', { type: 'button', class: 'gx-brow', onclick: () => void limitDialog(view, c, l.limitCents), title: 'Cambiar el límite' },
    h('span', { class: 'gx-row-ic', style: { '--c': c.color }, html: icon(c.icon, 15) }),
    h('span', { class: 'gx-brow-main' },
      h('span', { class: 'gx-brow-top' },
        h('span', { class: 'gx-brow-name' }, c.name),
        h('span', { class: `gx-brow-left ${status}` }, left >= 0 ? `quedan ${fmtMoney(left, cur)}` : `te pasas ${fmtMoney(-left, cur)}`)),
      progressBar(l.ratio, pace, c.color),
      h('span', { class: 'gx-brow-sub' },
        `${fmtMoney(l.spentCents, cur)} de ${fmtMoney(l.limitCents, cur)}`,
        proj !== null && proj > l.limitCents && left >= 0 ? h('span', { class: 'gx-brow-warn' }, ` · a este ritmo, ${fmtMoney(proj, cur)}`) : null)));
}

function unbudgeted(view: GastosView, cats: Category[], spent: Map<string, { cents: number }>): HTMLElement | null {
  if (!cats.length) return null;
  return h('section', { class: 'gx-card gx-card-quiet' },
    h('header', { class: 'gx-card-head' }, h('h3', {}, 'Sin límite')),
    h('div', { class: 'gx-ulist' }, ...cats.map((c) => h('div', { class: 'gx-urow' },
      h('span', { class: 'gx-row-ic', style: { '--c': c.color }, html: icon(c.icon, 15) }),
      h('span', { class: 'gx-urow-name' }, c.name, h('span', { class: 'gx-cat-sub' }, spent.get(c.id) ? `${fmtMoney(spent.get(c.id)!.cents, view.currency)} este mes` : 'Sin gastos este mes')),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => void limitDialog(view, c, 0) }, h('span', { html: icon('plus', 14) }), 'Poner límite')))));
}

/** Presupuesto vigente de una categoría en un mes (el del mes manda sobre «todos los meses»). */
function current(view: GastosView, categoryId: string, month: string) {
  const b = view.state.budgets.find((x) => x.categoryId === categoryId && x.month === month)
    ?? view.state.budgets.find((x) => x.categoryId === categoryId && x.month === '*');
  return b ? { cents: b.limitCents, isMonth: b.month === month } : null;
}

/** Límite de una sola categoría, con lo gastado el mes anterior como referencia. */
async function limitDialog(view: GastosView, c: Category, limitCents: number) {
  const st = view.state;
  const month = view.month;
  const existing = current(view, c.id, month);
  let scope: 'month' | 'all' = existing?.isMonth ? 'month' : 'all';
  const input = h('input', { class: 'gx-amount-input gx-amount-input-sm', inputMode: 'decimal', placeholder: '0,00', 'aria-label': `Límite de ${c.name}` });
  input.value = limitCents ? String(limitCents / 100).replace('.', ',') : '';
  const prevSpent = categoryTotals(view.prevMovs).get(c.id)?.cents ?? 0;
  const scopeSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Aplicar a' });
  const drawScope = () => scopeSeg.replaceChildren(...([['all', 'Todos los meses'], ['month', `Solo ${monthName(month)}`]] as const).map(([v, l]) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(scope === v), class: `seg-btn ${scope === v ? 'on' : ''}`, onclick: () => { scope = v; drawScope(); },
  }, l)));
  drawScope();
  const err = h('p', { class: 'gx-err', hidden: true });

  const body = h('div', { class: 'ag-form gx-form' },
    h('div', { class: 'gx-limit-head' }, h('span', { class: 'gx-row-ic', style: { '--c': c.color }, html: icon(c.icon, 16) }), h('strong', {}, c.name)),
    h('div', { class: 'gx-amount gx-amount-sm' }, input, h('span', { class: 'gx-amount-cur' }, 'al mes')),
    err,
    prevSpent ? h('button', { type: 'button', class: 'gx-suggest', onclick: () => { input.value = String(Math.ceil(prevSpent / 100)); input.focus(); } },
      `En ${monthName(shiftMonth(month, -1))} gastaste ${fmtMoney(prevSpent, view.currency)} · usar esa cifra`) : null,
    h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Aplicar a'), scopeSeg));

  const buttons = [
    ...(existing ? [{ label: 'Quitar el límite', value: 'remove' as const, kind: 'ghost' as const }] : []),
    { label: 'Cancelar', value: null, kind: 'ghost' as const },
    { label: 'Guardar', value: 'save' as const, kind: 'primary' as const },
  ];
  const res = await modal<'save' | 'remove' | null>(existing ? 'Cambiar el límite' : 'Poner un límite', body, buttons, {
    className: 'ag-modal gx-modal gx-modal-sm',
    onOpen: () => setTimeout(() => { input.focus(); input.select(); }, 30),
  });
  if (res === 'remove') {
    await st.setBudget({ month: existing!.isMonth ? month : '*', categoryId: c.id, limitCents: 0 });
  } else if (res === 'save') {
    const cents = parseMoney(input.value) ?? 0;
    if (cents <= 0) return;
    await st.setBudget({ month: scope === 'all' ? '*' : month, categoryId: c.id, limitCents: cents });
  } else return;
  await view.reload();
}

/** Tabla con todas las categorías, para poner o cambiar varios límites a la vez. */
export async function budgetDialog(view: GastosView) {
  const st = view.state;
  const month = view.month;
  const cur = view.currency;
  const prevTotals = categoryTotals(view.prevMovs);
  let scope: 'month' | 'all' = 'all';
  const scopeSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Aplicar a' });
  const drawScope = () => scopeSeg.replaceChildren(...([['all', 'Todos los meses'], ['month', `Solo ${monthName(month)} de ${month.slice(0, 4)}`]] as const).map(([v, l]) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(scope === v), class: `seg-btn ${scope === v ? 'on' : ''}`, onclick: () => { scope = v; drawScope(); },
  }, l)));
  drawScope();

  const inputs = new Map<string, HTMLInputElement>();
  const existing = new Map(st.categories.map((c) => [c.id, current(view, c.id, month)]));
  const rows = st.categories.map((c) => {
    const input = h('input', { class: 'input input-sm', inputMode: 'decimal', placeholder: 'Sin límite', 'aria-label': `Límite de ${c.name}` });
    const e = existing.get(c.id);
    if (e) input.value = String(e.cents / 100).replace('.', ',');
    inputs.set(c.id, input);
    const prev = prevTotals.get(c.id)?.cents;
    return h('div', { class: 'gx-btable-row' },
      h('span', { class: 'gx-row-ic', style: { '--c': c.color }, html: icon(c.icon, 14) }),
      h('span', { class: 'gx-btable-name' }, c.name, h('span', { class: 'gx-cat-sub' }, prev ? `${monthName(shiftMonth(month, -1))}: ${fmtMoney(prev, cur)}` : 'Sin gastos el mes anterior')),
      input);
  });

  const body = h('div', { class: 'ag-form gx-form' },
    h('p', { class: 'muted small' }, 'Deja vacía una categoría para no ponerle límite.'),
    h('div', { class: 'gx-btable' }, ...rows),
    h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Aplicar a'), scopeSeg));

  const res = await modal<'save' | null>('Presupuesto mensual', body, [
    { label: 'Cancelar', value: null, kind: 'ghost' },
    { label: 'Guardar', value: 'save', kind: 'primary' },
  ], { className: 'ag-modal gx-modal' });
  if (res !== 'save') return;

  const toMonth = scope === 'all' ? '*' : month;
  for (const c of st.categories) {
    const cents = parseMoney(inputs.get(c.id)!.value) ?? 0;
    const prior = existing.get(c.id);
    if (!cents && !prior) continue;
    if (prior && cents === prior.cents && (prior.isMonth ? month : '*') === toMonth) continue;
    // Vaciar un límite lo quita allí donde estaba, no en el ámbito elegido
    await st.setBudget({ month: !cents && prior ? (prior.isMonth ? month : '*') : toMonth, categoryId: c.id, limitCents: cents });
  }
  await view.reload();
}
