// Pestaña Presupuesto de Gastos: barra de progreso por categoría con límite
// en el mes visible, y el diálogo para poner o cambiar esos límites.
import { h, modal } from '../ui/dom';
import { icon } from '../ui/icons';
import { monthName, parseMoney } from './model';
import { budgetMeter } from './charts';
import type { GastosView } from './view';

export function renderBudget(view: GastosView, root: HTMLElement) {
  const st = view.state;
  const cur = st.settings.currency;
  const lines = view.summary?.budget ?? [];
  const byId = new Map(lines.map((l) => [l.categoryId, l]));
  const withLimit = st.categories.filter((c) => byId.has(c.id));
  const withoutLimit = st.categories.filter((c) => !byId.has(c.id));
  const totalLimit = withLimit.reduce((n, c) => n + byId.get(c.id)!.limitCents, 0);
  const totalSpent = withLimit.reduce((n, c) => n + byId.get(c.id)!.spentCents, 0);

  const editBtn = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => void budgetDialog(view) },
    h('span', { html: icon('pieChart', 14) }), 'Editar presupuesto');

  root.replaceChildren(h('div', { class: 'gx-budget' },
    h('div', { class: 'gx-head-row' }, h('h3', { class: 'gx-budget-title' }, 'Presupuesto'), h('div', { class: 'spacer' }), editBtn),
    totalLimit ? h('section', { class: 'ag-chart-box' },
      budgetMeter({ categoryId: '', limitCents: totalLimit, spentCents: totalSpent, ratio: totalSpent / totalLimit }, 'Total', undefined, cur)) : null,
    withLimit.length
      ? h('section', { class: 'ag-chart-box' }, ...withLimit.map((c) => budgetMeter(byId.get(c.id)!, c.name, c.color, cur)))
      : h('p', { class: 'muted small' }, 'Todavía no has puesto límites de presupuesto.'),
    withoutLimit.length ? h('section', { class: 'gx-budget-none' },
      h('h4', { class: 'gx-budget-none-title muted small' }, 'Sin límite'),
      ...withoutLimit.map((c) => h('div', { class: 'gx-budget-empty-row' },
        h('span', { class: 'gx-bar-dot', style: { '--c': c.color } }),
        h('span', { class: 'gx-budget-empty-name' }, c.name),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => void budgetDialog(view) }, 'Poner límite')))) : null));
}

export async function budgetDialog(view: GastosView) {
  const st = view.state;
  const month = (view.rangeTo || st.today).slice(0, 7);
  const current = new Map<string, { cents: number; isMonth: boolean }>();
  for (const c of st.categories) {
    const specific = st.budgets.find((b) => b.categoryId === c.id && b.month === month);
    const star = st.budgets.find((b) => b.categoryId === c.id && b.month === '*');
    const b = specific ?? star;
    if (b) current.set(c.id, { cents: b.limitCents, isMonth: !!specific });
  }

  const applySel = h('select', { class: 'input input-sm' },
    h('option', { value: 'month' }, `Solo ${monthName(month)} de ${month.slice(0, 4)}`),
    h('option', { value: 'all' }, 'Todos los meses'));

  const inputs = new Map<string, HTMLInputElement>();
  const rows = st.categories.map((c) => {
    const input = h('input', { class: 'input input-sm', inputMode: 'decimal', placeholder: 'Sin límite' }) as HTMLInputElement;
    const existing = current.get(c.id);
    if (existing) input.value = String(existing.cents / 100).replace('.', ',');
    inputs.set(c.id, input);
    return h('div', { class: 'gx-budget-form-row' },
      h('span', { class: 'gx-bar-dot', style: { '--c': c.color } }),
      h('span', { class: 'gx-budget-form-name' }, c.name),
      input);
  });

  const body = h('div', { class: 'ag-form' },
    h('label', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Aplicar a'), applySel),
    h('div', { class: 'gx-budget-form' }, ...rows));

  const res = await modal<'save' | null>('Presupuesto', body, [
    { label: 'Cancelar', value: null, kind: 'ghost' },
    { label: 'Guardar', value: 'save', kind: 'primary' },
  ], { className: 'ag-modal' });
  if (res !== 'save') return;

  const toMonth = applySel.value === 'all' ? '*' : month;
  for (const c of st.categories) {
    const cents = parseMoney(inputs.get(c.id)!.value) ?? 0;
    const prior = current.get(c.id);
    if (!cents && !prior) continue;
    const priorScope = prior ? (prior.isMonth ? month : '*') : null;
    if (cents === (prior?.cents ?? 0) && priorScope === toMonth) continue;
    await st.setBudget({ month: toMonth, categoryId: c.id, limitCents: cents });
  }
  await view.reload();
}
