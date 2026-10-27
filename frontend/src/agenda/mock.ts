// Agenda simulada en localStorage para desarrollar la interfaz en el navegador
// (npm run dev). Imita el comportamiento del paquete Go internal/agenda, con un
// planificador simplificado (intervalos fijos en vez de FSRS).
import type { AgendaInitData, Forecast, PlanReport, PlanSettings, Repeat, Scope, Session, Task, TaskType, Topic, WeekTemplate } from './model';
import { addDays, daysBetween, hhmm, minutesOf, todayISO, weekday } from './dates';

const KEY = 'folio-mock-agenda-v1';

interface DB { tasks: Record<string, Task>; types: TaskType[]; settings: PlanSettings; topics: Topic[]; sessions: Session[]; templates: WeekTemplate[] }

const DEFAULT_TYPES: TaskType[] = [
  { id: 'mock', name: 'Simulacro / examen', priority: 1, color: '#c33b3b', icon: 'target', pattern: 'grid', countsAsStudy: true, fixed: true },
  { id: 'review', name: 'Repaso', priority: 2, color: '#2f74c0', icon: 'history', pattern: 'stripes', countsAsStudy: true, fixed: false },
  { id: 'study', name: 'Estudio nuevo', priority: 3, color: '#2e8b4e', icon: 'bookOpen', pattern: 'solid', countsAsStudy: true, fixed: false },
  { id: 'work', name: 'Clase / trabajo', priority: 4, color: '#a87700', icon: 'graduation', pattern: 'dots', countsAsStudy: false, fixed: true },
  { id: 'personal', name: 'Personal', priority: 5, color: '#7552c4', icon: 'users', pattern: 'solid', countsAsStudy: false, fixed: false },
];

function defaultSettings(): PlanSettings {
  const w = { start: '16:00', end: '20:00' };
  return {
    examDate: '', capacityMode: 'both',
    capacity: { 1: 180, 2: 180, 3: 180, 4: 180, 5: 150, 6: 240, 7: 0 },
    windows: { 1: w, 2: w, 3: w, 4: w, 5: w, 6: { start: '09:30', end: '14:00' }, 7: { start: '10:00', end: '13:00' } },
    restDays: [7], blockMinutes: 50, reviewMinutes: 25, breakMinutes: 10, retention: 0.9, finalPhaseDays: 21, minReviews: 3,
    suggestions: true, dayStart: '07:00', dayEnd: '23:00',
  };
}

let db: DB = load();
const undo: string[] = [];
let practiceBackup: string | null = null;

function load(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return { tasks: {}, types: DEFAULT_TYPES, settings: defaultSettings(), topics: [], sessions: [], templates: [] };
}
function persist() { if (practiceBackup) return; try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* */ } }
function checkpoint() { undo.push(JSON.stringify(db)); if (undo.length > 50) undo.shift(); }
const id = () => Math.random().toString(16).slice(2, 18).padEnd(16, '0');
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function occursOn(t: Task, date: string): boolean {
  const r = t.repeat;
  if (!r) return t.date === date;
  if (date < t.date || (r.until && date > r.until) || r.except?.includes(date)) return false;
  const n = Math.max(1, r.interval);
  if (r.freq === 'daily') return daysBetween(t.date, date) % n === 0;
  if (r.freq === 'weekly') {
    const wds = r.weekdays?.length ? r.weekdays : [weekday(t.date)];
    if (!wds.includes(weekday(date))) return false;
    return Math.floor(daysBetween(addDays(t.date, 1 - weekday(t.date)), date) / 7) % n === 0;
  }
  const months = (Number(date.slice(0, 4)) - Number(t.date.slice(0, 4))) * 12 + Number(date.slice(5, 7)) - Number(t.date.slice(5, 7));
  if (months % n) return false;
  const last = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate();
  return Number(date.slice(8)) === Math.min(Number(t.date.slice(8)), last);
}

function expand(t: Task, from: string, to: string): Task[] {
  if (!t.repeat) return t.date >= from && t.date <= to ? [clone(t)] : [];
  const out: Task[] = [];
  const end = t.repeat.until && t.repeat.until < to ? t.repeat.until : to;
  for (let d = from > t.date ? from : t.date; d <= end; d = addDays(d, 1)) {
    if (occursOn(t, d)) out.push({ ...clone(t), id: `${t.id}@${d}`, occurrenceOf: t.id, date: d, done: !!t.repeat.done?.includes(d) });
  }
  return out;
}

function prio(typeId: string) { return db.types.find((x) => x.id === typeId)?.priority ?? 99; }
function sortTasks(list: Task[]) {
  return list.sort((a, b) => a.date.localeCompare(b.date) || (a.start ? 1 : 0) - (b.start ? 1 : 0) || (a.start ?? '').localeCompare(b.start ?? '') || prio(a.typeId) - prio(b.typeId) || a.id.localeCompare(b.id));
}

function save(t: Task, scope: Scope): Task {
  if (!t.title?.trim()) throw new Error('la tarea necesita un título');
  const [series, occ] = t.id.split('@');
  const norm = (x: Task): Task => ({ ...x, title: x.title.trim(), occurrenceOf: undefined, updated: new Date().toISOString() });
  if (!occ) {
    const n = norm({ ...t, id: t.id || id() });
    if (t.id && db.tasks[t.id]?.repeat && n.repeat) n.repeat.done = db.tasks[t.id].repeat!.done;
    db.tasks[n.id] = n;
    return n;
  }
  const m = db.tasks[series];
  if (!m?.repeat) throw new Error('tarea no encontrada');
  if (scope === 'all') {
    const shift = daysBetween(occ, t.date);
    const n = norm({ ...m, ...t, id: m.id, date: addDays(m.date, shift), repeat: { ...(t.repeat ?? m.repeat), done: m.repeat.done } as Repeat });
    db.tasks[m.id] = n;
    return n;
  }
  if (scope === 'following' && occ !== m.date) {
    m.repeat.until = addDays(occ, -1);
    const n = norm({ ...t, id: id(), seriesId: undefined, repeat: { ...(t.repeat ?? m.repeat), except: (m.repeat.except ?? []).filter((d) => d >= occ), done: [] } });
    db.tasks[n.id] = n;
    return n;
  }
  if (scope === 'following') return save({ ...t }, 'all');
  m.repeat.except = [...new Set([...(m.repeat.except ?? []), occ])];
  const n = norm({ ...t, id: id(), seriesId: series, repeat: null, done: t.done || !!m.repeat.done?.includes(occ) });
  db.tasks[n.id] = n;
  return n;
}

function remove(ids: string[], scope: Scope) {
  for (const x of ids) {
    const [series, occ] = x.split('@');
    const m = db.tasks[series];
    if (!m) continue;
    if (!occ || !m.repeat) { delete db.tasks[series]; continue; }
    if (scope === 'all' || (scope === 'following' && occ <= m.date)) {
      delete db.tasks[series];
      for (const t of Object.values(db.tasks)) if (t.seriesId === series) delete db.tasks[t.id];
    } else if (scope === 'following') m.repeat.until = addDays(occ, -1);
    else m.repeat.except = [...new Set([...(m.repeat.except ?? []), occ])];
  }
}

function setDone(taskId: string, done: boolean) {
  const [series, occ] = taskId.split('@');
  const m = db.tasks[series];
  if (!m) return;
  if (occ && m.repeat) {
    const set = new Set(m.repeat.done ?? []);
    if (done) set.add(occ); else set.delete(occ);
    m.repeat.done = [...set];
  } else m.done = done;
}

const INTERVALS = [1, 3, 8, 20, 45, 90];

function plan(): PlanReport {
  const s = db.settings;
  const today = todayISO();
  for (const t of Object.values(db.tasks)) if (t.auto && !t.pinned && !t.done) delete db.tasks[t.id];
  const horizon = s.examDate && s.examDate > today ? addDays(s.examDate, -1) : addDays(today, 120);
  const finalFrom = s.examDate && s.examDate > today ? addDays(s.examDate, -s.finalPhaseDays) : '';
  const due = new Map<Topic, { date: string; reps: number }>();
  const pending: Topic[] = [];
  for (const t of [...db.topics].filter((x) => !x.archived).sort((a, b) => a.number - b.number)) {
    if (t.studied) due.set(t, { date: addDays(t.studied, INTERVALS[Math.min(t.memory?.Reps ?? 0, 5)]) < today ? today : addDays(t.studied, INTERVALS[Math.min(t.memory?.Reps ?? 0, 5)]), reps: t.memory?.Reps ?? 1 });
    else pending.push(t);
  }
  const rep: PlanReport = { created: 0, reviews: 0, studies: 0, mocks: 0, horizon, finishDate: '', unscheduled: 0, shortfall: 0, extraPerDay: 0, warnings: [] };
  const label = (t: Topic) => `Tema ${t.number}. ${t.title}`;
  for (let d = today; d <= horizon; d = addDays(d, 1)) {
    const wd = weekday(d);
    if (s.restDays.includes(wd)) continue;
    const w = s.windows[wd] ?? { start: '16:00', end: '20:00' };
    let cursor = Math.max(minutesOf(w.start), d === today ? Math.ceil((new Date().getHours() * 60 + new Date().getMinutes()) / 15) * 15 : 0);
    const end = s.capacityMode === 'hours' ? 23 * 60 : minutesOf(w.end);
    let budget = s.capacityMode === 'window' ? end - cursor : (s.capacity[wd] ?? 0);
    const busy = Object.values(db.tasks).flatMap((t) => expand(t, d, d)).filter((t) => t.start).map((t) => [minutesOf(t.start), minutesOf(t.start) + (t.minutes || 15)]);
    const place = (n: number): number => {
      let at = cursor;
      for (let moved = true; moved;) { moved = false; for (const [a, b] of busy) if (at < b && at + n > a) { at = b; moved = true; } }
      if (at + n > end || n > budget) return -1;
      busy.push([at, at + n]); cursor = at + n + s.breakMinutes; budget -= n;
      return at;
    };
    const add = (at: number, minutes: number, kind: 'study' | 'review' | 'mock', topic?: Topic) => {
      const t: Task = { id: id(), date: d, start: hhmm(at), minutes, kind, auto: true, done: false, typeId: kind, title: kind === 'mock' ? 'Simulacro de examen' : `${kind === 'study' ? 'Estudio' : 'Repaso'} · ${label(topic!)}`, topicId: topic?.id, docId: topic?.docId };
      db.tasks[t.id] = t; rep.created++; rep[kind === 'study' ? 'studies' : kind === 'review' ? 'reviews' : 'mocks']++;
    };
    const final = !!finalFrom && d >= finalFrom;
    if (final && wd === 6) { const at = place(120); if (at >= 0) add(at, 120, 'mock'); }
    const queue = [...due.entries()].filter(([, v]) => v.date <= d).map(([t]) => t);
    let studyTurn = true;
    for (let i = 0; i < 50; i++) {
      const tryStudy = () => {
        if (final || !pending.length) return false;
        const t = pending[0];
        const m = Math.round((t.studyMinutes || s.blockMinutes) * (t.weight || 1) / 5) * 5;
        const at = place(m);
        if (at < 0) return false;
        add(at, m, 'study', t); pending.shift(); due.set(t, { date: addDays(d, INTERVALS[0] + 2), reps: 1 }); rep.finishDate = d;
        return true;
      };
      const tryReview = () => {
        while (queue.length) {
          const t = queue.shift()!;
          const m = Math.round(s.reviewMinutes * (t.weight || 1) / 5) * 5;
          const at = place(m);
          if (at < 0) continue;
          add(at, m, 'review', t);
          const v = due.get(t)!;
          due.set(t, { date: addDays(d, INTERVALS[Math.min(v.reps, 5)]), reps: v.reps + 1 });
          return true;
        }
        return false;
      };
      const ok = studyTurn ? (tryStudy() || tryReview()) : (tryReview() || tryStudy());
      if (!ok) break;
      studyTurn = !studyTurn;
    }
  }
  if (pending.length) {
    rep.unscheduled = pending.length;
    rep.shortfall = pending.reduce((n, t) => n + (t.studyMinutes || s.blockMinutes), 0);
    rep.extraPerDay = 30;
    if (s.examDate) rep.warnings!.push(`Con el tiempo de estudio actual faltan ${Math.round(rep.shortfall / 60)} h para terminar el temario antes de la fase final de repaso.`);
  }
  if (!db.topics.length) rep.warnings!.push('Añade el temario para que el plan reparta el estudio y los repasos.');
  return rep;
}

/** Métodos de la agenda del backend simulado (mismos nombres que en Go). */
export function agendaMock() {
  return {
    async AgendaInit(): Promise<AgendaInitData> { return clone({ today: todayISO(), types: db.types, settings: db.settings, topics: db.topics, templates: db.templates }); },
    async AgendaRange(from: string, to: string): Promise<Task[]> { return sortTasks(Object.values(db.tasks).flatMap((t) => expand(t, from, to))); },
    async AgendaSaveTask(t: Task, scope: Scope): Promise<Task> { checkpoint(); const r = save(clone(t), scope); persist(); return clone(r); },
    async AgendaSaveTasks(list: Task[]): Promise<Task[]> { checkpoint(); const r = list.map((t) => save(clone(t), 'one')); persist(); return clone(r); },
    async AgendaDeleteTasks(ids: string[], scope: Scope) { checkpoint(); remove(ids, scope); persist(); },
    async AgendaMoveTasks(ids: string[], days: number) {
      checkpoint();
      for (const x of ids) {
        const [series, occ] = x.split('@');
        const m = db.tasks[series];
        if (!m) continue;
        if (!occ) { m.date = addDays(m.date, days); if (m.auto) m.pinned = true; } else save({ ...clone(m), id: x, date: addDays(occ, days), repeat: null }, 'one');
      }
      persist();
    },
    async AgendaSetDone(taskId: string, done: boolean) { checkpoint(); setDone(taskId, done); persist(); },
    async AgendaUndo(): Promise<boolean> { const s = undo.pop(); if (!s) return false; db = JSON.parse(s); persist(); return true; },
    async AgendaSetTypes(list: TaskType[]) { db.types = clone(list).map((t) => ({ ...t, id: t.id || id() })).sort((a, b) => a.priority - b.priority); persist(); },
    async AgendaSetSettings(p: PlanSettings) { db.settings = clone(p); persist(); },
    async AgendaSetTemplates(list: WeekTemplate[]) { db.templates = clone(list).map((t) => ({ ...t, id: t.id || id() })); persist(); },
    async AgendaApplyTemplate(tplId: string, mondays: string[]): Promise<Task[]> {
      const tpl = db.templates.find((t) => t.id === tplId);
      if (!tpl) throw new Error('semana tipo no encontrada');
      checkpoint();
      const out = mondays.flatMap((mon) => tpl.tasks.map((tt) => save({ id: '', title: tt.title, typeId: tt.typeId, date: addDays(mon, tt.weekday - 1), start: tt.start, minutes: tt.minutes, notes: tt.notes, done: false }, 'one')));
      persist();
      return clone(out);
    },
    async AgendaSetTopics(list: Topic[]): Promise<Topic[]> {
      checkpoint();
      const old = new Map(db.topics.map((t) => [t.id, t]));
      db.topics = clone(list).map((t, i) => {
        const o = old.get(t.id);
        return { ...t, id: t.id || id(), number: t.number || i + 1, weight: t.weight > 0 ? t.weight : 1, files: o?.files ?? [], memory: o?.memory ?? t.memory ?? { Due: '', Stability: 0, Difficulty: 0, Reps: 0, Lapses: 0, State: 0, LastReview: '' }, studied: o?.studied ?? t.studied };
      });
      persist();
      return clone(db.topics);
    },
    async AgendaLogSession(s: Session): Promise<Session> {
      checkpoint();
      const se = { ...clone(s), id: s.id || id() };
      if (se.taskId) setDone(se.taskId, true);
      const t = db.topics.find((x) => x.id === se.topicId);
      if (t && se.rating) {
        t.studied ??= se.date;
        const reps = (t.memory?.Reps ?? 0) + 1;
        t.memory = { ...(t.memory as any), Reps: reps, State: 2, LastReview: se.date, Due: addDays(se.date, se.rating === 1 ? 1 : INTERVALS[Math.min(reps, 5)]) + 'T12:00:00Z' };
      }
      db.sessions.push(se);
      persist();
      return clone(se);
    },
    async AgendaDeleteSession(sid: string) { checkpoint(); db.sessions = db.sessions.filter((s) => s.id !== sid); persist(); },
    async AgendaSessions(from: string, to: string): Promise<Session[]> { return clone(db.sessions.filter((s) => (!from || s.date >= from) && (!to || s.date <= to))); },
    async AgendaRetrievability(date: string): Promise<Record<string, number>> {
      const out: Record<string, number> = {};
      for (const t of db.topics) if (t.studied) {
        const since = Math.max(0, daysBetween(t.memory?.LastReview?.slice(0, 10) || t.studied, date));
        const stab = INTERVALS[Math.min(t.memory?.Reps ?? 0, 5)] * 1.2;
        out[t.id] = Math.pow(1 + since / (9 * stab), -1);
      }
      return out;
    },
    async AgendaAttachFiles(topicId: string, paths: string[]): Promise<Topic> {
      const t = db.topics.find((x) => x.id === topicId);
      if (!t) throw new Error('tema no encontrado');
      for (const p of paths) {
        const fid = id();
        const name = mockFileNames.get(p) ?? p.split('/').pop() ?? 'archivo';
        mockFileURLs.set(`apuntes/${fid}`, p);
        (t.files ??= []).push({ id: fid, name, path: `apuntes/${fid}`, size: 0, added: todayISO() });
      }
      persist();
      return clone(t);
    },
    async AgendaRemoveTopicFile(topicId: string, fileId: string): Promise<Topic> {
      const t = db.topics.find((x) => x.id === topicId);
      if (!t) throw new Error('tema no encontrado');
      t.files = (t.files ?? []).filter((f) => f.id !== fileId);
      persist();
      return clone(t);
    },
    async AgendaTopicFilePath(rel: string): Promise<string> { return mockFileURLs.get(rel) ?? ''; },
    /** Aproximación de la curva del olvido (la real la calcula FSRS en Go). */
    async AgendaForecast(topicId: string, date: string): Promise<Forecast> {
      const t = db.topics.find((x) => x.id === topicId);
      if (!t) throw new Error('tema no encontrado');
      const reps = t.memory?.Reps ?? 0;
      const target = db.settings.retention || 0.9;
      const next = (stab: number) => ({ 1: addDays(date, 1), 2: addDays(date, Math.max(1, Math.round(stab * 0.6))), 3: addDays(date, Math.max(2, Math.round(stab * 1.2))), 4: addDays(date, Math.max(4, Math.round(stab * 2.5))) });
      if (!t.studied) return { topicId, new: true, reps: 0, lapses: 0, retention: 0, target, curve: null, next: next(3) };
      const last = t.memory?.LastReview?.slice(0, 10) || t.studied;
      const stab = INTERVALS[Math.min(reps, 5)] * 1.2;
      const r = (d: number) => Math.pow(1 + d / (9 * stab), -1);
      const due = t.memory?.Due?.slice(0, 10) || addDays(last, Math.round(stab));
      const days = Math.max(14, Math.min(120, daysBetween(last, date > due ? date : due) + 7));
      return { topicId, new: false, reps, lapses: t.memory?.Lapses ?? 0, lastReview: last, due, retention: r(Math.max(0, daysBetween(last, date))), target, curve: Array.from({ length: days + 1 }, (_, d) => r(d)), curveFrom: last, next: next(stab * 2) };
    },
    async AgendaPractice(start: boolean): Promise<void> {
      if (start) { practiceBackup ??= JSON.stringify(db); db = { tasks: {}, types: DEFAULT_TYPES, settings: defaultSettings(), topics: [], sessions: [], templates: [] }; }
      else if (practiceBackup) { db = JSON.parse(practiceBackup); practiceBackup = null; }
      undo.length = 0;
    },
    async AgendaPlan(): Promise<PlanReport> { checkpoint(); const r = plan(); persist(); return r; },
    async DictationStatus(model: string) {
      return { model, modelReady: false, modelPath: '', modelSize: 487601967, engineReady: false, enginePath: '', nativeRecord: false, recorder: '', recording: false, downloading: false };
    },
    async DictationDownloadModel(_model: string): Promise<void> { throw new Error('El dictado necesita la aplicación de escritorio.'); },
    async DictationCancelDownload() { /* */ },
    async DictationDeleteModel(_model: string) { /* */ },
    async DictationStart(): Promise<void> { throw new Error('El dictado necesita la aplicación de escritorio.'); },
    async DictationStop(_model: string): Promise<string> { return ''; },
    async DictationCancel() { /* */ },
    async DictationTranscribeWav(_b64: string, _model: string): Promise<string> { throw new Error('El dictado necesita la aplicación de escritorio.'); },
  };
}

export type AgendaBackend = ReturnType<typeof agendaMock>;

/** Archivos elegidos en el navegador: ruta simulada → URL del blob y nombre. */
export const mockFileURLs = new Map<string, string>();
export const mockFileNames = new Map<string, string>();
