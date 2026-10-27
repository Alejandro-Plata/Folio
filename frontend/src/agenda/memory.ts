// Curva del olvido de un tema, plegada bajo cada tarea de estudio o repaso:
// qué se ha hecho con el tema, cuánto se recuerda ese día, cuándo tocaría el
// siguiente repaso según la valoración y los apuntes para abrirlos al momento.
import { api } from '../api';
import { on } from '../bus';
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import type { Forecast, Session, Task, Topic } from './model';
import { addDays, daysBetween, duration, relativeDate, shortDate } from './dates';
import { RATINGS, gap } from './ratings';
import { noteChip, pickNotesFor } from './notes';
import type { AgendaView } from './view';

/** Paneles abiertos: siguen abiertos aunque la vista se vuelva a pintar. */
const openPanels = new Set<string>();

let sessionsCache: Promise<Session[]> | null = null;
on('agenda:changed', () => { sessionsCache = null; });
const allSessions = () => (sessionsCache ??= api.AgendaSessions('', '').then((s) => s ?? []).catch(() => []));

const ordinal = (n: number) => (n === 1 || n === 3 ? `${n}.er` : `${n}.º`);

/** Frase corta para la cabecera plegada (sin pedir nada al backend). */
function summaryText(topic: Topic, t: Task): string {
  const reps = topic.memory?.Reps ?? 0;
  if (!topic.studied || !reps) return t.kind === 'review' ? 'Aún sin estudiar' : 'Primera vez';
  const last = topic.memory?.LastReview?.slice(0, 10) || topic.studied;
  const ago = daysBetween(last, t.date);
  const when = ago <= 0 ? 'hoy' : ago === 1 ? 'hace 1 día' : `hace ${ago} días`;
  // El primer estudio cuenta como repetición: el repaso n.º N llega con N repeticiones hechas
  return `${ordinal(reps)} repaso · último ${when}`;
}

/** Panel plegable para una tarea con tema; null si la tarea no tiene tema. */
export function memoryPanel(view: AgendaView, t: Task): HTMLElement | null {
  const topic = view.state.topic(t.topicId);
  if (!topic) return null;
  const key = t.id || `${t.topicId}@${t.date}`;
  const body = h('div', { class: 'ag-mem-body' });
  const details = h('details', { class: 'ag-mem' },
    h('summary', { class: 'ag-mem-sum' },
      h('span', { class: 'ag-mem-ic', html: icon('activity', 14), 'aria-hidden': 'true' }),
      h('span', { class: 'ag-mem-topic' }, `Tema ${topic.number}`),
      h('span', { class: 'ag-mem-hint' }, summaryText(topic, t)),
      h('span', { class: 'ag-mem-chev', html: icon('chevronDown', 14), 'aria-hidden': 'true' })),
    body) as HTMLDetailsElement;
  // Que tocar el panel no abra la tarea ni empiece un arrastre
  for (const ev of ['click', 'mousedown', 'touchstart'] as const) details.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
  let loaded = false;
  const load = async () => {
    loaded = true;
    body.replaceChildren(h('p', { class: 'muted small' }, 'Cargando…'));
    const [f, sessions] = await Promise.all([api.AgendaForecast(topic.id, t.date).catch(() => null), allSessions()]);
    const fresh = view.state.topic(topic.id) ?? topic;
    body.replaceChildren(...content(view, t, fresh, f, sessions.filter((s) => s.topicId === topic.id), () => void load()));
  };
  details.addEventListener('toggle', () => {
    if (details.open) { openPanels.add(key); if (!loaded) void load(); } else openPanels.delete(key);
  });
  if (openPanels.has(key)) { details.open = true; void load(); }
  return details;
}

function content(view: AgendaView, t: Task, topic: Topic, f: Forecast | null, sessions: Session[], reload: () => void): HTMLElement[] {
  const out: HTMLElement[] = [];
  const st = view.state;
  // 1. Historial
  const past = sessions.filter((s) => s.date <= t.date).sort((a, b) => (a.date < b.date ? 1 : -1));
  const hist = h('section', { class: 'ag-mem-sec' }, h('h4', {}, 'Historial'));
  if (!past.length) hist.append(h('p', { class: 'muted small' }, f && !f.new ? 'Sin sesiones registradas.' : 'Aún no lo has estudiado. Al marcar esta tarea como hecha empieza su curva.'));
  else {
    const first = sessions.reduce((a, s) => (s.date < a ? s.date : a), past[0].date);
    hist.append(h('p', { class: 'small' }, `Estudiado por primera vez el ${shortDate(first)} · ${past.length} ${past.length === 1 ? 'sesión' : 'sesiones'}${f?.lapses ? ` · olvidado ${f.lapses} ${f.lapses === 1 ? 'vez' : 'veces'}` : ''}`),
      h('ul', { class: 'ag-mem-hist' }, ...past.slice(0, 4).map((s) => {
        const r = RATINGS.find(([v]) => v === s.rating);
        return h('li', {},
          h('span', { class: 'ag-mem-date' }, relativeDate(s.date, st.today)),
          h('span', { class: 'muted' }, `${s.kind === 'review' ? 'Repaso' : s.kind === 'mock' ? 'Simulacro' : 'Estudio'} · ${duration(s.minutes)}`),
          r ? h('span', { class: `ag-mem-rate r${r[0]}` }, r[1]) : null,
          s.score != null ? h('span', { class: 'muted' }, `test ${String(s.score).replace('.', ',')}`) : null);
      })));
  }
  out.push(hist);

  // 2. Cuánto lo recuerdas
  if (f && !f.new && f.curve?.length) {
    const pct = Math.round(f.retention * 100);
    const isToday = t.date === st.today;
    const sec = h('section', { class: 'ag-mem-sec' }, h('h4', {}, isToday ? 'Cuánto lo recuerdas hoy' : `Cuánto lo recordarás ${relativeDate(t.date, st.today)}`),
      curveSvg(f, t.date),
      h('p', { class: 'small' }, `En torno al ${pct} %. `, h('span', { class: 'muted' },
        `Sin repasar, el recuerdo cae con el tiempo; Folio te propone el repaso cuando baja al ${Math.round(f.target * 100)} %${f.due ? ` (${f.due <= t.date ? 'ya toca' : `el ${shortDate(f.due)}`})` : ''}.`)));
    out.push(sec);
  }

  // 3. Próximo repaso según cómo vaya
  if (f && Object.keys(f.next).length) {
    out.push(h('section', { class: 'ag-mem-sec' }, h('h4', {}, 'Siguiente repaso según cómo te vaya'),
      h('div', { class: 'ag-mem-next' }, ...RATINGS.map(([v, label]) => {
        const d = f.next[String(v)];
        return d ? h('span', { class: `ag-mem-pill r${v}`, title: `${label}: el ${shortDate(d)}` }, h('strong', {}, label), ` ${gap(t.date, d)}`) : null;
      }))));
  }

  // 4. Notas y apuntes
  const lastNote = [...sessions].sort((a, b) => (a.date < b.date ? 1 : -1)).find((s) => s.note && s.date <= t.date);
  const files = topic.files ?? [];
  const doc = topic.docId ? view.app.docs.find((d) => d.id === topic.docId && !d.trashed) : undefined;
  const notes = h('section', { class: 'ag-mem-sec' }, h('h4', {}, 'Notas y apuntes'));
  if (lastNote) notes.append(h('blockquote', { class: 'ag-mem-note' }, lastNote.note!, h('span', { class: 'muted small' }, ` — ${relativeDate(lastNote.date, st.today)}`)));
  notes.append(h('div', { class: 'ag-notes' },
    ...files.map((x) => noteChip(x)),
    doc ? h('button', { type: 'button', class: 'ag-note-open ag-note', onclick: async () => { await view.app.setMode('docs'); await view.app.open(doc.id); } },
      h('span', { html: icon('docs', 14), 'aria-hidden': 'true' }), h('span', { class: 'ag-note-name' }, doc.title || 'Sin título')) : null,
    h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: async () => { if (await pickNotesFor(view, topic)) reload(); } },
      h('span', { html: icon('plus', 14), 'aria-hidden': 'true' }), files.length || doc ? 'Añadir' : 'Añadir apuntes')));
  out.push(notes);
  return out;
}

/** Curva del olvido: recuerdo desde el último repaso, con la fecha de la tarea marcada. */
function curveSvg(f: Forecast, date: string): SVGSVGElement {
  const W = 300, H = 84, L = 26, R = 8, T = 8, B = 18;
  const curve = f.curve ?? [];
  const n = curve.length - 1;
  const x = (d: number) => L + (d / n) * (W - L - R);
  const y = (r: number) => T + (1 - r) * (H - T - B);
  const ns = 'http://www.w3.org/2000/svg';
  const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text) e.textContent = text;
    return e;
  };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ag-mem-curve', role: 'img',
    'aria-label': `Curva del olvido: hoy en torno al ${Math.round(f.retention * 100)} %` });
  for (const r of [1, 0.5]) {
    svg.append(el('line', { x1: L, x2: W - R, y1: y(r), y2: y(r), class: 'grid' }), el('text', { x: L - 4, y: y(r) + 3, class: 'axis', 'text-anchor': 'end' }, `${r * 100}%`));
  }
  svg.append(el('line', { x1: L, x2: W - R, y1: y(f.target), y2: y(f.target), class: 'target' }));
  svg.append(el('path', { d: curve.map((r, d) => `${d ? 'L' : 'M'}${x(d).toFixed(1)},${y(r).toFixed(1)}`).join(''), class: 'line' }));
  if (f.curveFrom) {
    svg.append(el('text', { x: L, y: H - 4, class: 'axis' }, shortDate(f.curveFrom)));
    if (f.due) {
      const dd = daysBetween(f.curveFrom, f.due);
      if (dd > 0 && dd <= n) svg.append(el('line', { x1: x(dd), x2: x(dd), y1: T, y2: H - B, class: 'due' }));
    }
    const at = daysBetween(f.curveFrom, date);
    if (at >= 0 && at <= n) {
      svg.append(el('line', { x1: x(at), x2: x(at), y1: y(curve[at]), y2: H - B, class: 'now' }),
        el('circle', { cx: x(at), cy: y(curve[at]), r: 4, class: 'dot' }),
        el('text', { x: Math.min(x(at), W - R - 30), y: H - 4, class: 'axis strong' }, at === 0 ? 'ese día' : shortDate(addDays(f.curveFrom, at))));
    }
  }
  return svg;
}
