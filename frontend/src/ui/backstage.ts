// Menú «Archivo» a pantalla completa (la vista Backstage de Word):
// información del documento, nuevo, abrir, exportar, imprimir con vista previa
// y los ajustes de la aplicación.
import type { App } from '../app';
import { h, relTime, toast, debounce, confirmDialog } from './dom';
import { icon, docIcon } from './icons';
import { api } from '../api';
import { isDesktop } from '../platform/platform';
import { TEMPLATES } from '../templates';
import { buildExportHTML, printHTML, toMarkdown, pageSizeMM } from '../io';
import * as dialogs from './dialogs';
import { pdfMergeDialog } from './pdfmerge';
import type { ExportFormat, ExportOptions } from '../types';
import { settingsPage, EXPORT_FORMATS, type SettingsSection } from './settings';

export type BackstagePage = 'info' | 'new' | 'open' | 'export' | 'print' | 'settings';
type Format = ExportFormat;

let current: { el: HTMLElement; close: () => void } | null = null;

export function closeBackstage() { current?.close(); }

export function openBackstage(app: App, page: BackstagePage, opts: { format?: Format; section?: SettingsSection } = {}) {
  closeBackstage();
  if (!app.doc && ['info', 'export', 'print'].includes(page)) page = 'new';
  void app.flush();

  const main = h('section', { class: 'bs-main' });
  const navItems = new Map<BackstagePage, HTMLButtonElement>();
  const close = () => {
    el.remove();
    document.removeEventListener('keydown', onKey, true);
    current = null;
    if (app.doc) app.editor.view.focus();
  };
  const show = (p: BackstagePage, section?: SettingsSection) => {
    if (!app.doc && ['info', 'export', 'print'].includes(p)) return;
    navItems.forEach((b, k) => b.classList.toggle('on', k === p));
    main.innerHTML = '';
    main.onscroll = null;
    main.scrollTop = 0;
    const pages: Record<BackstagePage, () => void> = {
      info: () => infoPage(app, main, close),
      new: () => newPage(app, main, close, show),
      open: () => openPage(app, main, close),
      export: () => exportPage(app, main, opts.format ?? app.settings.exportFormat ?? 'docx', close, show),
      print: () => printPage(app, main, show),
      settings: () => settingsPage(app, main, { close, go: (pg) => show(pg), section }),
    };
    pages[p]();
  };
  const item = (p: BackstagePage, ic: string, label: string) => {
    const b = h('button', { class: 'bs-item', disabled: !app.doc && ['info', 'export', 'print'].includes(p), onclick: () => show(p) },
      h('span', { html: icon(ic, 18) }), label);
    navItems.set(p, b);
    return b;
  };
  const action = (ic: string, label: string, run: () => void) =>
    h('button', { class: 'bs-item', onclick: () => { close(); run(); } }, h('span', { html: icon(ic, 18) }), label);

  const nav = h('nav', { class: 'bs-nav' },
    h('button', { class: 'bs-back', title: 'Volver al documento (Esc)', onclick: close }, h('span', { html: icon('arrowLeft', 20) }), 'Volver'),
    item('info', 'info', 'Información'),
    item('new', 'plus', 'Nuevo'),
    item('open', 'folder', 'Abrir'),
    h('div', { class: 'bs-sep' }),
    item('export', 'share', 'Exportar'),
    item('print', 'print', 'Imprimir'),
    h('div', { class: 'bs-sep' }),
    action('upload', 'Importar', () => dialogs.importDialog(app)),
    action('pdfMerge', 'Unir PDF', () => void pdfMergeDialog(app)),
    action('history', 'Historial de versiones', () => app.panels.show('versions')),
    h('div', { class: 'spacer' }),
    item('settings', 'settings', 'Ajustes'),
    h('button', { class: 'bs-version', title: 'Buscar actualizaciones', onclick: () => { close(); void import('./updates').then((m) => m.updateDialog(app)); } }, `Folio ${app.version}`),
  );
  const el = h('div', { class: 'backstage', role: 'dialog', 'aria-label': 'Archivo' }, nav, main);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) { e.preventDefault(); e.stopPropagation(); close(); }
  };
  document.addEventListener('keydown', onKey, true);
  document.body.append(el);
  current = { el, close };
  show(page, opts.section);
}

function pageHead(title: string, sub?: string) {
  return h('header', { class: 'bs-head' }, h('h1', {}, title), sub ? h('p', { class: 'muted' }, sub) : null);
}

// ---------- Información ----------
async function infoPage(app: App, main: HTMLElement, close: () => void) {
  const d = app.doc!;
  const chain: string[] = [];
  let p = app.docs.find((x) => x.id === d.meta.parentId);
  while (p) { chain.unshift(p.title || 'Sin título'); const pid = p.parentId; p = app.docs.find((x) => x.id === pid); }
  const versions = await api.ListVersions(d.meta.id).catch(() => []);
  const named = versions.filter((v) => v.kind === 'manual').length;
  const [w, hgt] = pageSizeMM(d.setup);
  const iconBtn = h('button', { class: 'bs-doc-icon', title: 'Cambiar icono', html: docIcon(d.meta.icon, 28),
    onclick: () => dialogs.iconPicker(app, d.meta.id, iconBtn, () => { iconBtn.innerHTML = docIcon(app.doc?.meta.icon, 28); }) });
  const rows: [string, string][] = [
    ['Palabras', d.meta.words.toLocaleString('es-ES')],
    ['Páginas', String(app.status.totalPages)],
    ['Creado', new Date(d.meta.created).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })],
    ['Última modificación', relTime(d.meta.updated)],
    ['Versiones', `${versions.length} (${named} con nombre)`],
    ['Página', `${d.setup.paper === 'Letter' ? 'Carta' : d.setup.paper} ${d.setup.orientation === 'landscape' ? 'horizontal' : 'vertical'} · ${Math.round(w)} × ${Math.round(hgt)} mm`],
    ['Ubicación', app.workspace],
  ];
  const tile = (ic: string, title: string, desc: string, run: () => void) =>
    h('button', { class: 'bs-tile', onclick: run }, h('span', { class: 'bs-tile-ic', html: icon(ic, 22) }),
      h('span', { class: 'bs-tile-text' }, h('strong', {}, title), h('span', {}, desc)));
  main.append(
    pageHead('Información'),
    h('div', { class: 'bs-doc' }, iconBtn, h('div', {},
      h('div', { class: 'bs-doc-title' }, d.meta.title || 'Sin título'),
      h('div', { class: 'muted' }, chain.length ? chain.join(' / ') : 'Documento de primer nivel'))),
    h('div', { class: 'bs-info' },
      h('div', { class: 'bs-tiles' },
        tile('history', 'Historial de versiones', 'Consulta, compara o restaura versiones anteriores.', () => { close(); app.panels.show('versions'); }),
        tile('save', 'Guardar versión con nombre', 'Marca un punto al que volver más adelante (F12).', () => { close(); void app.namedVersion(); }),
        tile('pageSetup', 'Configurar página', 'Papel, márgenes, encabezado, pie y numeración.', () => dialogs.pageSetupDialog(app)),
        tile('copy', 'Duplicar', 'Crea una copia independiente de este documento.', () => { close(); void app.duplicate(d.meta.id); }),
        tile('trash', 'Mover a la papelera', 'Podrás recuperarlo desde la papelera.', async () => {
          if (await confirmDialog('Mover a la papelera', `«${d.meta.title || 'Sin título'}» y sus subpáginas se moverán a la papelera.`, 'Mover', true)) { close(); void app.trash(d.meta.id); }
        }),
      ),
      h('table', { class: 'bs-props' }, ...rows.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v)))),
    ),
  );
}

// ---------- Nuevo ----------
function newPage(app: App, main: HTMLElement, close: () => void, show: (p: BackstagePage, s?: SettingsSection) => void) {
  const grid = h('div', { class: 'tpl-grid' });
  for (const t of TEMPLATES) {
    grid.append(h('button', { class: 'tpl-card', onclick: () => { close(); void app.newDoc('', t); } },
      h('span', { class: 'tpl-icon', html: icon(t.icon, 22) }), h('span', { class: 'tpl-title' }, t.title), h('span', { class: 'tpl-desc' }, t.description)));
  }
  main.append(pageHead('Nuevo', 'Empieza en blanco o a partir de una plantilla pensada para el aula.'), grid,
    h('p', { class: 'muted small bs-hint' }, 'Papel, márgenes y letra de los documentos nuevos: ',
      h('button', { class: 'linklike', onclick: () => show('settings', 'page') }, 'Ajustes › Página de los documentos nuevos'), '.'));
}

// ---------- Abrir ----------
function openPage(app: App, main: HTMLElement, close: () => void) {
  const input = h('input', { class: 'input bs-search', placeholder: 'Buscar por título o contenido…', 'aria-label': 'Buscar documentos' });
  const list = h('div', { class: 'bs-list' });
  const pathOf = (pid: string) => {
    const out: string[] = [];
    let p = app.docs.find((x) => x.id === pid);
    while (p) { out.unshift(p.title || 'Sin título'); const id = p.parentId; p = app.docs.find((x) => x.id === id); }
    return out.join(' / ');
  };
  const row = (id: string, title: string, ic: string, sub: string, when?: string) =>
    h('button', { class: 'bs-row', onclick: () => { close(); void app.open(id); } },
      h('span', { class: 'bs-row-ic', html: docIcon(ic, 18) }),
      h('span', { class: 'bs-row-text' }, h('span', { class: 'bs-row-title' }, title || 'Sin título'), h('span', { class: 'bs-row-sub' }, sub)),
      when ? h('span', { class: 'bs-row-when' }, when) : null);
  const draw = debounce(async () => {
    const q = input.value.trim();
    list.innerHTML = '';
    if (!q) {
      list.append(h('div', { class: 'bs-list-title' }, 'Recientes'));
      for (const d of app.docs.filter((x) => !x.trashed).sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 30)) {
        list.append(row(d.id, d.title, d.icon, pathOf(d.parentId) || 'Documentos', relTime(d.updated)));
      }
      return;
    }
    const hits = await api.Search(q);
    list.append(h('div', { class: 'bs-list-title' }, hits.length ? `${hits.length} resultados` : 'Sin resultados'));
    for (const hit of hits) list.append(row(hit.id, hit.title, hit.icon, hit.snippet));
  }, 120);
  input.addEventListener('input', draw);
  main.append(pageHead('Abrir'), h('div', { class: 'bs-open-bar' }, input,
    h('button', { class: 'btn', onclick: () => { close(); void dialogs.importDialog(app); } }, h('span', { html: icon('upload') }), 'Importar archivo…')), list);
  draw();
  requestAnimationFrame(() => input.focus());
}

// ---------- Opciones comunes de exportación ----------
function exportOptions(app: App, onChange?: () => void) {
  const hasSolutions = JSON.stringify(app.editor.getJSON()).includes('"solution":true');
  const student = h('input', { type: 'checkbox', disabled: !hasSolutions, checked: hasSolutions && !!app.settings.exportStudent });
  const title = h('input', { type: 'checkbox', checked: !app.settings.exportNoTitle });
  student.addEventListener('change', () => onChange?.());
  title.addEventListener('change', () => onChange?.());
  const box = h('div', { class: 'export-opts' },
    h('label', { class: 'check' }, title, h('span', {}, 'Incluir el título del documento')),
    h('label', { class: `check ${hasSolutions ? '' : 'disabled'}` }, student,
      h('span', {}, 'Versión del alumnado', h('small', { class: 'muted' }, hasSolutions ? ' · oculta los bloques de solución' : ' · este documento no tiene soluciones'))),
  );
  return { box, get: (): ExportOptions => ({ studentVersion: student.checked, includeTitle: title.checked }) };
}

/** Resumen de la página del documento con acceso a «Configurar página». */
function pageSummary(app: App, refresh: () => void) {
  const d = app.doc!;
  const [w, hgt] = pageSizeMM(d.setup);
  return h('div', { class: 'bs-print-summary' },
    h('div', {}, h('strong', {}, d.setup.paper === 'Letter' ? 'Carta' : d.setup.paper), ` · ${Math.round(w)} × ${Math.round(hgt)} mm`),
    h('div', {}, d.setup.orientation === 'landscape' ? 'Orientación horizontal' : 'Orientación vertical'),
    h('div', {}, `Márgenes: ${d.setup.marginTop} / ${d.setup.marginRight} / ${d.setup.marginBottom} / ${d.setup.marginLeft} mm`),
    h('div', {}, d.setup.header || d.setup.footer ? 'Con encabezado o pie' : 'Sin encabezado ni pie'),
    h('div', {}, d.setup.pageNumbers ? 'Con números de página' : 'Sin números de página'),
    h('button', { class: 'linklike', onclick: () => void dialogs.pageSetupDialog(app).then(refresh) }, 'Configurar página…'));
}

// ---------- Exportar ----------
function exportPage(app: App, main: HTMLElement, initial: Format, close: () => void, show: (p: BackstagePage, s?: SettingsSection) => void) {
  const d = app.doc!;
  const formats = EXPORT_FORMATS;
  let chosen = initial;
  const list = h('div', { class: 'bs-formats' });
  const draw = () => {
    list.innerHTML = '';
    for (const f of formats) {
      list.append(h('button', { class: `bs-format ${f.id === chosen ? 'on' : ''}`, onclick: () => { chosen = f.id; draw(); } },
        h('span', { class: 'bs-tile-ic', html: icon(f.ic, 22) }), h('span', { class: 'bs-tile-text' }, h('strong', {}, f.label), h('span', {}, f.desc))));
    }
  };
  draw();
  const opts = exportOptions(app);
  const go = h('button', { class: 'btn btn-primary bs-go', onclick: async () => { if (await runExport(app, chosen, opts.get())) close(); } }, h('span', { html: icon('download') }), 'Exportar…');
  main.append(pageHead('Exportar', `«${d.meta.title || 'Sin título'}»`), h('div', { class: 'bs-export' }, list, h('div', { class: 'bs-export-side' },
    go, h('h3', {}, 'Opciones'), opts.box, h('h3', {}, 'Página'), pageSummary(app, () => show('export')),
    h('button', { class: 'linklike bs-defaults', onclick: () => show('settings', 'export') }, 'Cambiar los valores predeterminados…'))));
}

/** Exporta y devuelve true si se ha guardado un archivo. */
async function runExport(app: App, format: Format, o: ExportOptions): Promise<boolean> {
  const d = app.doc;
  if (!d) return false;
  await app.flush();
  const name = (d.meta.title || 'Documento') + (o.studentVersion ? ' (alumno)' : '');
  try {
    let path = '';
    if (format === 'docx') {
      if (!app.native) throw new Error('La exportación a Word está disponible en la aplicación de escritorio.');
      path = await api.ExportDocx(d.meta.id, o);
    } else {
      const layout = await app.layoutFor(o);
      const html = await buildExportHTML(app.editor.getJSON(), d.meta, d.setup, { ...o, embedImages: format === 'html', author: app.settings.authorName, layout });
      if (format === 'pdf') {
        if (!app.native) { await printHTML(html); return true; }
        path = await api.ExportPDF(name, html);
      } else if (format === 'html') {
        path = await api.SaveTextFile(`${name}.html`, html, 'Página web (*.html)', '*.html');
      } else {
        const body = new DOMParser().parseFromString(html, 'text/html').querySelector('main')!;
        body.querySelector('.doc-title')?.remove();
        path = await api.SaveTextFile(`${name}.md`, `# ${d.meta.title}\n\n` + await toMarkdown(body.innerHTML), 'Markdown (*.md)', '*.md');
      }
    }
    if (path) toast(`Exportado: ${path.split(/[\\/]/).pop()}`, { kind: 'ok', action: isDesktop ? { label: 'Abrir carpeta', run: () => void api.RevealFile(path) } : undefined, ms: 5000 });
    return !!path;
  } catch (e) {
    const msg = String(e);
    if (format === 'pdf' && /Chrome|Edge|Chromium/.test(msg)) {
      toast('No hay Chrome ni Edge para crear el PDF directamente; se abre el diálogo de impresión.', { ms: 4000 });
      await printHTML(await buildExportHTML(app.editor.getJSON(), d.meta, d.setup, { ...o, embedImages: false, author: app.settings.authorName, layout: await app.layoutFor(o) }));
    } else toast(msg, { kind: 'error', ms: 6000 });
    return false;
  }
}

// ---------- Imprimir (con vista previa) ----------
function printPage(app: App, main: HTMLElement, show: (p: BackstagePage, s?: SettingsSection) => void) {
  const d = app.doc!;
  const frame = h('iframe', { class: 'bs-preview', title: 'Vista previa de impresión' });
  const render = debounce(async () => {
    const html = await build();
    frame.srcdoc = html.replace('</style>', 'body{background:transparent!important}.doc{margin:12px auto 24px!important;box-shadow:0 1px 6px rgba(0,0,0,.18)!important}</style>');
  }, 150);
  const opts = exportOptions(app, render);
  const summary = pageSummary(app, () => show('print'));
  async function build() {
    const o = opts.get();
    return buildExportHTML(app.editor.getJSON(), d.meta, d.setup, { ...o, embedImages: false, author: app.settings.authorName, layout: await app.layoutFor(o) });
  }
  const printBtn = h('button', { class: 'btn btn-primary bs-go', onclick: async () => printHTML(await build()) }, h('span', { html: icon('print') }), 'Imprimir…');
  const pdfBtn = h('button', { class: 'btn bs-go', onclick: async () => {
    const html = await build();
    try {
      const path = await api.ExportPDF(d.meta.title + (opts.get().studentVersion ? ' (alumno)' : ''), html);
      if (path) toast(`PDF guardado: ${path.split(/[\\/]/).pop()}`, { kind: 'ok', action: { label: 'Abrir carpeta', run: () => void api.RevealFile(path) }, ms: 5000 });
    } catch (e) {
      toast(String(e), { kind: 'error', ms: 6000 });
      await printHTML(html);
    }
  } }, h('span', { html: icon('pdf') }), 'Guardar como PDF…');
  main.append(pageHead('Imprimir'), h('div', { class: 'bs-print' },
    h('div', { class: 'bs-print-side' }, printBtn, pdfBtn, h('h3', {}, 'Opciones'), opts.box, h('h3', {}, 'Página'), summary,
      h('button', { class: 'linklike bs-defaults', onclick: () => show('settings', 'export') }, 'Cambiar los valores predeterminados…')),
    h('div', { class: 'bs-preview-wrap' }, frame)));
  render();
}
