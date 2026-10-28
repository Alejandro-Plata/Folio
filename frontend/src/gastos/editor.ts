// Alta y edición de un movimiento, pensada para apuntar un gasto en segundos:
// primero el importe (admite sumas, «12,50+3»), después la categoría con un
// toque y lo demás es opcional. Los botones van dentro del cuerpo para validar
// antes de cerrar y mostrar los errores en línea.
import { api } from '../api';
import { h, modal, confirmDialog, toast } from '../ui/dom';
import { icon } from '../ui/icons';
import { addDays, endOfMonth } from '../agenda/dates';
import type { Kind, Method, Movement } from './model';
import { fmtMoney, monthName, parseMoney } from './model';
import type { GastosView } from './view';

export interface MovementDialogOpts {
  movement?: Movement;
  kind?: Kind;
  date?: string;
}

const EXPENSE_METHODS: [Method, string][] = [['card', 'Tarjeta'], ['cash', 'Efectivo'], ['bizum', 'Bizum'], ['transfer', 'Transferencia']];
const INCOME_METHODS: [Method, string][] = [['monthly', 'Nómina'], ['bizum', 'Bizum'], ['transfer', 'Transferencia']];
const METHOD_NAME: Record<string, string> = { monthly: 'Nómina', bizum: 'Bizum', transfer: 'Transferencia' };

/** «12,50 + 3 - 1» → céntimos; null si algún término no es un importe. */
export function evalAmount(s: string): number | null {
  const terms = s.replace(/\s+/g, '').match(/[+-]?[^+-]+/g);
  if (!terms) return null;
  let total = 0;
  for (const t of terms) {
    const v = parseMoney(t);
    if (v === null) return null;
    total += v;
  }
  return total;
}

export async function movementDialog(view: GastosView, opts: MovementDialogOpts = {}) {
  const st = view.state;
  const editing = opts.movement;
  const cur = view.currency;
  let kind: Kind = editing?.kind ?? opts.kind ?? 'expense';
  let categoryId = editing?.categoryId ?? '';
  let method: Method = editing?.method ?? (kind === 'expense' ? 'card' : 'monthly');
  let date = editing?.date ?? opts.date ?? st.today;

  const amountInput = h('input', { class: 'gx-amount-input', inputMode: 'decimal', placeholder: '0,00', 'aria-label': 'Importe', autocomplete: 'off' });
  amountInput.value = editing ? String(editing.amountCents / 100).replace('.', ',') : '';
  const amountHint = h('span', { class: 'gx-amount-hint' });
  const amountErr = h('p', { class: 'gx-err', hidden: true });
  const sym = new Intl.NumberFormat('es-ES', { style: 'currency', currency: cur }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? '€';
  const amountBox = h('div', { class: 'gx-amount' }, h('span', { class: 'gx-amount-sign' }), amountInput, h('span', { class: 'gx-amount-cur' }, sym));
  // El campo crece con lo escrito: el signo y la moneda quedan pegados a la cifra
  const fit = () => { amountInput.style.width = `${(amountInput.value || amountInput.placeholder).length * 0.6 + 0.3}em`; };
  fit();
  amountInput.addEventListener('input', () => {
    fit();
    const v = /[+-]/.test(amountInput.value.replace(/^[+-]/, '')) ? evalAmount(amountInput.value) : null;
    amountHint.textContent = v !== null ? `= ${fmtMoney(v, cur)}` : '';
    amountErr.hidden = true;
  });

  const nameInput = h('input', { class: 'input', 'aria-label': 'Nota' });
  // Un nombre igual al de la categoría lo puso Folio: al editar no se muestra como nota
  nameInput.value = editing && editing.name !== (st.category(editing.categoryId)?.name ?? METHOD_NAME[editing.method ?? ''] ?? 'Ingreso') ? editing.name : '';
  const counterpartyInput = h('input', { class: 'input' });
  counterpartyInput.value = editing?.counterparty ?? '';
  const conceptInput = h('input', { class: 'input' });
  conceptInput.value = editing?.concept ?? '';
  const dateInput = h('input', { class: 'input input-sm gx-date-input', type: 'date', 'aria-label': 'Otra fecha' });
  dateInput.value = date;
  dateInput.addEventListener('change', () => { date = dateInput.value || st.today; drawDate(); });

  const catErr = h('p', { class: 'gx-err', hidden: true });
  const counterErr = h('p', { class: 'gx-err', hidden: true });
  const setErr = (el: HTMLElement, msg: string) => { el.hidden = false; el.textContent = msg; };

  const kindSeg = h('div', { class: 'seg gx-kind', role: 'radiogroup', 'aria-label': 'Tipo de movimiento' });
  const catGrid = h('div', { class: 'gx-cat-grid', role: 'radiogroup', 'aria-label': 'Categoría' });
  const methodBox = h('div', { class: 'gx-chips', role: 'radiogroup' });
  const dateBox = h('div', { class: 'gx-chips', role: 'group', 'aria-label': 'Fecha' });
  const counterpartyLabel = h('span', { class: 'ag-field-label' });
  const conceptLabel = h('span', { class: 'ag-field-label' });
  const counterpartyBox = h('div', { class: 'ag-row' },
    h('label', { class: 'ag-field' }, counterpartyLabel, counterpartyInput, counterErr),
    h('label', { class: 'ag-field' }, conceptLabel, conceptInput));
  const showCounterparty = () => method === 'bizum' || method === 'transfer';

  const choice = (on: boolean, label: string, run: () => void, attrs: Record<string, unknown> = {}) =>
    h('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: `gx-choice ${on ? 'on' : ''}`, onclick: run, ...attrs }, label);

  const drawDate = () => {
    const y = addDays(st.today, -1);
    dateBox.replaceChildren(
      choice(date === st.today, 'Hoy', () => { date = st.today; dateInput.value = date; drawDate(); }),
      choice(date === y, 'Ayer', () => { date = y; dateInput.value = date; drawDate(); }),
      dateInput);
    dateInput.classList.toggle('on', date !== st.today && date !== y);
  };
  const drawCategories = () => catGrid.replaceChildren(...st.categories.map((c) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(c.id === categoryId), class: `gx-cat-tile ${c.id === categoryId ? 'on' : ''}`, style: { '--c': c.color },
    onclick: () => { categoryId = c.id; catErr.hidden = true; drawCategories(); nameInput.placeholder = `${c.name} (opcional)`; },
  }, h('span', { class: 'gx-cat-tile-ic', html: icon(c.icon, 18) }), h('span', { class: 'gx-cat-tile-name' }, c.name))));
  const drawMethod = () => {
    const list = kind === 'expense' ? EXPENSE_METHODS : INCOME_METHODS;
    methodBox.setAttribute('aria-label', kind === 'expense' ? 'Forma de pago' : 'Tipo de ingreso');
    methodBox.replaceChildren(...list.map(([v, l]) => choice(v === method, l, () => { method = v; drawMethod(); drawCounterparty(); })));
  };
  const drawCounterparty = () => {
    counterpartyBox.hidden = !showCounterparty();
    counterpartyLabel.textContent = kind === 'expense' ? 'Destinatario' : 'Emisor';
    conceptLabel.textContent = kind === 'expense' ? 'Concepto' : 'Concepto o motivo';
    if (!showCounterparty()) counterErr.hidden = true;
  };

  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary' }, editing ? 'Guardar' : 'Añadir');
  const cancelBtn = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Cancelar');
  const deleteBtn = editing ? h('button', { type: 'button', class: 'btn btn-danger-ghost' }, h('span', { html: icon('trash', 14) }), 'Eliminar') : null;

  const body = h('div', { class: 'ag-form gx-form gx-quick' });
  const redraw = () => {
    kindSeg.replaceChildren(...([['expense', 'Gasto'], ['income', 'Ingreso']] as const).map(([k, l]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(kind === k), class: `seg-btn ${kind === k ? 'on' : ''}`,
      onclick: () => { if (kind !== k) { kind = k; method = k === 'expense' ? 'card' : 'monthly'; redraw(); amountInput.focus(); } },
    }, l)));
    body.classList.toggle('is-income', kind === 'income');
    (amountBox.firstChild as HTMLElement).textContent = kind === 'expense' ? '−' : '+';
    nameInput.placeholder = kind === 'expense' ? `${st.category(categoryId)?.name ?? 'Nota'} (opcional)` : 'Descripción (opcional)';
    drawCategories();
    drawMethod();
    drawCounterparty();
    drawDate();
    body.replaceChildren(...([
      h('div', { class: 'gx-quick-top' }, kindSeg),
      h('div', { class: 'gx-amount-wrap' }, amountBox, amountHint, amountErr),
      kind === 'expense' ? h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Categoría'), catGrid, catErr) : null,
      h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, kind === 'expense' ? 'Pago' : 'Tipo'), methodBox),
      counterpartyBox,
      h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Fecha'), dateBox),
      h('label', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, kind === 'expense' ? 'Nota' : 'Descripción'), nameInput),
      h('div', { class: 'btn-row gx-dialog-foot' }, deleteBtn, h('div', { class: 'spacer' }), cancelBtn, saveBtn),
    ] as (HTMLElement | null)[]).filter((x): x is HTMLElement => x !== null));
  };
  redraw();

  const validate = (): Movement | null => {
    let ok = true;
    const cents = evalAmount(amountInput.value);
    if (cents === null || cents <= 0) { setErr(amountErr, 'Escribe un importe mayor que cero.'); ok = false; }
    if (kind === 'expense' && !categoryId) { setErr(catErr, 'Elige una categoría.'); ok = false; }
    const counterparty = counterpartyInput.value.trim();
    if (kind === 'income' && showCounterparty() && !counterparty) { setErr(counterErr, 'Escribe quién te lo envía.'); ok = false; }
    if (!ok) return null;
    const name = nameInput.value.trim() || (kind === 'expense' ? st.category(categoryId)!.name : METHOD_NAME[method] ?? 'Ingreso');
    return {
      id: editing?.id ?? '', kind, date, name,
      categoryId: kind === 'expense' ? categoryId : undefined,
      amountCents: cents!,
      method: method || undefined,
      counterparty: showCounterparty() ? (counterparty || undefined) : undefined,
      concept: showCounterparty() ? (conceptInput.value.trim() || undefined) : undefined,
    };
  };

  let close: ((v: null) => void) | undefined;
  cancelBtn.onclick = () => close?.(null);
  saveBtn.onclick = () => {
    const m = validate();
    if (!m) return;
    close?.(null);
    void (async () => {
      const prevRatio = m.kind === 'expense' && m.categoryId ? await budgetRatio(m.categoryId, m.date) : 0;
      const verb = editing ? 'Guardado' : m.kind === 'expense' ? 'Gasto añadido' : 'Ingreso añadido';
      await st.saveMovement(m, `${verb}: ${m.kind === 'expense' ? '−' : '+'}${fmtMoney(m.amountCents, cur)}`);
      await view.reload();
      if (m.kind === 'expense' && m.categoryId) {
        const newRatio = await budgetRatio(m.categoryId, m.date);
        if (newRatio >= 1 && prevRatio < 1) {
          toast(`Has superado el presupuesto de ${st.category(m.categoryId)?.name ?? 'esa categoría'} de ${monthName(m.date.slice(0, 7))}`, { kind: 'error', ms: 6000 });
        } else if (newRatio >= 0.8 && prevRatio < 0.8) {
          toast(`Llevas el ${Math.round(newRatio * 100)} % del presupuesto de ${st.category(m.categoryId)?.name ?? 'esa categoría'}`, { ms: 5000 });
        }
      }
    })();
  };
  if (deleteBtn) {
    deleteBtn.onclick = () => void (async () => {
      if (!await confirmDialog('Eliminar movimiento', `¿Borrar «${editing!.name}»? Se puede deshacer.`, 'Eliminar', true)) return;
      close?.(null);
      await st.deleteMovements([editing!.id], 'Movimiento eliminado');
      await view.reload();
    })();
  }

  await modal<null>(editing ? 'Editar movimiento' : 'Nuevo movimiento', body, [], {
    className: 'ag-modal gx-modal',
    onOpen: (c) => {
      close = c;
      setTimeout(() => { amountInput.focus(); amountInput.select(); }, 30);
      body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target instanceof HTMLInputElement) { e.preventDefault(); saveBtn.click(); } });
    },
  });
}

/** Proporción gastada/límite de una categoría en el mes de «date» (0 si no hay presupuesto). */
async function budgetRatio(categoryId: string, date: string): Promise<number> {
  const from = `${date.slice(0, 7)}-01`;
  const summary = await api.GastosSummary({ from, to: endOfMonth(from) });
  return summary.budget?.find((b) => b.categoryId === categoryId)?.ratio ?? 0;
}
