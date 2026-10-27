// Citas (círculos de pareja): una persona propone uno o varios días y la otra
// elige uno, propone otros o dice que no puede. Al elegir, la cita queda en la
// agenda de los dos.
import type { App } from '../app';
import { api } from '../api';
import type { Circle, DateOption, DateProposal } from '../types';
import { confirmDialog, h, modal, toast } from '../ui/dom';
import { icon } from '../ui/icons';
import { addDays, duration, longDate, relativeDate, timeLabel, todayISO } from '../agenda/dates';
import { field } from './common';

const DURATIONS = [60, 90, 120, 180, 240, 0];

/** Editor de opciones: filas día / hora / duración. */
function optionsEditor(initial = 1): { el: HTMLElement; get: () => DateOption[] } {
  const rows: { date: HTMLInputElement; start: HTMLInputElement; mins: HTMLSelectElement }[] = [];
  const list = h('div', { class: 'so', style: { gap: '6px' } });
  const add = () => {
    const prev = rows[rows.length - 1];
    const date = h('input', { class: 'input input-sm', type: 'date', value: prev ? addDays(prev.date.value || todayISO(), 1) : addDays(todayISO(), 2), min: todayISO(), 'aria-label': 'Día' });
    const start = h('input', { class: 'input input-sm', type: 'time', value: prev?.start.value ?? '20:00', step: '900', 'aria-label': 'Hora (vacía = todo el día)' });
    const mins = h('select', { class: 'input input-sm', 'aria-label': 'Duración' },
      ...DURATIONS.map((m) => h('option', { value: String(m), selected: m === Number(prev?.mins.value ?? 120) }, m ? duration(m) : 'Sin duración')));
    const r = { date, start, mins };
    rows.push(r);
    const row = h('div', { class: 'so-opt-row' }, date, start, mins,
      h('button', { type: 'button', class: 'icon-btn', title: 'Quitar este día', 'aria-label': 'Quitar este día', html: icon('x', 14), onclick: () => { if (rows.length > 1) { rows.splice(rows.indexOf(r), 1); row.remove(); } } }));
    list.append(row);
  };
  for (let i = 0; i < initial; i++) add();
  const el = h('div', { class: 'so', style: { gap: '6px' } }, list,
    h('button', { type: 'button', class: 'btn btn-sm btn-ghost', style: { alignSelf: 'flex-start' }, onclick: () => { if (rows.length < 6) add(); else toast('Como mucho 6 días por propuesta'); } }, h('span', { html: icon('plus', 14) }), 'Otro día'));
  return {
    el,
    get: () => rows.map((r) => ({ date: r.date.value, start: r.start.value || null, minutes: Number(r.mins.value) })).filter((o) => o.date),
  };
}

export async function datesDialog(app: App, circleId?: string) {
  const mgr = app.social;
  if (!mgr.snap.signedIn) { void import('./account').then((m) => m.accountDialog(app)); return; }
  const body = h('div', { class: 'so' });
  let busy = false;
  let composing = false;
  let countering = '';
  const pick = (): Circle | undefined => mgr.couples.find((c) => c.id === circleId) ?? mgr.couples.find((c) => c.circle_members.length >= 2) ?? mgr.couples[0];

  const busyRun = async (work: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    render();
    try { await work(); } catch (e) { toast(String((e as Error)?.message ?? e).replace(/^Error:\s*/, ''), { kind: 'error', ms: 7000 }); }
    finally { busy = false; render(); }
  };

  const when = (o: DateOption) => `${longDate(o.date, false)}${o.start ? ` · ${timeLabel(o.start)}` : ' · todo el día'}${o.minutes ? ` · ${duration(o.minutes)}` : ''}`;

  const card = (p: DateProposal): HTMLElement => {
    const fromMe = p.proposed_by === mgr.me;
    const open = p.status === 'open';
    const status = { open: 'Pendiente', accepted: 'Quedáis', declined: 'No puede', cancelled: 'Anulada' }[p.status];
    const opts = p.date_options.map((o) => {
      const theirs = o.proposed_by !== mgr.me;
      const chosen = p.status === 'accepted' && mgr.snap.events?.some((e) => e.id === p.event_id && e.date === o.date && (e.start ?? null) === o.start);
      return h('div', { class: 'so-opt' },
        h('span', { html: icon(chosen ? 'checkCircle' : 'calendar', 16), 'aria-hidden': 'true' }),
        h('div', { class: 'so-opt-main' }, h('span', {}, when(o)), h('span', { class: 'muted small' }, `${theirs ? mgr.personName(o.proposed_by) : 'Tú'} · ${relativeDate(o.date, todayISO())}`)),
        open && theirs ? h('button', { type: 'button', class: 'btn btn-sm btn-primary', disabled: busy, onclick: () => void busyRun(async () => {
          await mgr.run(() => api.SocialAccept(o.id!), `«${p.title}» añadida a la agenda de los dos`);
        }) }, 'Elegir') : null);
    });
    const counter = countering === p.id ? optionsEditor(1) : null;
    return h('div', { class: `so-date ${fromMe ? 'is-mine' : ''}` },
      h('div', { class: 'so-date-head' }, h('span', { html: icon('heart', 16), style: { color: 'var(--c-important)' }, 'aria-hidden': 'true' }),
        h('strong', {}, p.title), h('span', { class: `so-status is-${p.status}` }, status)),
      h('span', { class: 'muted small' }, fromMe ? 'La propusiste tú' : `Te la propone ${mgr.personName(p.proposed_by)}`),
      p.notes ? h('p', { class: 'small' }, p.notes) : null,
      ...opts,
      ...(counter ? [counter.el, h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { countering = ''; render(); } }, 'Cancelar'),
        h('button', { type: 'button', class: 'btn btn-sm btn-primary', disabled: busy, onclick: () => void busyRun(async () => {
          if (await mgr.run(() => api.SocialCounter(p.id, counter.get()), 'Días propuestos')) countering = '';
        }) }, 'Proponer estos días'))] : []),
      open && !counter ? h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { countering = p.id; render(); } }, fromMe ? 'Añadir días' : 'Proponer otros días'),
        h('div', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', disabled: busy, onclick: () => void busyRun(async () => {
          if (fromMe) { if (await confirmDialog('Anular la cita', `¿Anular «${p.title}»?`, 'Anular', true)) await mgr.run(() => api.SocialCloseProposal(p.id, 'cancelled'), 'Cita anulada'); }
          else await mgr.run(() => api.SocialCloseProposal(p.id, 'declined'), 'Le hemos dicho que no puedes');
        }) }, fromMe ? 'Anular' : 'No puedo')) : null);
  };

  const compose = (c: Circle): HTMLElement => {
    const title = h('input', { class: 'input', value: 'Cita', maxlength: '200', 'aria-label': 'Qué' });
    const notes = h('input', { class: 'input', placeholder: 'Cine, cena, paseo… (opcional)', maxlength: '500', 'aria-label': 'Detalles' });
    const opts = optionsEditor(2);
    setTimeout(() => title.select(), 30);
    return h('div', { class: 'so-date' },
      h('strong', {}, 'Nueva cita'),
      field('Qué', title), field('Detalles', notes),
      h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Días que te van bien'), opts.el,
        h('span', { class: 'muted small' }, 'Tu pareja elegirá uno (o te propondrá otros). La hora vacía significa todo el día.')),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { composing = false; render(); } }, 'Cancelar'),
        h('div', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-sm btn-primary', disabled: busy, onclick: () => void busyRun(async () => {
          const o = opts.get();
          if (!o.length) throw new Error('Elige al menos un día');
          if (await mgr.run(() => api.SocialProposeDate(c.id, title.value, notes.value, o), 'Cita propuesta: te avisaremos cuando elija')) composing = false;
        }) }, 'Proponer')));
  };

  const render = () => {
    const c = pick();
    if (!c) {
      body.replaceChildren(h('p', {}, 'Las citas son para círculos de pareja.'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { closeFn?.(null); void import('./circles').then((m) => m.circlesDialog(app, { kind: 'new' })); } }, 'Crear un círculo de pareja'));
      return;
    }
    if (c.circle_members.length < 2) {
      body.replaceChildren(h('p', {}, `Tu pareja todavía no se ha unido a «${c.name}».`),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { closeFn?.(null); void import('./circles').then((m) => m.circlesDialog(app, { kind: 'circle', id: c.id })); } }, 'Invitarla'));
      return;
    }
    const all = (mgr.snap.proposals ?? []).filter((p) => p.circle_id === c.id);
    const incoming = all.filter((p) => p.status === 'open' && p.date_options.some((o) => o.proposed_by !== mgr.me));
    const waiting = all.filter((p) => p.status === 'open' && !incoming.includes(p));
    const closed = all.filter((p) => p.status !== 'open').slice(0, 5);
    const partner = c.circle_members.find((m) => m.user_id !== mgr.me)?.profiles.name ?? 'tu pareja';
    body.replaceChildren(
      composing ? compose(c) : h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { composing = true; render(); } }, h('span', { html: icon('plus', 14) }), `Proponer una cita a ${partner}`),
      ...(incoming.length ? [h('div', { class: 'so-section' }, 'Por responder'), ...incoming.map(card)] : []),
      ...(waiting.length ? [h('div', { class: 'so-section' }, `Esperando a ${partner}`), ...waiting.map(card)] : []),
      ...(closed.length ? [h('div', { class: 'so-section' }, 'Últimas'), ...closed.map(card)] : []),
      ...(!all.length && !composing ? [h('p', { class: 'muted small' }, 'No hay citas. Se proponen varios días y la otra persona elige uno.')] : []));
  };
  let closeFn: ((v: null) => void) | undefined;
  const off = mgr.onChange(() => { if (!busy) render(); });
  render();
  void mgr.refresh();
  await modal('Citas', body, [{ label: 'Cerrar', value: null, kind: 'ghost' }], { className: 'is-small so-modal', onOpen: (cl) => { closeFn = cl; } });
  off();
}
