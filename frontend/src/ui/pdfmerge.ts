// Unir PDF: lista de archivos que se reordena (arrastrando o con Alt+↑/↓),
// con rango de páginas opcional por archivo, marcadores y el documento actual
// de Folio como un archivo más. La unión la hace el backend con pdfcpu.
import type { App } from '../app';
import { api } from '../api';
import { isDesktop } from '../platform/platform';
import { buildExportHTML } from '../io';
import { h, modal, toast } from './dom';
import { icon } from './icons';
import type { PdfFile } from '../types';

interface Row extends PdfFile { range: string }

const state = { rows: [] as Row[], bookmarks: true, open: true };
/** Redibuja la lista si el diálogo está abierto (para los PDF soltados en la ventana). */
let redraw: (() => void) | null = null;

/** PDF soltados sobre la ventana: se añaden al diálogo abierto o lo abren. */
export async function dropPdfs(app: App, paths: string[]) {
  const pdfs = paths.filter((p) => p.toLowerCase().endsWith('.pdf'));
  if (!pdfs.length) return;
  const files = await api.PdfInfo(pdfs);
  if (redraw) { add(files); redraw(); } else void pdfMergeDialog(app, files);
}

/** Abre el diálogo; `initial` son PDF ya elegidos (por ejemplo, soltados en la ventana). */
export async function pdfMergeDialog(app: App, initial: PdfFile[] = []) {
  if (!app.native) {
    toast('Unir PDF está disponible en la aplicación de escritorio.', { kind: 'error' });
    return;
  }
  add(initial);
  for (;;) {
    const list = h('ol', { class: 'pm-list', 'aria-label': 'Archivos que se unirán, en orden' });
    const summary = h('p', { class: 'pm-summary muted small', 'aria-live': 'polite' });
    const body = h('div', { class: 'pm' });
    let merge: HTMLButtonElement | null = null;

    const draw = (focusIndex = -1) => {
      list.replaceChildren(...state.rows.map((r, i) => rowEl(r, i)));
      list.hidden = !state.rows.length;
      empty.hidden = !!state.rows.length;
      const ok = state.rows.filter((r) => !r.error);
      const pages = ok.reduce((n, r) => n + r.pages, 0);
      summary.textContent = state.rows.length
        ? `${ok.length} ${ok.length === 1 ? 'archivo' : 'archivos'} · ${pages} páginas en total${ok.length < state.rows.length ? ' · los marcados en rojo no se pueden unir' : ''}`
        : '';
      if (merge) merge.disabled = ok.length < 2 || ok.length < state.rows.length;
      if (focusIndex >= 0) (list.children[focusIndex]?.querySelector('.pm-name') as HTMLElement | null)?.focus();
    };

    const move = (i: number, to: number) => {
      if (to < 0 || to >= state.rows.length) return;
      const [r] = state.rows.splice(i, 1);
      state.rows.splice(to, 0, r);
      draw(to);
    };

    let dragFrom = -1;
    const rowEl = (r: Row, i: number) => {
      const name = h('input', { class: 'pm-name', value: r.name, 'aria-label': `Nombre del archivo ${i + 1} (se usa como marcador)`, title: r.path });
      name.addEventListener('input', () => { r.name = name.value; });
      const range = h('input', { class: 'input input-sm pm-range', value: r.range, placeholder: 'Todas', 'aria-label': `Páginas de ${r.name} (por ejemplo 1-3, 7)`, title: 'Páginas que se incluyen, por ejemplo «1-3, 7». Vacío = todas.' });
      range.addEventListener('input', () => { r.range = range.value; });
      const btn = (ic: string, label: string, run: () => void, disabled = false) =>
        h('button', { class: 'icon-btn', title: label, 'aria-label': label, html: icon(ic, 15), disabled, onclick: run });
      const li = h('li', { class: `pm-row ${r.error ? 'is-bad' : ''}`, draggable: 'true' },
        h('span', { class: 'pm-grip', html: icon('grip', 15), 'aria-hidden': 'true' }),
        h('span', { class: 'pm-ic', html: icon('file', 18) }),
        h('div', { class: 'pm-main' }, name,
          h('span', { class: 'pm-meta' }, r.error ? `No se puede usar: ${r.error}` : `${r.pages} ${r.pages === 1 ? 'página' : 'páginas'}`)),
        range,
        btn('chevronUp', 'Subir (Alt+↑)', () => move(i, i - 1), i === 0),
        btn('chevronDown', 'Bajar (Alt+↓)', () => move(i, i + 1), i === state.rows.length - 1),
        btn('x', 'Quitar (Supr)', () => { state.rows.splice(i, 1); draw(Math.min(i, state.rows.length - 1)); }));
      li.addEventListener('keydown', (e) => {
        if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); move(i, i - 1); }
        else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); move(i, i + 1); }
        else if (e.key === 'Delete' && (e.target as HTMLElement).classList.contains('pm-name') && !(e.target as HTMLInputElement).value) { state.rows.splice(i, 1); draw(i); }
      });
      li.addEventListener('dragstart', (e) => { dragFrom = i; li.classList.add('dragging'); e.dataTransfer?.setData('text/plain', String(i)); });
      li.addEventListener('dragend', () => li.classList.remove('dragging'));
      li.addEventListener('dragover', (e) => { if (dragFrom >= 0) { e.preventDefault(); li.classList.add('drop-target'); } });
      li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
      li.addEventListener('drop', (e) => { e.preventDefault(); if (dragFrom >= 0 && dragFrom !== i) move(dragFrom, i); dragFrom = -1; });
      return li;
    };

    const empty = h('div', { class: 'pm-empty' },
      h('span', { html: icon('file', 28) }),
      h('p', {}, 'Añade los PDF que quieras juntar. También puedes soltarlos sobre la ventana de Folio.'));
    const addPdfs = h('button', { class: 'btn btn-sm', onclick: async () => {
      try { add(await api.ChoosePdfs() ?? []); draw(); } catch (e) { toast(String(e), { kind: 'error' }); }
    } }, h('span', { html: icon('plus', 15) }), 'Añadir PDF…');
    const addDoc = h('button', { class: 'btn btn-sm', disabled: !app.doc, title: app.doc ? `Añadir «${app.doc.meta.title || 'Sin título'}» como PDF` : 'No hay ningún documento abierto', onclick: async () => {
      addDoc.disabled = true;
      addDoc.textContent = 'Preparando…';
      try { add([await renderCurrent(app)]); draw(); } catch (e) { toast(String(e), { kind: 'error', ms: 6000 }); }
      addDoc.replaceChildren(h('span', { html: icon('page', 15) }), 'Añadir este documento');
      addDoc.disabled = !app.doc;
    } }, h('span', { html: icon('page', 15) }), 'Añadir este documento');
    const opt = (label: string, key: 'bookmarks' | 'open', hint: string) => {
      const box = h('input', { type: 'checkbox', checked: state[key] });
      box.addEventListener('change', () => { state[key] = box.checked; });
      return h('label', { class: 'pm-opt', title: hint }, box, label);
    };
    body.append(
      h('div', { class: 'pm-tools' }, addPdfs, addDoc),
      empty, list, summary,
      h('div', { class: 'pm-opts' },
        opt('Añadir un marcador por archivo', 'bookmarks', 'El índice lateral del PDF tendrá una entrada con el nombre de cada archivo'),
        opt('Abrir al terminar', 'open', 'Abre el PDF unido con el visor del sistema')),
    );
    draw();
    redraw = () => draw();

    const res = await modal<'merge' | null>('Unir PDF', body, [
      { label: 'Cancelar', value: null, kind: 'ghost' },
      { label: 'Unir', value: 'merge', kind: 'primary' },
    ], { wide: true, className: 'pm-modal', onOpen: () => {
      merge = document.querySelector('.pm-modal .modal-foot .btn-primary');
      draw();
    } });
    redraw = null;
    if (res !== 'merge') return;
    try {
      const out = await api.MergePdfs(state.rows.map((r) => ({ path: r.path, name: r.name, pages: r.range })), { bookmarks: state.bookmarks, open: state.open });
      if (!out) continue; // canceló el diálogo de guardar: vuelve a la lista
      toast(`PDF unido: ${out.split(/[\\/]/).pop()}`, { kind: 'ok', ms: 5000, action: isDesktop ? { label: 'Abrir carpeta', run: () => void api.RevealFile(out) } : undefined });
      state.rows = [];
      return;
    } catch (e) {
      toast(String(e), { kind: 'error', ms: 8000 });
    }
  }
}

function add(files: PdfFile[]) {
  for (const f of files) if (!state.rows.some((r) => r.path === f.path)) state.rows.push({ ...f, range: '' });
}

async function renderCurrent(app: App): Promise<PdfFile> {
  const d = app.doc!;
  await app.flush();
  const o = { studentVersion: false, includeTitle: true };
  const layout = await app.layoutFor(o);
  const html = await buildExportHTML(app.editor.getJSON(), d.meta, d.setup, { ...o, embedImages: false, author: app.settings.authorName, layout });
  return api.RenderPdfTemp(d.meta.title || 'Sin título', html);
}
