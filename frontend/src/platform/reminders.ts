// Avisos de la agenda: cada tarea puede pedir una notificación un rato antes
// (campo «Avisar» del editor). Se programan los de los próximos 7 días y se
// rehacen cada vez que cambia la agenda.
//  - Android: notificaciones locales del sistema, con el botón «Hecha».
//  - Escritorio: la lista va a la ventana (Electron), que muestra la
//    notificación del sistema a su hora aunque la ventana esté oculta.
// El aviso por defecto de las tareas nuevas es una preferencia de este
// dispositivo; el de cada tarea viaja con ella y se sincroniza.
import { App as CapApp } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { App } from '../app';
import { api, onEvent, type DesktopReminder } from '../api';
import { on } from '../bus';
import { minutesOf, addDays, toDate, todayISO, timeLabel } from '../agenda/dates';
import type { Task } from '../agenda/model';
import { debounce } from '../ui/dom';
import { isAndroid, isDesktop } from './platform';
import { notificationId } from './notificationid';

const KEY = 'folio-remind-minutes';
const CHANNEL = 'agenda';
const ACTIONS = 'agenda-task';
/** Hora de referencia de las tareas sin hora («todo el día»). */
const ALL_DAY = 9 * 60;

/** Opciones del campo «Avisar» (minutos antes; null = sin aviso). */
export const REMIND_CHOICES: (number | null)[] = [null, 0, 5, 10, 15, 30, 60, 120, 1440];

export function remindLabel(m: number | null | undefined, allDay = false): string {
  if (m === null || m === undefined) return 'Sin aviso';
  if (allDay) return m >= 1440 ? 'El día antes, a las 9:00' : 'El mismo día, a las 9:00';
  if (m === 0) return 'A la hora';
  if (m === 1440) return '1 día antes';
  return m >= 60 ? `${m / 60} h antes` : `${m} min antes`;
}

/** Aviso por defecto de las tareas nuevas con hora (null = ninguno). */
export function getDefaultRemind(): number | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === null || v === '' || Number(v) <= 0 ? null : Number(v);
  } catch { return null; }
}

export function setDefaultRemind(m: number | null) {
  try { localStorage.setItem(KEY, m === null ? '' : String(m)); } catch { /* */ }
}

export const remindersSupported = isAndroid || isDesktop;

export class Reminders {
  private ready = false;

  constructor(private app: App) {}

  async init() {
    if (isAndroid) {
      try {
        await LocalNotifications.createChannel({ id: CHANNEL, name: 'Agenda', description: 'Avisos de las tareas', importance: 4 });
        await LocalNotifications.registerActionTypes({ types: [{ id: ACTIONS, actions: [{ id: 'done', title: 'Hecha' }] }] });
        await LocalNotifications.addListener('localNotificationActionPerformed', (e) => void this.open(e.notification.extra, e.actionId === 'done'));
      } catch (e) { console.error(e); return; }
      void CapApp.addListener('appStateChange', ({ isActive }) => { if (isActive) this.schedule(); });
    } else if (isDesktop) {
      onEvent('reminder:open', (r: { id: string; date: string }) => void this.open(r, false));
    } else return;
    this.ready = true;
    on('agenda:changed', () => this.schedule());
    this.schedule();
  }

  /** Android pide permiso la primera vez que una tarea quiere aviso. */
  async ensurePermission(): Promise<boolean> {
    if (!isAndroid) return true;
    try { return (await LocalNotifications.requestPermissions()).display === 'granted'; } catch { return false; }
  }

  private async open(extra: { id?: string; date?: string } | undefined, done: boolean) {
    if (!extra?.id) return;
    await this.app.setMode('agenda');
    const st = this.app.agenda.state;
    if (done) { await st.setDone(extra.id, true); return; }
    if (!extra.date) return;
    this.app.agenda.goTo('day', extra.date);
    const t = (await st.range(extra.date, extra.date)).find((x) => x.id === extra.id);
    if (t) this.app.agenda.openTask(t);
  }

  /** Programa los avisos de los próximos 7 días (sustituye los anteriores). */
  schedule = debounce(() => void this.apply(), 1500);

  private async apply() {
    if (!this.ready) return;
    try {
      const st = this.app.agenda.state;
      if (!st.ready) await st.load(); // la agenda puede no haberse abierto aún (o la ventana arrancó oculta)
      const today = todayISO();
      const tasks = await st.range(today, addDays(today, 7));
      const now = Date.now();
      const list: DesktopReminder[] = [];
      for (const t of tasks) {
        if (t.done || t.remind === null || t.remind === undefined) continue;
        const at = fireTime(t);
        if (at <= now) continue;
        const type = this.app.agenda.state.type(t.typeId);
        list.push({ id: t.id, date: t.date, at, title: t.title || type.name, body: bodyOf(t, type.name) });
      }
      list.sort((a, b) => a.at - b.at);
      if (isDesktop) { await api.SetReminders(list); return; }
      const pending = await LocalNotifications.getPending();
      if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
      if (!list.length) return;
      await LocalNotifications.schedule({
        notifications: list.slice(0, 60).map((r) => ({
          id: notificationId(r.id), channelId: CHANNEL, actionTypeId: ACTIONS, title: r.title, body: r.body,
          schedule: { at: new Date(r.at), allowWhileIdle: true }, extra: { id: r.id, date: r.date },
        })),
      });
    } catch (e) { console.error('Avisos:', e); }
  }
}

function fireTime(t: Task): number {
  const at = toDate(t.date);
  const m = t.start ? minutesOf(t.start) : ALL_DAY;
  at.setHours(Math.floor(m / 60), m % 60, 0, 0);
  // Sin hora solo hay «el mismo día» o «el día antes», siempre a las 9:00
  const before = t.start ? t.remind ?? 0 : (t.remind ?? 0) >= 1440 ? 1440 : 0;
  return at.getTime() - before * 60_000;
}

function bodyOf(t: Task, typeName: string): string {
  const when = t.start ? `${timeLabel(t.start)}${t.minutes ? ` · ${t.minutes} min` : ''}` : 'Todo el día';
  const day = t.date === todayISO() ? 'Hoy' : t.date === addDays(todayISO(), 1) ? 'Mañana' : '';
  return [day, when, typeName].filter(Boolean).join(' · ');
}
