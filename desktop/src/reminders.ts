// Avisos de la agenda en el escritorio: notificaciones del sistema (centro de
// notificaciones de GNOME/KDE en Linux, avisos de Windows). La interfaz manda la
// lista de los próximos días cada vez que cambia la agenda; aquí se comprueba
// cada 20 s qué toca avisar. Con un reloj en lugar de temporizadores largos, un
// aviso que vence con el equipo suspendido sale al despertar (si no hace más de
// 15 minutos que pasó la hora).
import { Notification } from 'electron';

export interface Reminder {
  /** Id de la tarea (o de la ocurrencia) y fecha: con ellos se abre al pulsar. */
  id: string;
  date: string;
  /** Momento del aviso, en milisegundos. */
  at: number;
  title: string;
  body: string;
}

const LATE = 15 * 60_000;

export class Reminders {
  private list: Reminder[] = [];
  private fired = new Set<string>();
  /** Las notificaciones vivas: si se liberan, en Linux deja de llegar el clic. */
  private shown = new Set<Notification>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private icon: string | undefined, private onOpen: (r: Reminder) => void) {}

  set(list: Reminder[]) {
    this.list = Array.isArray(list) ? list.filter((r) => r && typeof r.at === 'number' && r.id) : [];
    if (!this.timer) this.timer = setInterval(() => this.tick(), 20_000);
    this.tick();
  }

  private tick() {
    const now = Date.now();
    for (const r of this.list) {
      const key = `${r.id}@${r.at}`;
      if (r.at > now || this.fired.has(key)) continue;
      this.fired.add(key);
      if (now - r.at <= LATE) this.show(r);
    }
  }

  private show(r: Reminder) {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: r.title, body: r.body, icon: this.icon, urgency: 'normal', timeoutType: 'default' });
    this.shown.add(n);
    n.on('click', () => { this.shown.delete(n); this.onOpen(r); });
    n.on('close', () => this.shown.delete(n));
    n.show();
  }
}
