// Actualizaciones: Folio mira una vez al día si hay versión nueva y lo avisa;
// desde Ajustes, Archivo o «Más» se puede buscar a mano, leer las novedades y
// descargarla e instalarla con un botón.
import type { App } from '../app';
import { api, onEvent } from '../api';
import type { UpdateInfo } from '../types';
import { h, modal, toast } from './dom';
import { icon } from './icons';

const LAST_CHECK = 'folio-update-check';
const SKIPPED = 'folio-update-skip';
const DAY = 24 * 3600 * 1000;

const get = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

/** Comprobación discreta al arrancar (como mucho una vez al día). */
export function scheduleUpdateCheck(app: App) {
  if (Date.now() - Number(get(LAST_CHECK) || 0) < DAY) return;
  setTimeout(async () => {
    const info = await api.UpdateCheck().catch(() => null);
    set(LAST_CHECK, String(Date.now()));
    if (!info?.available || get(SKIPPED) === info.latest) return;
    toast(`Folio ${info.latest} está disponible`, { ms: 12000, action: { label: 'Ver novedades', run: () => void updateDialog(app, info) } });
  }, 8000);
}

const mb = (n: number) => `${(n / 1048576).toFixed(n > 10485760 ? 0 : 1).replace('.', ',')} MB`;

/** Diálogo de actualizaciones: comprueba (si no se le pasa la información) y permite instalar. */
export async function updateDialog(app: App, known?: UpdateInfo) {
  const status = h('div', { class: 'upd-status' });
  const notes = h('div', { class: 'upd-notes', hidden: true });
  const bar = h('div', { class: 'upd-bar', hidden: true, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('span'));
  const actions = h('div', { class: 'upd-actions' });
  const body = h('div', { class: 'ag-form upd' }, status, notes, bar, actions);
  let info: UpdateInfo | null = known ?? null;

  const line = (ic: string, text: string, sub?: string) =>
    status.replaceChildren(h('span', { class: 'upd-ic', html: icon(ic, 22), 'aria-hidden': 'true' }), h('div', {}, h('strong', {}, text), sub ? h('p', { class: 'muted small' }, sub) : null));

  const draw = () => {
    actions.replaceChildren();
    notes.hidden = true;
    if (!info) return;
    if (!info.configured) { line('info', `Tienes Folio ${app.version}`, 'Esta copia de Folio no tiene configurado dónde buscar versiones nuevas.'); return; }
    if (!info.available) {
      line('checkCircle', `Folio ${app.version} está al día`, info.latest ? `La última versión publicada es la ${info.latest}${info.published ? `, del ${info.published.split('-').reverse().join('/')}` : ''}.` : undefined);
      actions.append(h('button', { type: 'button', class: 'btn btn-sm', onclick: () => void check() }, h('span', { html: icon('refresh', 14) }), 'Volver a comprobar'));
      return;
    }
    line('download', `Folio ${info.latest} está disponible`, `Tienes la ${app.version}. Descarga de ${mb(info.size)}; tus documentos y tu agenda no se tocan.`);
    if (info.notes.trim()) { notes.hidden = false; notes.textContent = info.notes.trim(); }
    actions.append(
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => void install() }, h('span', { html: icon('download', 15) }), 'Descargar e instalar'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { set(SKIPPED, info!.latest); closeFn?.(null); } }, 'Ahora no'),
      info.page ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => void api.OpenURL(info!.page) }, 'Ver en GitHub') : null as any);
  };

  const check = async () => {
    line('refresh', 'Buscando versiones nuevas…');
    actions.replaceChildren();
    try { info = await api.UpdateCheck(); set(LAST_CHECK, String(Date.now())); draw(); }
    catch (e) { line('alert', 'No se ha podido comprobar', String(e)); actions.append(h('button', { type: 'button', class: 'btn btn-sm', onclick: () => void check() }, 'Reintentar')); }
  };

  const install = async () => {
    actions.replaceChildren();
    bar.hidden = false;
    line('download', `Descargando Folio ${info!.latest}…`, 'Se comprueba que el archivo es el publicado antes de instalarlo.');
    const off = onEvent('update:progress', (p: { done: number; total: number }) => {
      const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
      (bar.firstChild as HTMLElement).style.width = `${pct}%`;
      bar.setAttribute('aria-valuenow', String(pct));
    });
    try {
      await app.flush?.();
      await api.UpdateInstall();
      line('checkCircle', 'Instalando…', 'Folio se cerrará y se abrirá la versión nueva.');
    } catch (e) {
      bar.hidden = true;
      line('alert', 'No se ha podido actualizar', String(e));
      actions.append(h('button', { type: 'button', class: 'btn btn-sm', onclick: () => void install() }, 'Reintentar'));
    } finally { off?.(); }
  };

  let closeFn: ((v: null) => void) | undefined;
  if (info) draw(); else void check();
  await modal('Actualizaciones', body, [{ label: 'Cerrar', value: null, kind: 'ghost' }], { className: 'is-small upd-modal', onOpen: (c) => { closeFn = c; } });
}
