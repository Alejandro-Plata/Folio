// Semanas tipo: guardar la semana visible como plantilla y aplicarla de una vez
// a un rango de semanas (sin ir día a día).
import { h, modal, popupMenu, promptText, toast, confirmDialog, type MenuItem } from '../ui/dom';
import type { WeekTemplate } from './model';
import { addDays, isoWeek, mondayOfWeek, shortDate, startOfWeek, weekday } from './dates';
import type { AgendaView } from './view';

export function templatesMenu(view: AgendaView, anchor: HTMLElement) {
  const st = view.state;
  const items: MenuItem[] = [
    { label: 'Guardar la semana visible como semana tipo…', icon: 'save', run: () => void saveWeek(view) },
  ];
  if (st.templates.length) {
    items.push({ separator: true }, { heading: 'Aplicar' });
    for (const t of st.templates) items.push({ label: `${t.name} · ${t.tasks.length} tareas`, icon: 'template', run: () => void applyDialog(view, t) });
    items.push({ separator: true }, { heading: 'Borrar' });
    for (const t of st.templates) items.push({ label: t.name, icon: 'trash', danger: true, run: () => void remove(view, t) });
  }
  popupMenu(anchor, items);
}

async function saveWeek(view: AgendaView) {
  const st = view.state;
  const mon = startOfWeek(view.cursor);
  const tasks = (await st.range(mon, addDays(mon, 6))).filter((t) => !t.auto && t.kind !== 'rest');
  if (!tasks.length) { toast('La semana visible no tiene tareas propias (las del plan automático no se guardan).'); return; }
  const name = await promptText('Guardar como semana tipo', `Se guardarán ${tasks.length} tareas de la semana ${isoWeek(mon)}.`, 'Semana de estudio', { ok: 'Guardar' });
  if (!name?.trim()) return;
  const tpl: WeekTemplate = { id: '', name: name.trim(), tasks: tasks.map((t) => ({ weekday: weekday(t.date), title: t.title, typeId: t.typeId, start: t.start, minutes: t.minutes, notes: t.notes })) };
  await st.setTemplates([...st.templates, tpl]);
  toast(`Semana tipo «${tpl.name}» guardada`, { kind: 'ok' });
}

async function applyDialog(view: AgendaView, tpl: WeekTemplate) {
  const st = view.state;
  const thisMon = startOfWeek(view.cursor);
  const year = Number(thisMon.slice(0, 4));
  const from = h('input', { class: 'input input-sm ag-num', type: 'number', min: '1', max: '53', value: String(isoWeek(thisMon)), 'aria-label': 'Desde la semana' });
  const to = h('input', { class: 'input input-sm ag-num', type: 'number', min: '1', max: '53', value: String(Math.min(52, isoWeek(thisMon) + 3)), 'aria-label': 'Hasta la semana' });
  const skip = h('input', { type: 'checkbox', checked: false });
  const info = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const mondays = () => {
    const a = Number(from.value), b = Number(to.value);
    const out: string[] = [];
    for (let w = a; w <= b && out.length < 60; w++) if (!skip.checked || (w - a) % 2 === 0) out.push(mondayOfWeek(w < isoWeek(thisMon) - 26 ? year + 1 : year, w));
    return out;
  };
  const upd = () => {
    const m = mondays();
    info.textContent = m.length ? `${m.length} semanas, del ${shortDate(m[0])} al ${shortDate(addDays(m[m.length - 1], 6))}: se crearán ${m.length * tpl.tasks.length} tareas.` : 'Revisa el rango.';
  };
  for (const x of [from, to, skip]) x.addEventListener('input', upd);
  upd();
  const body = h('div', { class: 'ag-form' },
    h('div', { class: 'ag-row' },
      h('label', { class: 'ag-inline' }, 'Desde la semana', from),
      h('label', { class: 'ag-inline' }, 'hasta la', to)),
    h('label', { class: 'ag-check' }, skip, 'Solo semanas alternas'), info);
  const r = await modal(`Aplicar «${tpl.name}»`, body, [{ label: 'Cancelar', value: null, kind: 'ghost' }, { label: 'Aplicar', value: 'ok', kind: 'primary' }]);
  if (r !== 'ok') return;
  const m = mondays();
  if (m.length) await st.applyTemplate(tpl.id, m);
  if (st.topics.length) await st.plan(true);
}

async function remove(view: AgendaView, tpl: WeekTemplate) {
  if (!await confirmDialog(`¿Borrar la semana tipo «${tpl.name}»?`, 'Las tareas que ya se crearon con ella no se tocan.', 'Borrar', true)) return;
  await view.state.setTemplates(view.state.templates.filter((t) => t.id !== tpl.id));
}
