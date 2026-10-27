// Avisos de la agenda en Android: una notificación local un rato antes de cada
// tarea con hora (próximos 7 días). Se reprograman cada vez que cambia la agenda.
// Es una preferencia de este dispositivo: no se sincroniza.
import { App as CapApp } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { App } from '../app';
import { on } from '../bus';
import { minutesOf, addDays, toDate, todayISO } from '../agenda/dates';
import { debounce } from '../ui/dom';
import { isAndroid } from './platform';
import { notificationId } from './notificationid';

const KEY = 'folio-remind-minutes';
const CHANNEL = 'agenda';
const ACTIONS = 'agenda-task';

export const REMIND_CHOICES = [0, 5, 10, 15, 30];

export function getRemindMinutes(): number {
  try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; }
}

export class Reminders {
  private ready = false;

  constructor(private app: App) {}

  async init() {
    if (!isAndroid) return;
    try {
      await LocalNotifications.createChannel({ id: CHANNEL, name: 'Agenda de estudio', description: 'Avisos antes de cada tarea', importance: 3 });
      await LocalNotifications.registerActionTypes({ types: [{ id: ACTIONS, actions: [{ id: 'done', title: 'Hecha' }] }] });
      await LocalNotifications.addListener('localNotificationActionPerformed', (e) => void this.perform(e.actionId, e.notification.extra));
      this.ready = true;
    } catch (e) { console.error(e); return; }
    on('agenda:changed', () => this.schedule());
    void CapApp.addListener('appStateChange', ({ isActive }) => { if (isActive) this.schedule(); });
    this.schedule();
  }

  /** Cambia el adelanto (0 = sin avisos). Pide el permiso la primera vez. */
  async setMinutes(min: number): Promise<boolean> {
    if (min > 0) {
      const st = await LocalNotifications.requestPermissions();
      if (st.display !== 'granted') return false;
    }
    try { localStorage.setItem(KEY, String(min)); } catch { /* */ }
    this.schedule();
    return true;
  }

  private async perform(actionId: string, extra: { id?: string; date?: string } | undefined) {
    if (!extra?.id) return;
    await this.app.setMode('agenda');
    if (actionId === 'done') { await this.app.agenda.state.setDone(extra.id, true); return; }
    if (extra.date) this.app.agenda.goTo('day', extra.date);
  }

  /** Programa los avisos de los próximos 7 días (cancela antes los que había). */
  schedule = debounce(() => void this.apply(), 1500);

  private async apply() {
    if (!this.ready) return;
    try {
      const pending = await LocalNotifications.getPending();
      if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
      const min = getRemindMinutes();
      if (!min) return;
      const today = todayISO();
      const tasks = await this.app.agenda.state.range(today, addDays(today, 7));
      const now = Date.now();
      const notifications = [];
      for (const t of tasks) {
        if (t.done || !t.start) continue;
        const at = toDate(t.date);
        const m = minutesOf(t.start);
        at.setHours(Math.floor(m / 60), m % 60, 0, 0);
        at.setMinutes(at.getMinutes() - min);
        if (at.getTime() <= now) continue;
        const type = this.app.agenda.state.type(t.typeId);
        notifications.push({
          id: notificationId(t.id), channelId: CHANNEL, actionTypeId: ACTIONS,
          title: `${type.name} · ${t.title}`, body: `A las ${t.start}${t.minutes ? ` · ${t.minutes} min` : ''}`,
          schedule: { at, allowWhileIdle: true }, extra: { id: t.id, date: t.date },
        });
      }
      if (notifications.length) await LocalNotifications.schedule({ notifications: notifications.slice(0, 60) });
    } catch (e) { console.error('Avisos:', e); }
  }
}
