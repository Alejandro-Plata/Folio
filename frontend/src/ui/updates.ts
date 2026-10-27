// Actualizaciones: al abrir Folio, si hay una versión nueva, un diálogo permite
// instalarla, leer sus cambios o dejarlo para más tarde (se vuelve a preguntar
// la próxima vez). Desde Ajustes, Archivo o «Más» se busca a mano.
import type { App } from '../app';
import { api, onEvent } from '../api';
import type { UpdateInfo } from '../types';
import { h, hasOpenModal, modal } from './dom';
import { icon } from './icons';

const LAST_CHECK = 'folio-update-check';

const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

/**
 * Al arrancar: si hay una versión nueva, abre el diálogo de actualización en
 * cuanto la app está libre (sin tutorial ni otro diálogo abierto).
 */
export function scheduleUpdateCheck(app: App) {
  setTimeout(async () => {
    const info = await api.UpdateCheck().catch(() => null);
    set(LAST_CHECK, String(Date.now()));
    if (!info?.available) return;
    const busy = () => hasOpenModal() || document.body.classList.contains('touring') || !!document.querySelector('.backstage');
    for (let i = 0; busy() && i < 120; i++) await new Promise((r) => setTimeout(r, 1000));
    if (!busy()) void updateDialog(app, info);
  }, 2500);
}

/**
 * Notas de la versión (Markdown de GitHub) como HTML. Se escapa «<» para que el
 * texto no pueda colar etiquetas; «>» se deja, porque en Markdown abre las citas.
 */
async function renderNotes(md: string): Promise<string> {
  const { marked } = await import('marked');
  return marked.parse(md.replace(/&/g, '&amp;').replace(/</g, '&lt;'), { async: false }) as string;
}

const mb = (n: number) => `${(n / 1048576).toFixed(n > 10485760 ? 0 : 1).replace('.', ',')} MB`;

/** Diálogo de actualizaciones: comprueba (si no se le pasa la información) y permite instalar. */
export async function updateDialog(app: App, known?: UpdateInfo) {
  const status = h('div', { class: 'upd-status' });
  const notes = h('div', { class: 'upd-notes', hidden: true });
  // Los vínculos de las notas se abren en el navegador, no dentro de la ventana de Folio
  notes.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    if (/^https?:/i.test(a.href)) void api.OpenURL(a.href);
  });
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
    line('download', `Folio ${info.latest} está disponible`, `Versión actual: ${app.version}. Descarga de ${mb(info.size)}; los documentos y la agenda no cambian.`);
    const hasNotes = !!info.notes.trim();
    const toggle = h('button', { type: 'button', class: 'btn btn-ghost', 'aria-expanded': 'false' }, 'Ver los cambios');
    toggle.addEventListener('click', async () => {
      const open = notes.hidden;
      if (open && !notes.childElementCount) notes.innerHTML = await renderNotes(info!.notes.trim());
      notes.hidden = !open;
      toggle.textContent = open ? 'Ocultar los cambios' : 'Ver los cambios';
      toggle.setAttribute('aria-expanded', String(open));
    });
    actions.append(
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => closeFn?.(null) }, 'Más tarde'),
      h('div', { class: 'spacer' }),
      hasNotes ? toggle : null as any,
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => void install() }, h('span', { html: icon('download', 15) }), 'Instalar'));
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
  // Con una versión pendiente, los botones propios (Más tarde · Ver los cambios · Instalar) sustituyen a «Cerrar»
  await modal(info?.available ? 'Actualización disponible' : 'Actualizaciones', body, info?.available ? [] : [{ label: 'Cerrar', value: null, kind: 'ghost' }],
    { className: 'is-small upd-modal', onOpen: (c) => { closeFn = c; } });
}
