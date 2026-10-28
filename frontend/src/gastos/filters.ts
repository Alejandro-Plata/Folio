// Panel de filtros de Gastos: categorías, tipo, método, texto, importes y
// orden. Se aplican sobre el periodo elegido en la cabecera.
import { h, modal } from '../ui/dom';
import { icon } from '../ui/icons';
import type { Filter, Kind, Method } from './model';
import { parseMoney } from './model';
import type { GastosView } from './view';

const METHODS: [Method, string][] = [['card', 'Tarjeta'], ['cash', 'Efectivo'], ['bizum', 'Bizum'], ['transfer', 'Transferencia'], ['monthly', 'Nómina']];
const KINDS: [Kind | '', string][] = [['', 'Ambos'], ['expense', 'Gastos'], ['income', 'Ingresos']];

export async function filtersDialog(view: GastosView) {
  const f = view.filter;
  let kind: Kind | '' = f.kind ?? '';
  const catSet = new Set(f.categoryIds ?? []);
  const methodSet = new Set<Method>(f.methods ?? []);

  const kindSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Tipo' });
  const drawKind = () => kindSeg.replaceChildren(...KINDS.map(([v, l]) => h('button', {
    type: 'button', class: `seg-btn ${kind === v ? 'on' : ''}`, onclick: () => { kind = v; drawKind(); },
  }, l)));
  drawKind();

  const catBox = h('div', { class: 'ag-types', role: 'group', 'aria-label': 'Categorías' });
  const drawCats = () => catBox.replaceChildren(...view.state.categories.map((c) => h('button', {
    type: 'button', class: `ag-type ${catSet.has(c.id) ? 'on' : ''}`, 'aria-pressed': String(catSet.has(c.id)), style: { '--c': c.color },
    onclick: () => { if (catSet.has(c.id)) catSet.delete(c.id); else catSet.add(c.id); drawCats(); },
  }, h('span', { html: icon(c.icon, 15) }), h('span', { class: 'ag-type-name' }, c.name))));
  drawCats();

  const methodBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Formas de pago' });
  const drawMethods = () => methodBox.replaceChildren(...METHODS.map(([v, l]) => h('button', {
    type: 'button', class: `chip ${methodSet.has(v) ? 'on' : ''}`, 'aria-pressed': String(methodSet.has(v)),
    onclick: () => { if (methodSet.has(v)) methodSet.delete(v); else methodSet.add(v); drawMethods(); },
  }, l)));
  drawMethods();

  const queryInput = h('input', { class: 'input', placeholder: 'Nombre, destinatario o concepto' });
  queryInput.value = f.query ?? '';
  const minInput = h('input', { class: 'input', inputMode: 'decimal', placeholder: '0,00' });
  minInput.value = f.minCents ? String(f.minCents / 100).replace('.', ',') : '';
  const maxInput = h('input', { class: 'input', inputMode: 'decimal', placeholder: 'Sin máximo' });
  maxInput.value = f.maxCents ? String(f.maxCents / 100).replace('.', ',') : '';
  const sortSel = h('select', { class: 'input input-sm', 'aria-label': 'Ordenar por' },
    h('option', { value: 'date', selected: (f.sort ?? 'date') === 'date' }, 'Fecha'),
    h('option', { value: 'amount', selected: f.sort === 'amount' }, 'Importe'));

  const body = h('div', { class: 'ag-form' },
    h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Tipo'), kindSeg),
    h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Categorías'), catBox),
    h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Formas de pago'), methodBox),
    h('label', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Buscar'), queryInput),
    h('div', { class: 'ag-row' },
      h('label', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Importe mínimo'), minInput),
      h('label', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Importe máximo'), maxInput)),
    h('label', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Ordenar por'), sortSel));

  const res = await modal<'apply' | 'clear' | null>('Filtros', body, [
    { label: 'Borrar filtros', value: 'clear', kind: 'ghost' },
    { label: 'Cancelar', value: null, kind: 'ghost' },
    { label: 'Aplicar', value: 'apply', kind: 'primary' },
  ], { className: 'ag-modal' });

  if (res === 'clear') { view.setFilter({}); return; }
  if (res !== 'apply') return;
  const next: Filter = {
    kind: kind || undefined,
    categoryIds: catSet.size ? [...catSet] : undefined,
    methods: methodSet.size ? [...methodSet] : undefined,
    query: queryInput.value.trim() || undefined,
    minCents: parseMoney(minInput.value) ?? undefined,
    maxCents: parseMoney(maxInput.value) ?? undefined,
    sort: sortSel.value === 'amount' ? 'amount' : 'date',
  };
  view.setFilter(next);
}

/** Número de filtros activos (para el aviso en el botón «Filtros»). */
export function activeFilterCount(f: Filter): number {
  let n = 0;
  if (f.kind) n++;
  if (f.categoryIds?.length) n++;
  if (f.methods?.length) n++;
  if (f.query) n++;
  if (f.minCents) n++;
  if (f.maxCents) n++;
  return n;
}
