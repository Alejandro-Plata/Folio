// Diálogo de movimiento: crear o editar un gasto o un ingreso. Los botones
// reales viven dentro del cuerpo (no en el pie del modal) para poder validar
// antes de cerrar y mostrar los errores en línea.
import { api } from '../api';
import { h, modal, confirmDialog, toast } from '../ui/dom';
import { icon } from '../ui/icons';
import { endOfMonth } from '../agenda/dates';
import type { Kind, Method, Movement } from './model';
import { monthName, parseMoney } from './model';
import type { GastosView } from './view';

export interface MovementDialogOpts {
  movement?: Movement;
  kind?: Kind;
  date?: string;
}

const EXPENSE_METHODS: [Method, string][] = [['card', 'Tarjeta'], ['cash', 'Efectivo'], ['bizum', 'Bizum'], ['transfer', 'Transferencia']];
const INCOME_METHODS: [Method, string][] = [['monthly', 'Nómina o ingreso mensual'], ['bizum', 'Bizum'], ['transfer', 'Transferencia']];

export async function movementDialog(view: GastosView, opts: MovementDialogOpts = {}) {
  const st = view.state;
  const editing = opts.movement;
  let kind: Kind = editing?.kind ?? opts.kind ?? 'expense';
  let categoryId = editing?.categoryId ?? '';
  let method: Method = editing?.method ?? (kind === 'expense' ? 'card' : 'monthly');

  const nameInput = h('input', { class: 'input' });
  nameInput.value = editing?.name ?? '';
  const amountInput = h('input', { class: 'input', inputMode: 'decimal' });
  amountInput.value = editing ? String(editing.amountCents / 100).replace('.', ',') : '';
  const dateInput = h('input', { class: 'input', type: 'date' });
  dateInput.value = editing?.date ?? opts.date ?? st.today;
  const counterpartyInput = h('input', { class: 'input' });
  counterpartyInput.value = editing?.counterparty ?? '';
  const conceptInput = h('input', { class: 'input' });
  conceptInput.value = editing?.concept ?? '';

  const nameLabel = h('span', { class: 'ag-field-label' });
  const nameErr = h('p', { class: 'gx-err', hidden: true });
  const catErr = h('p', { class: 'gx-err', hidden: true });
  const amountErr = h('p', { class: 'gx-err', hidden: true });
  const counterErr = h('p', { class: 'gx-err', hidden: true });
  const clearErr = (el: HTMLElement) => { el.hidden = true; el.textContent = ''; };
  const setErr = (el: HTMLElement, msg: string) => { el.hidden = false; el.textContent = msg; };

  const kindSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Tipo de movimiento' },
    h('button', { type: 'button', class: 'seg-btn', onclick: () => { kind = 'expense'; method = 'card'; redraw(); } }, 'Gasto'),
    h('button', { type: 'button', class: 'seg-btn', onclick: () => { kind = 'income'; method = 'monthly'; redraw(); } }, 'Ingreso'));

  const categoryBox = h('div', { class: 'ag-types', role: 'radiogroup', 'aria-label': 'Categoría' });
  const drawCategories = () => categoryBox.replaceChildren(...st.categories.map((c) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(c.id === categoryId), class: `ag-type ${c.id === categoryId ? 'on' : ''}`,
    style: { '--c': c.color }, onclick: () => { categoryId = c.id; clearErr(catErr); drawCategories(); },
  }, h('span', { html: icon(c.icon, 15) }), h('span', { class: 'ag-type-name' }, c.name))));

  const methodBox = h('div', {});
  const showCounterparty = () => method === 'bizum' || method === 'transfer';
  const drawMethod = () => {
    if (kind === 'expense') {
      const sel = h('select', { class: 'input input-sm', 'aria-label': 'Forma de pago' },
        ...EXPENSE_METHODS.map(([v, l]) => h('option', { value: v, selected: v === method }, l)));
      sel.addEventListener('change', () => { method = sel.value as Method; drawCounterparty(); });
      methodBox.replaceChildren(sel);
    } else {
      const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Tipo de ingreso' },
        ...INCOME_METHODS.map(([v, l]) => h('button', {
          type: 'button', class: `seg-btn ${v === method ? 'on' : ''}`, onclick: () => { method = v; drawMethod(); drawCounterparty(); },
        }, l)));
      methodBox.replaceChildren(seg);
    }
  };

  const counterpartyField = h('label', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Destinatario'), counterpartyInput);
  const conceptField = h('label', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Concepto'), conceptInput);
  const counterpartyBox = h('div', { class: 'ag-row' }, counterpartyField, conceptField, counterErr);
  const drawCounterparty = () => {
    counterpartyBox.hidden = !showCounterparty();
    (counterpartyField.firstChild as HTMLElement).textContent = kind === 'expense' ? 'Destinatario' : 'Emisor';
    (conceptField.firstChild as HTMLElement).textContent = kind === 'expense' ? 'Concepto' : 'Concepto o motivo';
    if (!showCounterparty()) clearErr(counterErr);
  };

  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary' }, editing ? 'Guardar' : 'Crear');
  const cancelBtn = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Cancelar');
  const deleteBtn = editing ? h('button', { type: 'button', class: 'btn btn-danger-ghost' }, 'Eliminar') : null;

  const body = h('div', { class: 'ag-form gx-form' });
  const redraw = () => {
    kindSeg.querySelectorAll('.seg-btn').forEach((b, i) => b.classList.toggle('on', i === (kind === 'expense' ? 0 : 1)));
    nameLabel.textContent = kind === 'expense' ? 'Nombre' : 'Descripción';
    drawCategories();
    drawMethod();
    drawCounterparty();
    const children: (Node | null)[] = [
      kindSeg,
      h('label', { class: 'ag-field' }, nameLabel, nameInput, nameErr),
      kind === 'expense' ? h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Categoría'), categoryBox, catErr) : null,
      h('div', { class: 'ag-row' },
        h('label', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Importe'), amountInput, amountErr),
        h('label', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Fecha'), dateInput)),
      h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, kind === 'expense' ? 'Pago' : 'Tipo'), methodBox),
      counterpartyBox,
      h('div', { class: 'btn-row gx-dialog-foot' }, deleteBtn, h('div', { class: 'spacer' }), cancelBtn, saveBtn),
    ];
    body.replaceChildren(...children.filter((x): x is Node => x !== null));
  };
  redraw();

  const validate = (): Movement | null => {
    let ok = true;
    const name = nameInput.value.trim();
    if (!name) { setErr(nameErr, kind === 'expense' ? 'Escribe un nombre.' : 'Escribe una descripción.'); ok = false; } else clearErr(nameErr);
    if (kind === 'expense' && !categoryId) { setErr(catErr, 'Elige una categoría.'); ok = false; } else clearErr(catErr);
    const cents = parseMoney(amountInput.value);
    if (cents === null || cents <= 0) { setErr(amountErr, 'Escribe un importe mayor que cero.'); ok = false; } else clearErr(amountErr);
    const counterparty = counterpartyInput.value.trim();
    if (kind === 'income' && showCounterparty() && !counterparty) { setErr(counterErr, 'Escribe quién te lo envía.'); ok = false; } else clearErr(counterErr);
    if (!ok) return null;
    return {
      id: editing?.id ?? '', kind, date: dateInput.value || st.today, name,
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
      await st.saveMovement(m, editing ? 'Movimiento guardado' : kind === 'expense' ? 'Gasto creado' : 'Ingreso creado');
      await view.reload();
      if (m.kind === 'expense' && m.categoryId) {
        const newRatio = await budgetRatio(m.categoryId, m.date);
        if (newRatio >= 1 && prevRatio < 1) {
          const cat = st.category(m.categoryId);
          toast(`Has superado el presupuesto de ${cat?.name ?? 'esa categoría'} de ${monthName(m.date.slice(0, 7))}`, { kind: 'error', ms: 6000 });
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

  await modal<null>(editing ? 'Editar movimiento' : kind === 'expense' ? 'Nuevo gasto' : 'Nuevo ingreso', body, [], {
    className: 'ag-modal gx-modal',
    onOpen: (c) => {
      close = c;
      setTimeout(() => nameInput.focus(), 30);
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
