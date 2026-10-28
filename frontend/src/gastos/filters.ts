// Filtros de la lista de movimientos que no caben en la barra: categorías,
// forma de pago, importes y orden. El tipo y la búsqueda están a la vista.
import { h, modal } from '../ui/dom';
import { icon } from '../ui/icons';
import type { Filter, Method } from './model';
import { parseMoney } from './model';
import type { GastosView } from './view';

const METHODS: [Method, string][] = [['card', 'Tarjeta'], ['cash', 'Efectivo'], ['bizum', 'Bizum'], ['transfer', 'Transferencia'], ['monthly', 'Nómina']];

export async function filtersDialog(view: GastosView) {
  const f = view.filter;
  const catSet = new Set(f.categoryIds ?? []);
  const methodSet = new Set<Method>(f.methods ?? []);
  let sort: 'date' | 'amount' = f.sort ?? 'date';

  const catBox = h('div', { class: 'gx-cat-grid gx-cat-grid-sm', role: 'group', 'aria-label': 'Categorías' });
  const drawCats = () => catBox.replaceChildren(...view.state.categories.map((c) => h('button', {
    type: 'button', class: `gx-cat-tile ${catSet.has(c.id) ? 'on' : ''}`, 'aria-pressed': String(catSet.has(c.id)), style: { '--c': c.color },
    onclick: () => { if (catSet.has(c.id)) catSet.delete(c.id); else catSet.add(c.id); drawCats(); },
  }, h('span', { class: 'gx-cat-tile-ic', html: icon(c.icon, 16) }), h('span', { class: 'gx-cat-tile-name' }, c.name))));
  drawCats();

  const methodBox = h('div', { class: 'gx-chips', role: 'group', 'aria-label': 'Formas de pago' });
  const drawMethods = () => methodBox.replaceChildren(...METHODS.map(([v, l]) => h('button', {
    type: 'button', class: `gx-choice ${methodSet.has(v) ? 'on' : ''}`, 'aria-pressed': String(methodSet.has(v)),
    onclick: () => { if (methodSet.has(v)) methodSet.delete(v); else methodSet.add(v); drawMethods(); },
  }, l)));
  drawMethods();

  const sortBox = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Ordenar por' });
  const drawSort = () => sortBox.replaceChildren(...([['date', 'Fecha'], ['amount', 'Importe']] as const).map(([v, l]) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(sort === v), class: `seg-btn ${sort === v ? 'on' : ''}`, onclick: () => { sort = v; drawSort(); },
  }, l)));
  drawSort();

  const money = (cents: number | undefined) => (cents ? String(cents / 100).replace('.', ',') : '');
  const minInput = h('input', { class: 'input', inputMode: 'decimal', placeholder: '0,00' });
  minInput.value = money(f.minCents);
  const maxInput = h('input', { class: 'input', inputMode: 'decimal', placeholder: 'Sin máximo' });
  maxInput.value = money(f.maxCents);

  const body = h('div', { class: 'ag-form gx-form' },
    h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Categorías'), catBox),
    h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Forma de pago'), methodBox),
    h('div', { class: 'ag-row' },
      h('label', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Desde'), minInput),
      h('label', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Hasta'), maxInput)),
    h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Ordenar por'), sortBox));

  const res = await modal<'apply' | 'clear' | null>('Filtros', body, [
    { label: 'Quitar filtros', value: 'clear', kind: 'ghost' },
    { label: 'Cancelar', value: null, kind: 'ghost' },
    { label: 'Aplicar', value: 'apply', kind: 'primary' },
  ], { className: 'ag-modal gx-modal' });

  if (res === 'clear') { view.setFilter({ kind: f.kind, query: f.query }); return; }
  if (res !== 'apply') return;
  const next: Filter = {
    kind: f.kind,
    query: f.query,
    categoryIds: catSet.size ? [...catSet] : undefined,
    methods: methodSet.size ? [...methodSet] : undefined,
    minCents: parseMoney(minInput.value) ?? undefined,
    maxCents: parseMoney(maxInput.value) ?? undefined,
    sort,
  };
  view.setFilter(next);
}
