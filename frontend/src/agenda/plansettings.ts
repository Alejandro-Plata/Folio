// Plan de estudio: fecha del examen, tiempo de estudio de cada día de la
// semana (horas, franja o ambas, todo elegible, con sugerencias según lo que
// se suele estudiar), duración de bloques y repasos, fase final y retención.
import { h, modal, toast } from '../ui/dom';
import { isAndroid } from '../platform/platform';
import { REMIND_CHOICES, getRemindMinutes } from '../platform/reminders';
import { icon } from '../ui/icons';
import type { PlanSettings } from './model';
import { WEEKDAYS, duration, longDate } from './dates';
import { durationField, timeField } from './timepicker';
import { suggestCapacity, suggestDurations } from './suggest';
import type { AgendaView } from './view';

export async function planDialog(view: AgendaView) {
  const st = view.state;
  const app = () => view.app;
  const s: PlanSettings = JSON.parse(JSON.stringify(st.settings));
  const sugg = s.suggestions;

  const exam = h('input', { class: 'input input-sm', type: 'date', value: s.examDate, 'aria-label': 'Fecha del examen', min: st.today });
  const mode = h('div', { class: 'ag-seg', role: 'radiogroup', 'aria-label': 'Cómo se mide el tiempo de estudio' });
  const modes: [PlanSettings['capacityMode'], string, string][] = [
    ['hours', 'Horas por día', 'Por ejemplo, 3 h los lunes, a cualquier hora'],
    ['window', 'Franja horaria', 'Por ejemplo, de 16:00 a 20:00'],
    ['both', 'Franja con máximo', 'Una franja, sin pasar de cierto número de horas'],
  ];
  const drawMode = () => mode.replaceChildren(...modes.map(([v, l, hint]) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(s.capacityMode === v), class: `ag-seg-btn ${s.capacityMode === v ? 'on' : ''}`, title: hint,
    onclick: () => { s.capacityMode = v; drawMode(); drawDays(); },
  }, l)));
  drawMode();

  const days = h('div', { class: 'ag-days', role: 'table', 'aria-label': 'Tiempo de estudio por día' });
  const drawDays = () => {
    const showHours = s.capacityMode !== 'window';
    const showWin = s.capacityMode !== 'hours';
    days.replaceChildren(h('div', { class: 'ag-days-row ag-days-head', role: 'row' },
      h('span', { role: 'columnheader' }, 'Día'), h('span', { role: 'columnheader' }, 'Estudio'),
      showHours ? h('span', { role: 'columnheader' }, s.capacityMode === 'both' ? 'Máximo' : 'Horas') : null,
      showWin ? h('span', { role: 'columnheader' }, 'Desde') : null, showWin ? h('span', { role: 'columnheader' }, 'Hasta') : null));
    for (let wd = 1; wd <= 7; wd++) {
      const key = String(wd);
      const rest = s.restDays.includes(wd);
      const on = h('input', { type: 'checkbox', checked: !rest, 'aria-label': `Estudiar los ${WEEKDAYS[wd - 1]}` });
      on.addEventListener('change', () => { s.restDays = on.checked ? s.restDays.filter((x) => x !== wd) : [...s.restDays, wd]; drawDays(); });
      const row = h('div', { class: `ag-days-row ${rest ? 'is-rest' : ''}`, role: 'row' },
        h('span', { class: 'ag-days-name', role: 'rowheader' }, WEEKDAYS[wd - 1]),
        h('label', { class: 'ag-check' }, on, rest ? 'Descanso' : 'Sí'));
      if (showHours) {
        const f = durationField({ label: `horas de estudio los ${WEEKDAYS[wd - 1]}`, value: s.capacity[key] ?? 0, suggestions: sugg ? suggestCapacity(st.recentSessions, st.today, wd, s.capacity[key] ?? 0) : [], onChange: (v) => { s.capacity[key] = v; total(); } });
        row.append(rest ? h('span', { class: 'muted' }, '—') : f.el);
      }
      if (showWin) {
        const w = s.windows[key] ?? { start: '16:00', end: '20:00' };
        s.windows[key] = w;
        const a = timeField({ label: `inicio de la franja los ${WEEKDAYS[wd - 1]}`, value: w.start, suggestions: sugg ? ['09:00', '16:00', '17:00'].filter((x) => x !== w.start) : [], onChange: (v) => { w.start = v; total(); } });
        const b = timeField({ label: `fin de la franja los ${WEEKDAYS[wd - 1]}`, value: w.end, suggestions: sugg ? ['14:00', '20:00', '21:00'].filter((x) => x !== w.end) : [], onChange: (v) => { w.end = v; total(); } });
        row.append(rest ? h('span', { class: 'muted' }, '—') : a.el, rest ? h('span') : b.el);
      }
      days.append(row);
    }
    total();
  };
  const totalEl = h('p', { class: 'ag-total', 'aria-live': 'polite' });
  const total = () => {
    let mins = 0;
    for (let wd = 1; wd <= 7; wd++) {
      if (s.restDays.includes(wd)) continue;
      const key = String(wd);
      const w = s.windows[key];
      const win = w ? Math.max(0, toMin(w.end) - toMin(w.start)) : 0;
      mins += s.capacityMode === 'hours' ? (s.capacity[key] ?? 0) : s.capacityMode === 'window' ? win : Math.min(s.capacity[key] ?? 0, win || Infinity);
    }
    totalEl.textContent = `Total: ${duration(mins)} de estudio a la semana`;
  };
  drawDays();

  const durSugg = (typeId: string) => sugg ? suggestDurations(st.recent, st.recentSessions, st.today, { typeId }) : [];
  const block = durationField({ label: 'bloque de estudio', value: s.blockMinutes, suggestions: durSugg('study'), onChange: (v) => { s.blockMinutes = v; } });
  const review = durationField({ label: 'repaso de un tema', value: s.reviewMinutes, suggestions: durSugg('review'), onChange: (v) => { s.reviewMinutes = v; } });
  const brk = durationField({ label: 'descanso entre bloques', value: s.breakMinutes, suggestions: sugg ? [5, 10, 15] : [], onChange: (v) => { s.breakMinutes = v; } });
  const finalDays = h('input', { class: 'input input-sm ag-num', type: 'number', min: '0', max: '120', value: String(s.finalPhaseDays), 'aria-label': 'Días de la fase final' });
  const minReviews = h('input', { class: 'input input-sm ag-num', type: 'number', min: '0', max: '20', value: String(s.minReviews), 'aria-label': 'Repasos mínimos por tema' });
  const retention = h('select', { class: 'input input-sm', 'aria-label': 'Retención objetivo' },
    ...[[0.85, '85 % · menos repasos'], [0.9, '90 % · recomendado'], [0.95, '95 % · más repasos']].map(([v, l]) => h('option', { value: String(v), selected: Math.abs(s.retention - (v as number)) < 0.001 }, l as string)));
  const dayStart = timeField({ label: 'inicio del día visible', value: s.dayStart, onChange: (v) => { s.dayStart = v; } });
  const dayEnd = timeField({ label: 'fin del día visible', value: s.dayEnd, onChange: (v) => { s.dayEnd = v; } });
  const suggestOn = h('input', { type: 'checkbox', checked: s.suggestions });
  const remindSel = h('select', { class: 'input input-sm', 'aria-label': 'Avisarme antes de cada tarea' },
    ...REMIND_CHOICES.map((m) => h('option', { value: String(m), selected: m === getRemindMinutes() }, m ? `${m} minutos antes` : 'No avisar')));
  remindSel.addEventListener('change', async () => {
    const ok = await app().reminders.setMinutes(Number(remindSel.value));
    if (!ok) { remindSel.value = '0'; toast('Sin permiso para las notificaciones: actívalo en los ajustes de Android.', { kind: 'error', ms: 6000 }); }
  });

  const field = (label: string, c: HTMLElement, hint?: string) => h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, label), c, hint ? h('span', { class: 'muted small' }, hint) : null);
  const report = st.lastReport;
  const body = h('div', { class: 'ag-form ag-plan' },
    h('div', { class: 'ag-row' },
      field('Fecha del examen', exam, s.examDate ? longDate(s.examDate) : 'Sin fecha: se planifican los próximos 4 meses'),
      field('Fase final (días)', finalDays, 'Solo repasos y simulacros'),
      field('Repasos mínimos por tema', minReviews)),
    h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Tiempo de estudio'), mode),
    days, totalEl,
    h('div', { class: 'ag-row' },
      field('Bloque de estudio', block.el),
      field('Repaso de un tema', review.el),
      field('Descanso entre bloques', brk.el)),
    h('details', { class: 'ag-more-opts' },
      h('summary', {}, 'Más opciones'),
      h('div', { class: 'ag-row' },
        field('Retención objetivo', retention, 'Probabilidad de recordar cada tema el día del repaso'),
        field('Día visible desde', dayStart.el), field('hasta', dayEnd.el)),
      h('label', { class: 'ag-check' }, suggestOn, 'Mostrar sugerencias según mis últimas acciones'),
      ...(isAndroid ? [field('Avisarme antes de cada tarea (solo este móvil)', remindSel, 'Recibirás una notificación con la hora de la tarea.')] : [])),
    report?.warnings?.length ? h('div', { class: 'ag-banner is-inline' }, h('span', { class: 'ag-banner-ic', html: icon('alert', 16) }), h('div', {}, ...report.warnings.map((w) => h('p', {}, w)))) : null,
  );
  const res = await modal('Plan de estudio', body, [
    { label: 'Cancelar', value: null, kind: 'ghost' },
    { label: 'Guardar y planificar', value: 'ok', kind: 'primary' },
  ], { wide: true, className: 'ag-modal' });
  if (res !== 'ok') return;
  s.examDate = exam.value;
  s.blockMinutes = block.value || 50;
  s.reviewMinutes = review.value || 25;
  s.breakMinutes = brk.value;
  s.finalPhaseDays = Math.max(0, Number(finalDays.value) || 0);
  s.minReviews = Math.max(0, Number(minReviews.value) || 0);
  s.retention = Number(retention.value);
  s.dayStart = dayStart.value || '07:00';
  s.dayEnd = dayEnd.value || '23:00';
  s.suggestions = suggestOn.checked;
  await st.setSettings(s, false);
  await st.plan();
}

const toMin = (t: string) => { const [a, b] = t.split(':').map(Number); return a * 60 + (b || 0); };
