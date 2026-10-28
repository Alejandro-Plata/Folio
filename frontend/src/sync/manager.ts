// Cuándo y cómo se sincroniza con la nube: al abrir y al volver a la ventana,
// unos segundos después del último cambio, cada pocos minutos y al cerrar.
// Siempre se guarda antes lo pendiente, para no subir un documento a medias.
import type { App } from '../app';
import { api, onEvent } from '../api';
import { emit, on } from '../bus';
import { toast } from '../ui/dom';
import type { SyncConfig, SyncResult } from '../types';

export type SyncState = 'off' | 'idle' | 'syncing' | 'error';

const AFTER_CHANGE_MS = 30_000;
const EVERY_MS = 5 * 60_000;
const MIN_GAP_MS = 5_000;

export class SyncManager {
  config: SyncConfig | null = null;
  state: SyncState = 'off';
  progress = '';
  lastError = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private applying = false;
  private lastRun = 0;
  private listeners = new Set<() => void>();

  constructor(private app: App) {}

  get linked() { return !!this.config?.provider; }
  get lastSync() { return this.config?.lastSync ?? ''; }

  onChange(cb: () => void) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  private notify() { this.listeners.forEach((cb) => cb()); }

  async init() {
    await this.refresh();
    onEvent('sync:progress', (done: number, total: number) => {
      this.progress = total ? `${done} de ${total}` : '';
      this.notify();
    });
    // Cualquier cambio (escribir, tocar la agenda) programa una sincronización
    on('agenda:changed', () => this.noteChange());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void this.run('foco'); });
    window.addEventListener('online', () => void this.run('conexión'));
    setInterval(() => void this.run('periódica'), EVERY_MS);
    if (this.linked) void this.run('arranque');
  }

  /** Vuelve a leer la configuración (tras vincular o desvincular). */
  async refresh() {
    try {
      const st = await api.SyncStatus();
      this.config = st.config;
      this.lastError = st.config.lastError;
      this.state = st.linked ? (this.lastError ? 'error' : 'idle') : 'off';
    } catch { this.state = 'off'; }
    this.notify();
  }

  /** Algo ha cambiado aquí: se sincroniza cuando se deje de tocar durante un rato. */
  noteChange() {
    if (!this.linked || this.applying) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run('cambios'), AFTER_CHANGE_MS);
  }

  /** Sincroniza. `reason` solo sirve para depurar. Devuelve el resultado, o null si no se ha hecho. */
  async run(reason: string, opts: { manual?: boolean } = {}): Promise<SyncResult | null> {
    void reason;
    if (!this.linked || this.running) return null;
    if (!opts.manual && Date.now() - this.lastRun < MIN_GAP_MS) return null;
    this.running = true;
    this.state = 'syncing';
    this.progress = '';
    this.notify();
    try {
      await this.app.flush();
      const res = await api.SyncRun();
      this.lastRun = Date.now();
      if (res.skipped) { this.state = this.lastError ? 'error' : 'idle'; return res; }
      this.lastError = '';
      await this.apply(res);
      if (opts.manual) toast(summary(res), { kind: 'ok', ms: 4000 });
      return res;
    } catch (e) {
      this.lastError = String((e as Error)?.message ?? e).replace(/^Error:\s*/, '');
      if (opts.manual) toast(this.lastError, { kind: 'error', ms: 7000 });
      return null;
    } finally {
      this.running = false;
      await this.refresh();
    }
  }

  /** Muestra lo que ha llegado de otros dispositivos. */
  private async apply(res: SyncResult) {
    if (!res.changed) return;
    this.applying = true;
    try {
      await this.app.refreshDocs();
      const docs = res.docsChanged ?? [];
      if (this.app.doc && docs.includes(this.app.doc.meta.id)) await this.app.reloadCurrentDoc();
      if (res.agendaChanged && this.app.agenda?.state.ready) {
        await this.app.agenda.state.load();
        emit('agenda:changed');
      }
      if (res.gastosChanged && this.app.gastos?.state.ready) {
        await this.app.gastos.state.load();
        emit('gastos:changed');
      }
      if (res.conflicts) {
        toast(res.conflicts === 1
          ? 'Un documento se editó en dos dispositivos a la vez: se ha quedado la versión más reciente y la otra está en su historial de versiones.'
          : `${res.conflicts} documentos se editaron en dos dispositivos a la vez: se han quedado las versiones más recientes y las otras están en su historial.`, { ms: 9000 });
      }
    } finally { this.applying = false; }
  }

  /** Última oportunidad al cerrar la app: se espera como mucho 10 s. */
  async runBeforeClose() {
    if (!this.linked) return;
    await Promise.race([this.run('cierre', { manual: false }), new Promise((r) => setTimeout(r, 10_000))]);
  }
}

export function summary(r: SyncResult): string {
  const parts: string[] = [];
  if (r.downloaded) parts.push(`${r.downloaded} recibidos`);
  if (r.uploaded) parts.push(`${r.uploaded} enviados`);
  if (r.merged) parts.push(`${r.merged} fusionados`);
  if (r.deletedLocal + r.deletedRemote) parts.push(`${r.deletedLocal + r.deletedRemote} borrados`);
  return parts.length ? `Sincronizado: ${parts.join(', ')}` : 'Todo está al día';
}

export function relativeTimeText(iso: string): string {
  if (!iso) return 'nunca';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}
