// Estado de la cuenta y los círculos en la interfaz: abre la sesión guardada
// al arrancar, refresca cada pocos minutos y al volver a la ventana, pinta los
// círculos en la agenda y avisa de las citas que te proponen.
import type { App } from '../app';
import { api } from '../api';
import { emit } from '../bus';
import { setCircleTypes } from '../agenda/state';
import type { DateProposal, SocialSnapshot } from '../types';
import { toast } from '../ui/dom';

const EVERY = 2 * 60_000;
const SEEN = 'folio-dates-seen';

export class SocialManager {
  snap: SocialSnapshot = { configured: false, signedIn: false, circles: [], events: [], proposals: [], lastSync: '' };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastFocus = 0;
  private eventsKey = '';

  constructor(private app: App) {}

  get me() { return this.snap.user?.id ?? ''; }
  get circles() { return this.snap.circles ?? []; }
  get couples() { return this.circles.filter((c) => c.kind === 'couple'); }
  /** Citas abiertas que esperan tu respuesta. */
  get pending(): DateProposal[] {
    return (this.snap.proposals ?? []).filter((p) => p.status === 'open' && p.date_options.some((o) => o.proposed_by !== this.me));
  }

  onChange(cb: () => void) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  async init() {
    try { this.apply(await api.SocialStatus()); } catch { return; }
    if (!this.snap.configured) return;
    try { this.apply(await api.SocialRestore()); } catch { this.apply(await api.SocialStatus().catch(() => this.snap)); }
    window.addEventListener('focus', () => { if (Date.now() - this.lastFocus > 30_000) void this.refresh(); });
    this.timer = setInterval(() => { if (this.snap.signedIn && !document.hidden) void this.refresh(); }, EVERY);
  }

  /** Descarga lo último. quiet: sin avisar de errores (sin conexión, etc.). */
  async refresh(quiet = true) {
    if (!this.snap.signedIn) return;
    this.lastFocus = Date.now();
    try { this.apply(await api.SocialRefresh()); }
    catch (e) { if (!quiet) toast(String(e).replace(/^Error:\s*/, ''), { kind: 'error' }); }
  }

  /** Aplica una instantánea recibida del backend (tras cualquier operación). */
  apply(s: SocialSnapshot) {
    const before = this.snap;
    this.snap = { ...s, circles: s.circles ?? [], events: s.events ?? [], proposals: s.proposals ?? [] };
    setCircleTypes(this.circles);
    const key = JSON.stringify([this.snap.events, this.circles.map((c) => [c.id, c.name, c.color])]);
    if (key !== this.eventsKey) {
      this.eventsKey = key;
      if (this.app.agenda?.state.ready) emit('agenda:changed');
    }
    if (before.signedIn && this.snap.signedIn) this.notifyNewDates();
    else if (this.snap.signedIn) this.markSeen(); // al abrir sesión no se avisa de lo antiguo
    for (const cb of this.listeners) cb();
    emit('social:changed');
  }

  /** Ejecuta una operación que devuelve la instantánea nueva, con aviso de error. */
  async run(op: () => Promise<SocialSnapshot>, ok?: string): Promise<boolean> {
    try {
      this.apply(await op());
      if (ok) toast(ok, { kind: 'ok' });
      return true;
    } catch (e) {
      toast(String(e).replace(/^Error:\s*/, ''), { kind: 'error', ms: 6000 });
      return false;
    }
  }

  personName(userId: string | null | undefined): string {
    if (!userId) return 'Alguien';
    if (userId === this.me) return 'Tú';
    for (const c of this.circles) for (const m of c.circle_members) if (m.user_id === userId) return m.profiles.name || m.profiles.email;
    return 'Alguien';
  }

  private seen(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(SEEN) || '[]')); } catch { return new Set(); } }
  private markSeen() {
    const ids = (this.snap.proposals ?? []).flatMap((p) => p.date_options.map((o) => o.id!));
    try { localStorage.setItem(SEEN, JSON.stringify(ids.slice(-500))); } catch { /* */ }
  }

  /** Aviso de propuestas u opciones nuevas de la otra persona. */
  private notifyNewDates() {
    const seen = this.seen();
    const fresh = this.pending.filter((p) => p.date_options.some((o) => o.proposed_by !== this.me && !seen.has(o.id!)));
    this.markSeen();
    if (!fresh.length) return;
    const p = fresh[0];
    const who = this.personName(p.date_options.find((o) => o.proposed_by !== this.me)?.proposed_by);
    toast(fresh.length > 1 ? `Tienes ${fresh.length} citas por responder` : `${who} te propone: ${p.title}`, {
      ms: 10000, action: { label: 'Ver', run: () => void import('./dates').then((m) => m.datesDialog(this.app)) },
    });
  }

  stop() { clearInterval(this.timer); }
}
