// Temario: lista de temas (número y título) con sus apuntes adjuntos. Se
// rellena a mano (admite pegar varias líneas) o sacando el índice de un
// documento; antes de aceptar se ve lo detectado y reimportar no duplica
// (se empareja por número). Bloque, extensión y documento enlazado van en
// el menú «⋯» de cada tema.
import type { JSONContent } from '@tiptap/core';
import type { App } from '../app';
import { api } from '../api';
import { h, modal, popupMenu, toast } from '../ui/dom';
import { icon } from '../ui/icons';
import { importToJSON } from '../io';
import { jsonToText } from '../templates';
import type { Topic } from './model';
import { bulkAttach, noteChip, pickNotesFor, removeNote } from './notes';
import type { AgendaView } from './view';

interface Found { number: number; title: string; block?: string; content: JSONContent[]; keep: boolean }

const WEIGHTS: [number, string][] = [[0.5, 'Corto'], [1, 'Normal'], [1.5, 'Largo'], [2, 'Muy largo']];
const TEMA = /^\s*tema\s*(\d{1,3})\s*[.:)\-–—]?\s*(.*)$/i;

export async function topicsDialog(view: AgendaView, app: App) {
  const st = view.state;
  let list: Topic[] = st.topics.map((t) => ({ ...t }));
  const rows = h('div', { class: 'ag-topics', role: 'list', 'aria-label': 'Temas' });
  const count = h('span', { class: 'muted small', 'aria-live': 'polite' });
  const clean = () => list.filter((t) => t.title.trim());

  /** Guarda lo que haya (hace falta antes de adjuntar archivos a un tema nuevo). */
  const persist = async () => {
    await st.setTopics(clean(), false);
    list = st.topics.map((t) => ({ ...t }));
  };

  const draw = (focus = -1) => {
    list.sort((a, b) => a.number - b.number);
    const withNotes = list.filter((t) => t.files?.length || t.docId).length;
    count.textContent = list.length ? `${list.length} ${list.length === 1 ? 'tema' : 'temas'} · ${withNotes} con apuntes` : '';
    empty.hidden = !!list.length;
    rows.hidden = !list.length;
    rows.replaceChildren(...list.map((t, i) => row(t, i)));
    if (focus >= 0) (rows.children[focus]?.querySelector('.ag-topic-title') as HTMLInputElement | null)?.focus();
  };

  const row = (t: Topic, i: number): HTMLElement => {
    const num = h('input', { class: 'input input-sm ag-num', type: 'number', min: '1', value: String(t.number), 'aria-label': `Número del tema ${t.title}` });
    num.addEventListener('change', () => { t.number = Math.max(1, Number(num.value) || t.number); draw(); });
    const title = h('input', { class: 'input input-sm ag-topic-title', value: t.title, placeholder: 'Título del tema', 'aria-label': `Título del tema ${t.number}` });
    title.addEventListener('input', () => { t.title = title.value; });
    title.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!text.includes('\n')) return;
      e.preventDefault();
      const lines = fromText(text);
      t.title = lines[0].title;
      if (lines[0].number) t.number = lines[0].number;
      addFound(lines.slice(1));
      draw(i);
    });
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addBlank(t.number + 1, t.block); draw(i + 1); }
      else if (e.key === 'Backspace' && !title.value && list.length) { e.preventDefault(); list.splice(i, 1); draw(Math.max(0, i - 1)); }
    });
    const extra = [t.block, Math.abs(t.weight - 1) > 0.01 ? WEIGHTS.find(([v]) => Math.abs(v - t.weight) < 0.01)?.[1].toLowerCase() : ''].filter(Boolean).join(' · ');
    const doc = t.docId ? app.docs.find((d) => d.id === t.docId && !d.trashed) : undefined;
    const notes = h('div', { class: 'ag-notes' },
      ...(t.files ?? []).map((f) => noteChip(f, async () => { const u = await removeNote(view, t, f); if (u) { t.files = u.files; draw(); } })),
      doc ? h('span', { class: 'ag-note' }, h('button', { type: 'button', class: 'ag-note-open', title: 'Abrir el documento de Folio', onclick: async () => { await save(false); await app.setMode('docs'); await app.open(doc.id); close?.(null); } },
        h('span', { html: icon('docs', 14), 'aria-hidden': 'true' }), h('span', { class: 'ag-note-name' }, doc.title || 'Sin título'))) : null);
    const attachBtn = h('button', { type: 'button', class: 'icon-btn', title: 'Añadir apuntes a este tema', 'aria-label': `Añadir apuntes al tema ${t.number}`, html: icon('upload', 15),
      onclick: async () => {
        if (!t.title.trim()) { toast('Escribe primero el título del tema.'); title.focus(); return; }
        if (!t.id) await persist();
        const saved = list.find((x) => x.number === t.number && x.title === t.title.trim()) ?? t;
        const u = await pickNotesFor(view, saved);
        if (u) { saved.files = u.files; draw(); }
      } });
    const moreBtn: HTMLButtonElement = h('button', { type: 'button', class: 'icon-btn', title: 'Más opciones del tema', 'aria-label': `Más opciones del tema ${t.number}`, html: icon('more', 15),
      onclick: () => popupMenu(moreBtn, [
        { heading: 'Extensión (cuánto tiempo le da el plan)' },
        ...WEIGHTS.map(([v, l]) => ({ label: l, checked: Math.abs(t.weight - v) < 0.01, run: () => { t.weight = v; draw(); } })),
        { separator: true },
        { label: t.block ? `Bloque: ${t.block}…` : 'Poner en un bloque…', icon: 'layers', run: async () => { const b = await askText('Bloque del tema', 'Por ejemplo: Bloque I, Derecho constitucional…', t.block ?? ''); if (b !== null) { t.block = b || undefined; draw(); } } },
        { label: doc ? 'Cambiar el documento de Folio enlazado…' : 'Enlazar un documento de Folio…', icon: 'docs', run: async () => { const id = await pickDoc(app, t.docId); if (id !== null) { t.docId = id || undefined; draw(); } } },
        { separator: true },
        { label: 'Quitar del temario', icon: 'trash', danger: true, run: () => { list.splice(i, 1); draw(Math.min(i, list.length - 1)); } },
      ], { align: 'right' }) });
    return h('div', { class: 'ag-topic-row', role: 'listitem' }, num,
      h('div', { class: 'ag-topic-main' }, title, extra ? h('span', { class: 'ag-topic-extra muted small' }, extra) : null, notes),
      attachBtn, moreBtn);
  };

  const nextNumber = () => (list.length ? Math.max(...list.map((t) => t.number)) + 1 : 1);
  const addBlank = (n = nextNumber(), block?: string) => {
    for (const t of list) if (t.number >= n) t.number++;
    list.push({ id: '', number: n, title: '', block, weight: 1, studyMinutes: 0 });
  };
  const addFound = (found: { number?: number; title: string; block?: string; docId?: string }[]) => {
    for (const f of found) {
      const n = f.number ?? nextNumber();
      const existing = list.find((t) => t.number === n);
      if (existing) { existing.title = f.title || existing.title; existing.block = f.block ?? existing.block; existing.docId = f.docId ?? existing.docId; }
      else list.push({ id: '', number: n, title: f.title, block: f.block, weight: 1, studyMinutes: 0, docId: f.docId });
    }
  };

  const pasteList = async () => {
    const ta = h('textarea', { class: 'input', rows: 10, placeholder: 'Tema 1. La Constitución española de 1978\nTema 2. Derechos fundamentales\n…' });
    const r = await modal('Pegar el temario', h('div', { class: 'ag-form' }, h('p', { class: 'muted small' }, 'Un tema por línea. Si empieza por «Tema 3.» o «3.», se usa ese número.'), ta), [{ label: 'Cancelar', value: null, kind: 'ghost' }, { label: 'Añadir', value: 'ok', kind: 'primary' }], { onOpen: () => setTimeout(() => ta.focus(), 30) });
    if (r === 'ok' && ta.value.trim()) { addFound(fromText(ta.value)); draw(); }
  };
  const addMenu = (anchor: HTMLElement) => popupMenu(anchor, [
    { label: 'Escribir un tema', icon: 'pencil', run: () => { addBlank(); draw(list.length - 1); } },
    { label: 'Pegar una lista de temas…', icon: 'clipboard', run: () => void pasteList() },
    { separator: true },
    { label: 'Sacar el índice de un documento de Folio…', icon: 'docs', run: async () => {
      const found = await pickFolioDoc(app);
      if (found) await reviewImport(app, found.items, found.parentId, (items) => { addFound(items); draw(); });
    } },
    { label: 'Sacar el índice de un archivo (.docx, .md, .txt)…', icon: 'file', run: async () => {
      const f = await api.OpenImportFile().catch((e) => { toast(String(e), { kind: 'error' }); return null; });
      if (!f) return;
      try {
        const json = await importToJSON(f.ext, f.data, '');
        await reviewImport(app, extract(json), '', (items) => { addFound(items); draw(); });
      } catch (e) { toast(`No se pudo leer el archivo: ${e}`, { kind: 'error', ms: 6000 }); }
    } },
  ]);

  const addBtn: HTMLButtonElement = h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => addMenu(addBtn) },
    h('span', { html: icon('plus', 14) }), 'Añadir temas', h('span', { html: icon('chevronDown', 12) }));
  const notesBtn = h('button', { type: 'button', class: 'btn btn-sm', title: 'Elige varios archivos: cada uno va a su tema según el número de su nombre («Tema 3.pdf», «T03…»)',
    onclick: async () => {
      if (!clean().length) { toast('Primero añade los temas.'); return; }
      if (list.some((t) => !t.id && t.title.trim())) await persist();
      if (await bulkAttach(view, list)) { list = st.topics.map((t) => ({ ...t })); draw(); }
    } }, h('span', { html: icon('upload', 14) }), 'Añadir apuntes…');

  const empty = h('div', { class: 'pm-empty' }, h('span', { html: icon('layers', 28) }),
    h('p', {}, h('strong', {}, 'Aún no hay temas.')),
    h('p', { class: 'muted small' }, 'Escríbelos, pega la lista (un tema por línea) o saca el índice de un documento. Luego adjunta a cada tema sus apuntes en PDF o Word.'));
  const intro = h('p', { class: 'ag-topics-intro' },
    'Folio reparte estos temas en tu calendario: primero los estudias y después te los vuelve a poner para repasarlos justo antes de que se te olviden. ',
    h('span', { class: 'muted' }, 'Adjunta a cada tema sus apuntes y los tendrás a mano en cada estudio o repaso.'));
  const body = h('div', { class: 'ag-form' }, intro,
    h('div', { class: 'pm-tools' }, addBtn, notesBtn, h('div', { class: 'spacer' }), count),
    empty, rows);
  draw();
  let close: ((v: any) => void) | undefined;
  const save = async (plan: boolean) => {
    const c = clean();
    await st.setTopics(c, false);
    if (plan && c.length) await st.plan();
  };
  const res = await modal<'ok'>('Temario', body, [{ label: 'Cancelar', value: null, kind: 'ghost' }, { label: 'Guardar y planificar', value: 'ok', kind: 'primary' }],
    { wide: true, className: 'ag-modal ag-topics-modal', onOpen: (c) => { close = c; } });
  if (res !== 'ok') return;
  await save(true);
}

async function askText(title: string, placeholder: string, value: string): Promise<string | null> {
  const input = h('input', { class: 'input', value, placeholder });
  const r = await modal(title, h('div', { class: 'ag-form' }, input), [{ label: 'Cancelar', value: null, kind: 'ghost' }, { label: 'Aceptar', value: 'ok', kind: 'primary' }],
    { className: 'is-small', onOpen: (close) => { setTimeout(() => input.focus(), 30); input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close('ok'); }); } });
  return r === 'ok' ? input.value.trim() : null;
}

/** Elige un documento de Folio para enlazarlo como apuntes ("" = quitar el enlace, null = cancelar). */
async function pickDoc(app: App, current?: string): Promise<string | null> {
  const docs = app.docs.filter((d) => !d.trashed);
  const sel = h('select', { class: 'input', 'aria-label': 'Documento' }, h('option', { value: '' }, 'Ninguno'),
    ...docs.map((d) => h('option', { value: d.id, selected: d.id === current }, d.title || 'Sin título')));
  const r = await modal('Documento de Folio con los apuntes', h('div', { class: 'ag-form' }, h('p', { class: 'muted small' }, 'Si escribes los apuntes de este tema en Folio, enlázalos aquí para abrirlos desde el repaso.'), sel),
    [{ label: 'Cancelar', value: null, kind: 'ghost' }, { label: 'Aceptar', value: 'ok', kind: 'primary' }], { className: 'is-small' });
  return r === 'ok' ? sel.value : null;
}

/** Líneas de texto → temas. */
export function fromText(text: string): { number?: number; title: string }[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = TEMA.exec(l) ?? /^\s*(\d{1,3})\s*[.:)\-–—]\s*(.+)$/.exec(l);
    return m ? { number: Number(m[1]), title: (m[2] || '').trim() || `Tema ${m[1]}` } : { title: l };
  });
}

/** Detecta los temas de un documento: «Tema N» en títulos, párrafos o listas; si no, los títulos más frecuentes; si no, la lista numerada. */
export function extract(doc: JSONContent): Found[] {
  const nodes = doc.content ?? [];
  const text = (n: JSONContent) => jsonToText(n).replace(/\s+/g, ' ').trim();
  const out: Found[] = [];
  let block: string | undefined;
  let current: Found | null = null;
  const temaNodes = nodes.filter((n) => (n.type === 'heading' || n.type === 'paragraph') && TEMA.test(text(n)));
  if (temaNodes.length >= 2) {
    const level = (n: JSONContent) => (n.type === 'heading' ? n.attrs?.level ?? 2 : 9);
    const temaLevel = Math.min(...temaNodes.map(level));
    for (const n of nodes) {
      const t = text(n);
      const m = TEMA.exec(t);
      if (m) {
        current = { number: Number(m[1]), title: m[2].trim() || `Tema ${m[1]}`, block, content: [], keep: true };
        out.push(current);
      } else if (n.type === 'heading' && level(n) < temaLevel) { block = t; current = null; }
      else current?.content.push(n);
    }
    return out;
  }
  const headings = nodes.filter((n) => n.type === 'heading' && n.attrs?.level <= 3);
  const byLevel = new Map<number, number>();
  for (const n of headings) byLevel.set(n.attrs!.level, (byLevel.get(n.attrs!.level) ?? 0) + 1);
  const best = [...byLevel.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  if (best) {
    let num = 0;
    for (const n of nodes) {
      if (n.type === 'heading' && n.attrs?.level === best[0]) {
        const t = text(n);
        const m = /^\s*(\d{1,3})\s*[.:)\-–—]\s*(.+)$/.exec(t);
        num = m ? Number(m[1]) : num + 1;
        current = { number: num, title: m ? m[2] : t, block, content: [], keep: true };
        out.push(current);
      } else if (n.type === 'heading' && n.attrs?.level < best[0]) { block = text(n); current = null; }
      else current?.content.push(n);
    }
    return out;
  }
  const ol = nodes.find((n) => n.type === 'orderedList' && (n.content?.length ?? 0) >= 2);
  if (ol) return (ol.content ?? []).map((li, i) => ({ number: (ol.attrs?.start ?? 1) + i, title: text(li), content: [], keep: true }));
  return fromText(nodes.map(text).join('\n')).map((f, i) => ({ number: f.number ?? i + 1, title: f.title, content: [], keep: true }));
}

async function pickFolioDoc(app: App): Promise<{ items: Found[]; parentId: string } | null> {
  const docs = app.docs.filter((d) => !d.trashed);
  if (!docs.length) { toast('No hay documentos en Folio.'); return null; }
  const sel = h('select', { class: 'input', 'aria-label': 'Documento' }, ...docs.map((d) => h('option', { value: d.id, selected: d.id === app.doc?.meta.id }, d.title || 'Sin título')));
  const r = await modal('Importar el temario de un documento', h('div', { class: 'ag-form' }, h('p', { class: 'muted small' }, 'Se buscan «Tema 1…», los títulos del documento o una lista numerada.'), sel),
    [{ label: 'Cancelar', value: null, kind: 'ghost' }, { label: 'Buscar temas', value: 'ok', kind: 'primary' }]);
  if (r !== 'ok') return null;
  if (app.doc?.meta.id === sel.value) await app.flush();
  const d = await api.GetDoc(sel.value);
  const json = typeof d.content === 'string' ? JSON.parse(d.content) : d.content;
  return { items: extract(json), parentId: d.meta.id };
}

/** Vista previa de lo detectado: se marca qué entra y, si se quiere, se crea un documento de apuntes por tema. */
async function reviewImport(app: App, found: Found[], parentId: string, accept: (items: { number: number; title: string; block?: string; docId?: string }[]) => void) {
  if (!found.length) { toast('No he encontrado temas en el documento. Prueba a pegar la lista.', { kind: 'error' }); return; }
  const rows = h('div', { class: 'ag-found' }, ...found.map((f) => {
    const box = h('input', { type: 'checkbox', checked: f.keep, 'aria-label': `Incluir el tema ${f.number}` });
    box.addEventListener('change', () => { f.keep = box.checked; });
    const title = h('input', { class: 'input input-sm', value: f.title, 'aria-label': `Título del tema ${f.number}` });
    title.addEventListener('input', () => { f.title = title.value; });
    return h('label', { class: 'ag-found-row' }, box, h('span', { class: 'ag-found-n' }, String(f.number)), title, f.block ? h('span', { class: 'muted small ag-found-b' }, f.block) : null);
  }));
  const withContent = found.some((f) => f.content.length);
  const makeDocs = h('input', { type: 'checkbox', checked: false });
  const body = h('div', { class: 'ag-form' },
    h('p', {}, `He encontrado ${found.length} temas. Desmarca lo que no sea un tema y corrige los títulos si hace falta.`),
    rows,
    withContent ? h('label', { class: 'ag-check' }, makeDocs, 'Crear un documento de apuntes por tema con su contenido y enlazarlo') : null);
  const r = await modal('Temas detectados', body, [{ label: 'Cancelar', value: null, kind: 'ghost' }, { label: 'Añadir al temario', value: 'ok', kind: 'primary' }], { wide: true, className: 'ag-modal' });
  if (r !== 'ok') return;
  const keep = found.filter((f) => f.keep && f.title.trim());
  const items: { number: number; title: string; block?: string; docId?: string }[] = [];
  for (const f of keep) {
    let docId: string | undefined;
    if (makeDocs.checked && f.content.length) {
      const m = await app.createFromJSON(`Tema ${f.number}. ${f.title}`, 'bookOpen', { type: 'doc', content: f.content }, parentId);
      docId = m.id;
    }
    items.push({ number: f.number, title: f.title.trim(), block: f.block, docId });
  }
  if (makeDocs.checked) await app.refreshDocs();
  accept(items);
  toast(`${items.length} temas añadidos${makeDocs.checked ? ' con sus apuntes' : ''}`, { kind: 'ok' });
}
