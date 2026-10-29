// Ajustes de Gastos: moneda, saldo inicial y la fecha desde la que cuenta.
import { h, modal } from '../ui/dom';
import { parseMoney } from './model';
import type { GastosView } from './view';

const CURRENCIES: [string, string][] = [['EUR', 'Euro (€)'], ['USD', 'Dólar estadounidense ($)'], ['GBP', 'Libra esterlina (£)']];

/**
 * «¿Cuánto tienes ahora?»: recalcula el saldo inicial para que el saldo de hoy
 * coincida con el del banco, sin tocar los movimientos ni la fecha de inicio.
 */
export async function balanceDialog(view: GastosView) {
  const st = view.state;
  const now = view.summary?.balanceCents ?? st.settings.openingCents;
  const input = h('input', { class: 'input', inputMode: 'decimal', placeholder: '0,00' });
  input.value = now ? (now / 100).toFixed(2).replace('.', ',') : '';
  const body = h('label', { class: 'field' }, h('span', { class: 'field-label' }, '¿Cuánto tienes ahora en la cuenta?'), input);
  const res = await modal<'save' | null>('Ajustar saldo', body, [
    { label: 'Cancelar', value: null, kind: 'ghost' },
    { label: 'Guardar', value: 'save', kind: 'primary' },
  ], { onOpen: () => setTimeout(() => input.select(), 30) });
  if (res !== 'save') return;
  const target = parseMoney(input.value);
  if (target === null) return;
  await st.saveSettings({ ...st.settings, openingCents: st.settings.openingCents + (target - now) });
  await view.reload();
}

export async function gastosSettingsDialog(view: GastosView) {
  const st = view.state;
  const currencySel = h('select', { class: 'input', 'aria-label': 'Moneda' },
    ...CURRENCIES.map(([v, l]) => h('option', { value: v, selected: v === st.settings.currency }, l)));
  const openingInput = h('input', { class: 'input', inputMode: 'decimal' });
  openingInput.value = st.settings.openingCents ? String(st.settings.openingCents / 100).replace('.', ',') : '';
  const dateInput = h('input', { class: 'input', type: 'date' });
  dateInput.value = st.settings.openingDate || st.today;

  const body = h('div', { class: 'ag-form' },
    h('p', { class: 'muted small' }, 'El saldo se calcula a partir de este importe inicial y de todos los movimientos desde esa fecha.'),
    h('label', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Moneda'), currencySel),
    h('div', { class: 'ag-row' },
      h('label', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Saldo inicial'), openingInput),
      h('label', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Desde'), dateInput)));

  const res = await modal<'save' | null>('Ajustes de Gastos', body, [
    { label: 'Cancelar', value: null, kind: 'ghost' },
    { label: 'Guardar', value: 'save', kind: 'primary' },
  ], { className: 'ag-modal' });
  if (res !== 'save') return;
  const openingCents = parseMoney(openingInput.value) ?? 0;
  await st.saveSettings({ currency: currencySel.value, openingCents, openingDate: dateInput.value || st.today });
  await view.reload();
}
