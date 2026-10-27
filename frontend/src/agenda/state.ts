// Estado de la agenda en la interfaz: datos iniciales, caché de tareas por
// rango y operaciones que llaman al backend. Avisa de los cambios por el bus.
import { api } from '../api';
import { emit } from '../bus';
import { toast } from '../ui/dom';
import type { AgendaInitData, PlanReport, PlanSettings, Scope, Session, Task, TaskType, Topic, WeekTemplate } from './model';
import { addDays, todayISO } from './dates';
import type { Circle } from '../types';

/** Los eventos de los círculos llevan el id «c:…» y se guardan en el servidor. */
export const isCircleId = (id: string | undefined) => !!id && id.startsWith('c:');

/** Tipos sintéticos «circle:‹id›»: cada círculo se pinta con su color e icono. */
let circleTypes: TaskType[] = [];
export function setCircleTypes(circles: Circle[]) {
  circleTypes = circles.map((c) => ({ id: `circle:${c.id}`, name: c.name, priority: 0, color: c.color, icon: c.kind === 'couple' ? 'heart' : 'users', pattern: 'solid', countsAsStudy: false, fixed: true }));
}
export const getCircleTypes = () => circleTypes;

export class AgendaState {
  today = todayISO();
  types: TaskType[] = [];
  settings!: PlanSettings;
  topics: Topic[] = [];
  templates: WeekTemplate[] = [];
  lastReport: PlanReport | null = null;
  private loaded = false;
  /** Tareas recientes (4 semanas atrás y 2 adelante) para las sugerencias. */
  recent: Task[] = [];
  recentSessions: Session[] = [];

  async load() {
    const d: AgendaInitData = await api.AgendaInit();
    this.today = d.today || todayISO();
    this.types = d.types ?? [];
    this.settings = d.settings;
    this.topics = d.topics ?? [];
    this.templates = d.templates ?? [];
    this.loaded = true;
    await this.refreshRecent();
  }

  get ready() { return this.loaded; }

  async refreshRecent() {
    this.today = todayISO();
    const [tasks, sessions] = await Promise.all([
      api.AgendaRange(addDays(this.today, -28), addDays(this.today, 14)),
      api.AgendaSessions(addDays(this.today, -56), this.today),
    ]);
    this.recent = tasks ?? [];
    this.recentSessions = sessions ?? [];
  }

  type(id: string | undefined): TaskType {
    if (id?.startsWith('circle:')) {
      const c = circleTypes.find((t) => t.id === id);
      if (c) return c;
    }
    return this.types.find((t) => t.id === id) ?? this.types[this.types.length - 1] ?? { id: '', name: 'Tarea', priority: 9, color: '#888888', icon: 'calendar', pattern: 'solid', countsAsStudy: false, fixed: false };
  }

  topic(id: string | undefined): Topic | undefined { return id ? this.topics.find((t) => t.id === id) : undefined; }
  topicByNumber(n: number | undefined): Topic | undefined { return n ? this.topics.find((t) => t.number === n && !t.archived) : undefined; }

  async range(from: string, to: string): Promise<Task[]> {
    return (await api.AgendaRange(from, to)) ?? [];
  }

  /** Ejecuta una operación, avisa del cambio y muestra los errores. */
  private async mutate<T>(op: () => Promise<T>, message?: string, opts: { replan?: boolean; shared?: boolean } = {}): Promise<T | undefined> {
    try {
      const r = await op();
      // El plan automático cuenta como otro paso: «Deshacer» deshace los dos
      let steps = 1;
      if (opts.replan && this.topics.length && await this.plan(true)) steps++;
      await this.refreshRecent();
      emit('agenda:changed');
      // Lo compartido no se deshace (los demás ya lo han podido ver)
      if (message) toast(message, { kind: 'ok', ms: 3500, action: opts.shared ? undefined : { label: 'Deshacer', run: () => void this.undo(steps) } });
      return r;
    } catch (e) {
      toast(String(e).replace(/^Error:\s*/, ''), { kind: 'error', ms: 6000 });
      return undefined;
    }
  }

  // Con eventos de círculo de por medio no hay «Deshacer» y se rehace el plan (ocupan tiempo)
  saveTask(t: Task, scope: Scope = 'one', message?: string) {
    const shared = !!t.circle?.id || isCircleId(t.id);
    return this.mutate(() => api.AgendaSaveTask(t, scope), message, { shared, replan: shared });
  }
  saveTasks(list: Task[], message?: string) {
    const shared = list.some((t) => t.circle?.id);
    return this.mutate(async () => (await api.AgendaSaveTasks(list)) ?? [], message, { shared, replan: shared });
  }
  deleteTasks(ids: string[], scope: Scope = 'one', message?: string) {
    const shared = ids.some(isCircleId);
    return this.mutate(() => api.AgendaDeleteTasks(ids, scope), message, { shared, replan: shared });
  }
  moveTasks(ids: string[], days: number, message?: string) {
    const shared = ids.some(isCircleId);
    return this.mutate(() => api.AgendaMoveTasks(ids, days), message, { shared, replan: shared });
  }
  setDone(id: string, done: boolean) { return this.mutate(() => api.AgendaSetDone(id, done)); }

  logSession(s: Session, message?: string) {
    return this.mutate(async () => {
      const r = await api.AgendaLogSession(s);
      this.topics = (await api.AgendaInit()).topics ?? this.topics;
      return r;
    }, message, { replan: !!s.topicId && !!s.rating });
  }

  async undo(steps = 1) {
    try {
      let ok = false;
      for (let i = 0; i < steps; i++) ok = (await api.AgendaUndo()) || ok;
      if (!ok) { toast('No hay nada que deshacer en la agenda'); return; }
      const d = await api.AgendaInit();
      this.topics = d.topics ?? [];
      await this.refreshRecent();
      emit('agenda:changed');
      toast('Deshecho', { ms: 1800 });
    } catch (e) { toast(String(e), { kind: 'error' }); }
  }

  async setTypes(list: TaskType[]) {
    await this.mutate(async () => { await api.AgendaSetTypes(list); this.types = (await api.AgendaInit()).types; });
  }

  async setSettings(p: PlanSettings, replan = true) {
    await this.mutate(async () => { await api.AgendaSetSettings(p); this.settings = p; }, undefined, { replan });
  }

  async setTopics(list: Topic[], replan = true) {
    return this.mutate(async () => { this.topics = (await api.AgendaSetTopics(list)) ?? []; return this.topics; }, undefined, { replan });
  }

  async setTemplates(list: WeekTemplate[]) {
    await this.mutate(async () => { await api.AgendaSetTemplates(list); this.templates = (await api.AgendaInit()).templates ?? []; });
  }

  applyTemplate(id: string, mondays: string[]) {
    return this.mutate(async () => (await api.AgendaApplyTemplate(id, mondays)) ?? [], `Semana tipo aplicada a ${mondays.length} ${mondays.length === 1 ? 'semana' : 'semanas'}`);
  }

  /** Rehace el plan automático. `quiet` no avisa salvo que haya problemas. */
  async plan(quiet = false): Promise<PlanReport | null> {
    try {
      const r = await api.AgendaPlan();
      this.lastReport = r;
      if (!quiet) {
        emit('agenda:changed');
        toast(r.created ? `Plan actualizado: ${r.studies} bloques de estudio, ${r.reviews} repasos${r.mocks ? ` y ${r.mocks} simulacros` : ''}` : 'Plan actualizado', { kind: 'ok', ms: 4000, action: { label: 'Deshacer', run: () => void this.undo() } });
      }
      emit('agenda:plan', r);
      return r;
    } catch (e) {
      toast(String(e), { kind: 'error' });
      return null;
    }
  }
}
