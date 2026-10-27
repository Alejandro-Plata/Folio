// Tarjeta para marcar una tarea de estudio como hecha: minutos reales,
// valoración (para la repetición espaciada), nota de test y comentario.
// Intro acepta los valores propuestos.
import { h, modal } from '../ui/dom';
import type { Task } from './model';
import { minutesOf } from './dates';
import { durationField, timeField } from './timepicker';
import { suggestDurations } from './suggest';
import type { AgendaView } from './view';
import { api } from '../api';
import { RATINGS, gap } from './ratings';


export async function doneDialog(view: AgendaView, t: Task) {
  const st = view.state;
  const topic = st.topic(t.topicId);
  const isMock = t.kind === 'mock';
  let rating = topic ? 3 : 0;
  const mins = durationField({ label: 'minutos reales', value: t.minutes || st.settings.blockMinutes, suggestions: suggestDurations(st.recent, st.recentSessions, st.today, { typeId: t.typeId, exclude: t.minutes }) });
  const at = timeField({ label: 'hora a la que empezaste', value: t.start ?? '', allowEmpty: true, compact: true });
  const score = h('input', { class: 'input input-sm ag-score', type: 'number', min: '0', max: '10', step: '0.25', placeholder: '—', 'aria-label': 'Nota del test sobre 10' });
  const note = h('input', { class: 'input input-sm', placeholder: 'Qué ha costado, qué repasar… (opcional)', 'aria-label': 'Comentario' });
  const ratingBox = h('div', { class: 'ag-rating', role: 'radiogroup', 'aria-label': '¿Qué tal lo recordabas?' });
  let next: Record<string, string> = {};
  const drawRating = () => ratingBox.replaceChildren(...RATINGS.map(([v, label, hint]) => h('button', {
    type: 'button', role: 'radio', class: `ag-rate r${v} ${rating === v ? 'on' : ''}`, 'aria-checked': String(rating === v), title: `${hint} (tecla ${v})`,
    onclick: () => { rating = v; drawRating(); },
  }, h('span', { class: 'ag-rate-k' }, String(v)), label, next[String(v)] ? h('span', { class: 'ag-rate-next' }, `repaso ${gap(t.date, next[String(v)])}`) : null)));
  drawRating();
  // Cuándo tocaría el siguiente repaso con cada valoración
  if (topic) void api.AgendaForecast(topic.id, t.date).then((f) => { next = f?.next ?? {}; drawRating(); }).catch(() => {});

  const body = h('div', { class: 'ag-form' },
    h('p', { class: 'ag-done-title' }, t.title),
    h('div', { class: 'ag-row' },
      h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Tiempo dedicado'), mins.el),
      h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Empezaste a las'), at.el)),
    topic ? h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, `¿Qué tal recordabas el tema ${topic.number}?`), ratingBox,
      h('p', { class: 'muted small' }, 'Con esto se calcula cuándo toca el siguiente repaso.')) : null,
    isMock || topic ? h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Nota del test (opcional)'), h('div', { class: 'ag-inline' }, score, h('span', { class: 'muted small' }, 'sobre 10'))) : null,
    h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Comentario'), note),
  );
  const res = await modal<'save' | 'skip'>('Marcar como hecha', body, [
    { label: 'Cancelar', value: null, kind: 'ghost' },
    { label: 'Solo marcar', value: 'skip' },
    { label: 'Guardar', value: 'save', kind: 'primary' },
  ], {
    className: 'ag-modal ag-done-modal',
    onOpen: (close) => {
      setTimeout(() => mins.input.focus(), 30);
      body.addEventListener('keydown', (e) => {
        if (topic && /^[1-4]$/.test(e.key) && !(e.target instanceof HTMLInputElement)) { rating = Number(e.key); drawRating(); }
        if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); close('save'); }
      });
    },
  });
  if (!res) return;
  if (res === 'skip') { await st.setDone(t.id, true); view.announce(`«${t.title}» hecha`); return; }
  const s = score.value.trim() ? Math.max(0, Math.min(10, Number(score.value.replace(',', '.')))) : null;
  await st.logSession({
    id: '', taskId: t.id, topicId: topic?.id, typeId: t.typeId, kind: t.kind, date: t.date,
    start: minutesOf(at.value) >= 0 ? at.value : undefined, minutes: mins.value, rating: topic ? rating : 0, score: s, note: note.value.trim() || undefined,
  }, topic ? `Hecho. ${rating === 1 ? 'El tema se repasará pronto.' : 'El plan se ha ajustado a tu valoración.'}` : 'Hecho');
}
