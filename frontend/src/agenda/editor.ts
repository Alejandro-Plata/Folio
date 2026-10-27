// Diálogo de tarea: crear, editar o crear la misma tarea en varios días.
import type { App } from '../app';
import { h, modal } from '../ui/dom';
import { icon } from '../ui/icons';
import type { Repeat, Scope, Task } from './model';
import { WEEKDAYS, WEEKDAYS_LETTER, longDate, shortDate, weekday } from './dates';
import { durationField, timeField } from './timepicker';
import { suggestDurations, suggestStarts } from './suggest';
import { memoryPanel } from './memory';
import { noteChip } from './notes';
import type { AgendaView } from './view';

export interface TaskDialogOpts {
  task?: Task;
  date?: string;
  start?: string;
  minutes?: number;
  /** Crear la misma tarea en varios días. */
  dates?: string[];
  /** Valores propuestos (barra rápida, dictado). */
  draft?: Partial<Task>;
  /** Crear el evento directamente en este círculo. */
  circleId?: string;
}

/** Pregunta a qué ocurrencias afecta un cambio en una serie. */
export async function askScope(title: string): Promise<Scope | null> {
  return modal<Scope>(title, h('p', { class: 'modal-text' }, 'Esta tarea se repite. ¿A qué días afecta el cambio?'), [
    { label: 'Cancelar', value: null, kind: 'ghost' },
    { label: 'Toda la serie', value: 'all' },
    { label: 'Esta y las siguientes', value: 'following' },
    { label: 'Solo esta', value: 'one', kind: 'primary' },
  ]);
}

export async function taskDialog(view: AgendaView, app: App, opts: TaskDialogOpts) {
  const st = view.state;
  const editing = opts.task;
  const base: Task = editing ? { ...editing } : {
    id: '', title: '', typeId: st.types.find((t) => t.id === 'personal')?.id ?? st.types[st.types.length - 1]?.id ?? '',
    date: opts.date ?? opts.dates?.[0] ?? view.cursor, start: opts.start, minutes: opts.minutes, done: false, ...opts.draft,
  } as Task;
  const multi = opts.dates && opts.dates.length > 1 ? opts.dates : null;

  // ---------- Campos ----------
  const title = h('input', { class: 'input', value: base.title, placeholder: 'Qué vas a hacer', 'aria-label': 'Título' });
  const typeBox = h('div', { class: 'ag-types', role: 'radiogroup', 'aria-label': 'Tipo y prioridad' });
  let typeId = base.typeId;
  const drawTypes = () => {
    typeBox.replaceChildren(...st.types.map((t) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(t.id === typeId), class: `ag-type ${t.id === typeId ? 'on' : ''}`,
      style: { '--c': t.color }, title: `Prioridad ${t.priority}${t.countsAsStudy ? ' · cuenta como estudio' : ''}`,
      onclick: () => { typeId = t.id; drawTypes(); refreshSuggestions(); },
    },
    // La muestra lleva el color y la trama del tipo (se distingue también sin color)
    h('span', { class: `ag-type-dot pat-${t.pattern}`, 'aria-hidden': 'true' }),
    h('span', { class: 'ag-type-name' }, t.name),
    h('span', { class: 'ag-type-p', 'aria-label': `prioridad ${t.priority}` }, String(t.priority)))));
  };
  drawTypes();

  const date = h('input', { class: 'input input-sm', type: 'date', value: base.date, 'aria-label': 'Fecha' });
  const startF = timeField({ label: 'hora de inicio', value: base.start ?? '', allowEmpty: true });
  const durF = durationField({ label: 'duración', value: base.minutes ?? 0, allowEmpty: true });
  const refreshSuggestions = () => {
    if (!st.settings.suggestions) { startF.setSuggestions([]); durF.setSuggestions([]); return; }
    const wd = weekday(date.value || base.date);
    startF.setSuggestions(suggestStarts(st.recent, st.today, { typeId, weekday: wd, exclude: startF.input.value ? undefined : '' }));
    durF.setSuggestions(suggestDurations(st.recent, st.recentSessions, st.today, { typeId }));
  };
  date.addEventListener('change', refreshSuggestions);
  refreshSuggestions();

  // Repetición
  const rep: Repeat | null = base.repeat ? { ...base.repeat } : null;
  const repSel = h('select', { class: 'input input-sm', 'aria-label': 'Repetir' },
    ...[['none', 'No se repite'], ['daily', 'Cada día'], ['weekdays', 'De lunes a viernes'], ['weekly', 'Cada semana…'], ['monthly', 'Cada mes']].map(([v, l]) => h('option', { value: v }, l)));
  const every = h('input', { class: 'input input-sm ag-every', type: 'number', min: '1', max: '52', value: String(rep?.interval ?? 1), 'aria-label': 'Cada cuántas' });
  const until = h('input', { class: 'input input-sm', type: 'date', value: rep?.until ?? '', 'aria-label': 'Hasta (opcional)' });
  let days = new Set(rep?.weekdays ?? [weekday(base.date)]);
  const dayBtns = h('div', { class: 'ag-wdays', role: 'group', 'aria-label': 'Días de la semana' });
  const drawDays = () => dayBtns.replaceChildren(...WEEKDAYS_LETTER.map((l, i) => h('button', {
    type: 'button', class: `ag-wday ${days.has(i + 1) ? 'on' : ''}`, 'aria-pressed': String(days.has(i + 1)), title: WEEKDAYS[i],
    onclick: () => { if (days.has(i + 1) && days.size > 1) days.delete(i + 1); else days.add(i + 1); drawDays(); },
  }, l)));
  drawDays();
  repSel.value = !rep ? 'none' : rep.freq === 'weekly' && JSON.stringify(rep.weekdays) === '[1,2,3,4,5]' && rep.interval === 1 ? 'weekdays' : rep.freq;
  const repDetail = h('div', { class: 'ag-rep-detail' },
    h('label', { class: 'ag-inline' }, 'Cada', every, h('span', { class: 'ag-every-unit' })),
    dayBtns,
    h('label', { class: 'ag-inline' }, 'Hasta', until));
  const syncRep = () => {
    const v = repSel.value;
    dayBtns.hidden = v !== 'weekly';
    (repDetail.querySelector('.ag-every-unit') as HTMLElement).textContent = v === 'monthly' ? 'meses' : v === 'daily' ? 'días' : 'semanas';
    repDetail.hidden = v === 'none';
  };
  repSel.addEventListener('change', syncRep);
  syncRep();

  // Tema y documento
  const topicSel = h('select', { class: 'input input-sm', 'aria-label': 'Tema del temario' },
    h('option', { value: '' }, 'Ninguno'),
    ...st.topics.filter((t) => !t.archived).map((t) => h('option', { value: t.id, selected: t.id === base.topicId }, `Tema ${t.number}. ${t.title}`)));
  const docSel = h('select', { class: 'input input-sm', 'aria-label': 'Documento de apuntes' },
    h('option', { value: '' }, 'Ninguno'),
    ...app.docs.filter((d) => !d.trashed).map((d) => h('option', { value: d.id, selected: d.id === base.docId }, d.title || 'Sin título')));
  const openDoc = h('button', { type: 'button', class: 'btn btn-sm btn-ghost', title: 'Abrir los apuntes', onclick: () => { if (docSel.value) { app.setMode('docs'); void app.open(docSel.value); close?.(null); } } }, h('span', { html: icon('file', 14) }), 'Abrir');
  // Con tema, los apuntes son los del tema (se gestionan en el temario); sin tema, se puede enlazar un documento
  const docPicker = h('div', { class: 'ag-inline' }, docSel, openDoc);
  const topicNotes = h('div', { class: 'ag-notes' });
  const syncNotes = () => {
    const tp = st.topic(topicSel.value);
    docPicker.hidden = !!tp;
    topicNotes.hidden = !tp;
    if (!tp) return;
    const doc = tp.docId ? app.docs.find((d) => d.id === tp.docId && !d.trashed) : undefined;
    topicNotes.replaceChildren(...[...(tp.files ?? []).map((f) => noteChip(f)),
      doc ? h('button', { type: 'button', class: 'ag-note ag-note-open', onclick: () => { app.setMode('docs'); void app.open(doc.id); close?.(null); } }, h('span', { html: icon('docs', 14) }), h('span', { class: 'ag-note-name' }, doc.title || 'Sin título')) : null,
      !(tp.files?.length || doc) ? h('span', { class: 'muted small' }, 'Sin apuntes. Se añaden desde Temario.') : null].filter((x): x is HTMLElement => !!x));
  };
  topicSel.addEventListener('change', syncNotes);
  syncNotes();
  const memory = editing && editing.topicId ? memoryPanel(view, editing) : null;
  const notes = h('textarea', { class: 'input', rows: 2, placeholder: 'Notas (opcional)', 'aria-label': 'Notas' }, base.notes ?? '');
  const pinned = h('input', { type: 'checkbox', checked: !!base.pinned });

  const field = (label: string, ...c: (HTMLElement | null)[]) => h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, label), ...c);
  // Quién lo ve: solo tú (se queda en tus dispositivos) o un círculo (lo ven todos sus miembros)
  const circles = app.social.snap.signedIn ? app.social.circles : [];
  let circleId = base.circle?.id ?? opts.circleId ?? '';
  const whoBox = h('div', { class: 'ag-types', role: 'radiogroup', 'aria-label': 'Quién lo ve' });
  const privateOnly: HTMLElement[] = [];
  const priv = <T extends HTMLElement | null>(el: T): T => { if (el) privateOnly.push(el); return el; };
  const drawWho = () => {
    whoBox.replaceChildren(
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(!circleId), class: `ag-type ${!circleId ? 'on' : ''}`, style: { '--c': 'var(--text-muted)' }, onclick: () => { circleId = ''; drawWho(); } },
        h('span', { html: icon('user', 14) }), h('span', { class: 'ag-type-name' }, 'Solo yo')),
      ...circles.map((c) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(circleId === c.id), class: `ag-type ${circleId === c.id ? 'on' : ''}`, style: { '--c': c.color },
        title: `Lo verán ${c.circle_members.map((m) => m.profiles.name || m.profiles.email).join(', ')}`, onclick: () => { circleId = c.id; drawWho(); } },
      h('span', { html: icon(c.kind === 'couple' ? 'heart' : 'users', 14) }), h('span', { class: 'ag-type-name' }, c.name))));
    for (const el of privateOnly) el.hidden = !!circleId;
  };
  const sharedInfo = base.circle && !base.circle.mine && base.circle.by
    ? h('p', { class: 'muted small' }, h('span', { html: icon(base.circle.kind === 'couple' ? 'heart' : 'users', 12) }), ` Lo creó ${base.circle.by} en «${base.circle.name}». Los cambios los verá todo el círculo.`)
    : null;

  const body = h('div', { class: 'ag-form' },
    field('Título', title),
    circles.length || base.circle ? field('Quién lo ve', whoBox) : null,
    sharedInfo,
    priv(field('Tipo', typeBox)),
    multi
      ? field('Días', h('p', { class: 'ag-multi' }, `${multi.length} días: ${multi.slice(0, 6).map(shortDate).join(', ')}${multi.length > 6 ? '…' : ''}`))
      : h('div', { class: 'ag-row' }, field('Fecha', date), field('Inicio', startF.el), field('Duración', durF.el)),
    multi ? h('div', { class: 'ag-row' }, field('Inicio', startF.el), field('Duración', durF.el)) : null,
    multi ? null : priv(h('div', { class: 'ag-row' }, field('Repetir', repSel), repDetail)),
    priv(st.topics.length ? h('div', { class: 'ag-row' }, field('Tema', topicSel), field('Apuntes', docPicker, topicNotes)) : field('Apuntes', docPicker)),
    priv(memory),
    field('Notas', notes),
    priv(base.auto ? h('label', { class: 'ag-check', title: 'El planificador no moverá ni borrará esta tarea' }, pinned, 'Fijar: que el plan no la cambie') : null),
    editing?.occurrenceOf || editing?.repeat ? h('p', { class: 'muted small' }, h('span', { html: icon('repeat', 12) }), ' Esta tarea se repite. Al guardar podrás elegir si el cambio afecta solo a este día.') : null,
  );

  drawWho();
  let close: ((v: any) => void) | undefined;
  const buttons = [
    ...(editing ? [{ label: 'Eliminar', value: 'delete', kind: 'ghost' as const }] : []),
    { label: 'Cancelar', value: null, kind: 'ghost' as const },
    { label: editing ? 'Guardar' : multi ? `Crear en ${multi.length} días` : 'Crear', value: 'save', kind: 'primary' as const },
  ];
  const res = await modal<'save' | 'delete'>(editing ? (editing.circle ? 'Editar evento compartido' : 'Editar tarea') : multi ? 'Nueva tarea en varios días' : `Nueva tarea · ${longDate(base.date, false)}`, body, buttons, {
    className: 'ag-modal',
    onOpen: (c) => {
      close = c;
      setTimeout(() => (editing ? title : title).focus(), 30);
      body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || (e.target === title))) { e.preventDefault(); c('save'); } });
    },
  });
  if (res === 'delete' && editing) { await view.deleteTask(editing); return; }
  if (res !== 'save') return;

  const startV = startF.value;
  const minutesV = durF.value;
  let repeat: Repeat | null = null;
  const rv = repSel.value;
  if (!multi && rv !== 'none') {
    repeat = {
      freq: rv === 'weekdays' || rv === 'weekly' ? 'weekly' : (rv as 'daily' | 'monthly'),
      interval: Math.max(1, Number(every.value) || 1),
      weekdays: rv === 'weekdays' ? [1, 2, 3, 4, 5] : rv === 'weekly' ? [...days].sort() : undefined,
      until: until.value || undefined,
      except: rep?.except, done: rep?.done,
    };
  }
  const t: Task = {
    ...base,
    title: title.value.trim() || st.type(typeId).name,
    typeId, date: date.value || base.date, start: startV || undefined, minutes: minutesV || undefined,
    notes: notes.value.trim() || undefined, topicId: topicSel.value || undefined, docId: docSel.value || undefined,
    pinned: base.auto ? pinned.checked : base.pinned,
    kind: base.kind || (topicSel.value ? (typeId === 'review' ? 'review' : typeId === 'study' ? 'study' : '') : '') as Task['kind'],
  };
  if (circleId) {
    // Evento del círculo: sin tipo, repetición ni tema (eso es de tu estudio)
    Object.assign(t, { circle: { id: circleId }, typeId: `circle:${circleId}`, repeat: null, topicId: undefined, docId: undefined, kind: '', auto: false });
    const name = circles.find((c) => c.id === circleId)?.name ?? 'el círculo';
    if (multi) await st.saveTasks(multi.map((d) => ({ ...t, id: '', date: d })), `Evento creado en ${multi.length} días para «${name}»`);
    else await st.saveTask(t, 'one', editing ? 'Evento guardado' : `Evento creado para «${name}»`);
    if (multi) view.select([], 'replace');
    return;
  }
  t.circle = undefined;
  if (base.circle && t.typeId.startsWith('circle:')) t.typeId = st.types.find((x) => x.id === 'personal')?.id ?? st.types[st.types.length - 1]?.id ?? '';
  if (multi) {
    await st.saveTasks(multi.map((d) => ({ ...t, id: '', date: d, repeat: null })), `Tarea creada en ${multi.length} días`);
    view.select([], 'replace');
    return;
  }
  if (repeat || !t.occurrenceOf) t.repeat = repeat;
  let scope: Scope = 'one';
  if (editing?.occurrenceOf) {
    const s = await askScope('Guardar una tarea que se repite');
    if (!s) return;
    scope = s;
    if (scope === 'one') t.repeat = null;
  }
  await st.saveTask(t, scope, editing ? 'Tarea guardada' : `Tarea creada · ${longDate(t.date, false)}`);
}
