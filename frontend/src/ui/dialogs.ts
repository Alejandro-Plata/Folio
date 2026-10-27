import type { App } from '../app';
import { defaultSetup } from '../app';
import type { PageSetup } from '../types';
import { h, modal, popover, popupMenu, promptText, toast } from './dom';
import { icon, DOC_ICONS } from './icons';
import { api } from '../api';
import { on } from '../bus';
import { SHORTCUTS } from '../shortcuts';
import { CALLOUT_KINDS } from '../editor/extensions';
import { loadKatex } from '../editor/math';
import { importToJSON } from '../io';
import { FontPicker } from './fontpicker';
import { jsonToText } from '../templates';

// ---------- Icono del documento ----------
export function iconPicker(app: App, docId: string, anchor: HTMLElement, done?: () => void) {
  const grid = h('div', { class: 'icon-grid' });
  const current = app.docs.find((d) => d.id === docId)?.icon;
  const set = async (name: string) => {
    await app.updateMeta(docId, { icon: name });
    p.close();
    done?.();
  };
  for (const name of DOC_ICONS) {
    grid.append(h('button', { class: `icon-choice ${current === name ? 'on' : ''}`, title: name, html: icon(name, 18), onclick: () => void set(name) }));
  }
  const p = popover(anchor, h('div', { class: 'icon-picker' }, h('div', { class: 'field-label' }, 'Icono del documento'), grid,
    h('button', { class: 'btn btn-ghost btn-sm btn-block', onclick: () => void set('') }, 'Sin icono')));
}

export async function importDialog(app: App) {
  let f;
  try { f = await api.OpenImportFile(); } catch (e) { toast(String(e), { kind: 'error' }); return; }
  if (!f) return;
  await app.flush();
  const m = await app.createFromJSON(f.name, '', { type: 'doc', content: [{ type: 'paragraph' }] }, app.doc?.meta.parentId ?? '');
  try {
    const content = await importToJSON(f.ext, f.data, m.id);
    await api.SaveDoc(m.id, JSON.stringify(content), jsonToText(content), jsonToText(content).split(/\s+/).filter(Boolean).length);
    await app.refreshDocs();
    await app.open(m.id);
    toast(`Importado «${f.name}»`, { kind: 'ok' });
  } catch (e) {
    await api.DeleteDoc(m.id);
    await app.refreshDocs();
    toast(`No se pudo importar: ${e}`, { kind: 'error', ms: 6000 });
  }
}

// ---------- Configurar página ----------
/** Formulario de papel, márgenes, texto, encabezado y pie (diálogo y Ajustes). */
export function pageSetupForm(initial: PageSetup, onChange?: () => void) {
  const s: PageSetup = { ...defaultSetup(), ...initial };
  const num = (v: number, step = 1, min = 0, max = 100) => h('input', { class: 'input input-sm', type: 'number', value: String(v), step: String(step), min: String(min), max: String(max) });
  const paper = h('select', { class: 'input input-sm' }, ...['A4', 'A5', 'Letter', 'Legal'].map((p) => h('option', { value: p, selected: s.paper === p }, p === 'Letter' ? 'Carta' : p === 'Legal' ? 'Oficio (Legal)' : p)));
  const orient = h('select', { class: 'input input-sm' }, h('option', { value: 'portrait', selected: s.orientation === 'portrait' }, 'Vertical'), h('option', { value: 'landscape', selected: s.orientation === 'landscape' }, 'Horizontal'));
  const mt = num(s.marginTop), mb = num(s.marginBottom), ml = num(s.marginLeft), mr = num(s.marginRight);
  const presets = h('div', { class: 'chips' }, ...[['Normal', 25, 25, 25, 25], ['Estrecho', 12.7, 12.7, 12.7, 12.7], ['Moderado', 25.4, 25.4, 19.1, 19.1], ['Ancho', 25.4, 25.4, 50.8, 50.8]].map(([n, t, b, l, r]) =>
    h('button', { class: 'chip', type: 'button', onclick: () => { mt.value = String(t); mb.value = String(b); ml.value = String(l); mr.value = String(r); onChange?.(); } }, String(n))));
  const font = new FontPicker({ title: 'Fuente del documento', className: 'input input-sm', onChange: () => onChange?.() });
  font.value = s.fontFamily;
  const size = num(s.fontSize, 0.5, 6, 30);
  const lh = h('select', { class: 'input input-sm' }, ...[1, 1.15, 1.3, 1.5, 1.8, 2].map((v) => h('option', { value: String(v), selected: s.lineHeight === v }, v.toLocaleString('es-ES'))));
  const header = h('input', { class: 'input input-sm', value: s.header, placeholder: 'Ej.: {titulo} · Biología 1º ESO' });
  const footer = h('input', { class: 'input input-sm', value: s.footer, placeholder: 'Ej.: IES … · Departamento de Ciencias' });
  const pnum = h('input', { type: 'checkbox', checked: s.pageNumbers });
  const row = (label: string, ...c: HTMLElement[]) => h('label', { class: 'form-row' }, h('span', {}, label), h('div', { class: 'form-ctrl' }, ...c));
  const el = h('div', { class: 'form' },
    h('h3', {}, 'Papel'), row('Tamaño', paper), row('Orientación', orient),
    h('h3', {}, 'Márgenes (mm)'), presets,
    h('div', { class: 'grid-2' }, row('Superior', mt), row('Inferior', mb), row('Izquierdo', ml), row('Derecho', mr)),
    h('h3', {}, 'Texto del documento'), row('Fuente', font.el), row('Tamaño (pt)', size), row('Interlineado', lh),
    h('h3', {}, 'Encabezado y pie de página'),
    row('Encabezado', header), row('Pie de página', footer),
    h('label', { class: 'check' }, pnum, h('span', {}, 'Numerar páginas («Página X de Y»)')),
    h('p', { class: 'muted small' }, 'Puedes usar {titulo}, {fecha} y {autor}. Se aplican al imprimir, al exportar a PDF y a Word.'),
  );
  if (onChange) { el.addEventListener('input', onChange); el.addEventListener('change', onChange); }
  const n = (i: HTMLInputElement, def: number) => { const v = parseFloat(i.value.replace(',', '.')); return Number.isFinite(v) ? v : def; };
  const get = (): PageSetup => ({
    paper: paper.value as PageSetup['paper'], orientation: orient.value as PageSetup['orientation'],
    marginTop: n(mt, 25), marginBottom: n(mb, 25), marginLeft: n(ml, 25), marginRight: n(mr, 25),
    fontFamily: font.value, fontSize: n(size, 11), lineHeight: parseFloat(lh.value),
    header: header.value, footer: footer.value, pageNumbers: pnum.checked,
  });
  return { el, get };
}

export async function pageSetupDialog(app: App) {
  const d = app.doc;
  if (!d) return;
  const form = pageSetupForm(d.setup);
  const ok = await modal('Configurar página', form.el, [{ label: 'Cancelar', value: false, kind: 'ghost' }, { label: 'Aplicar', value: true, kind: 'primary' }]);
  if (!ok) return;
  await app.setSetup(form.get());
}

// ---------- Ajustes ----------
/** Los ajustes viven en Archivo > Ajustes, junto a Exportar, Imprimir y las plantillas. */
export function settingsDialog(app: App, section?: import('./settings').SettingsSection) {
  void import('./backstage').then((m) => m.openBackstage(app, 'settings', { section }));
}

// ---------- Atajos ----------
export async function shortcutsDialog(app: App) {
  const map = app.keymap;
  const search = h('input', { class: 'input', placeholder: 'Buscar atajo…' });
  const list = h('div', { class: 'shortcut-list' });
  const draw = () => {
    const q = search.value.toLowerCase();
    list.innerHTML = '';
    const groups = new Map<string, typeof SHORTCUTS>();
    for (const s of SHORTCUTS) {
      if (q && !`${s.label} ${s[map].join(' ')}`.toLowerCase().includes(q)) continue;
      if (!groups.has(s.group)) groups.set(s.group, []);
      groups.get(s.group)!.push(s);
    }
    for (const [g, items] of groups) {
      list.append(h('div', { class: 'sc-group' }, h('h3', {}, g), ...items.map((s) =>
        h('div', { class: 'sc-row' }, h('span', {}, s.label), h('span', { class: 'sc-keys' }, ...s[map].map((k) => h('kbd', {}, k.replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→'))))))));
    }
    list.append(h('div', { class: 'sc-group' }, h('h3', {}, 'Escritura rápida'), ...[
      ['/', 'Menú de bloques'], ['# , ## , ###', 'Títulos'], ['- o *', 'Lista con viñetas'], ['1.', 'Lista numerada'], ['[ ]', 'Lista de tareas'],
      ['>', 'Cita'], ['```', 'Bloque de código'], ['---', 'Separador'], ['$x^2$', 'Ecuación en línea'], ['$$ ', 'Ecuación en bloque'],
      ['Mayús+Intro', 'Salto de línea'], ['Tab / Mayús+Tab', 'Sangría en listas y celdas'], ['Ctrl+clic', 'Abrir enlace'],
    ].map(([k, l]) => h('div', { class: 'sc-row' }, h('span', {}, l), h('span', { class: 'sc-keys' }, h('kbd', {}, k))))));
  };
  search.addEventListener('input', draw);
  draw();
  await modal(`Atajos de teclado · ${map === 'es' ? 'Word en español' : 'Word en inglés'}`, h('div', {}, search, list), [], { wide: true });
}

// ---------- Contar palabras ----------
export async function wordCountDialog(app: App) {
  const ed = app.editor;
  const { from, to, empty } = ed.state.selection;
  const text = empty ? ed.getText({ blockSeparator: '\n' }) : ed.state.doc.textBetween(from, to, '\n');
  const words = text.split(/\s+/).filter(Boolean).length;
  let paragraphs = 0, headings = 0, images = 0, tables = 0, equations = 0, notes = 0;
  ed.state.doc.descendants((n) => {
    if (n.type.name === 'paragraph' && n.textContent.trim()) paragraphs++;
    if (n.type.name === 'heading') headings++;
    if (n.type.name === 'image') images++;
    if (n.type.name === 'table') tables++;
    if (n.type.name === 'mathInline' || n.type.name === 'mathBlock') equations++;
    if (n.type.name === 'footnote') notes++;
    return true;
  });
  const rows: [string, string][] = [
    ['Palabras', words.toLocaleString('es-ES')],
    ['Caracteres (sin espacios)', text.replace(/\s/g, '').length.toLocaleString('es-ES')],
    ['Caracteres (con espacios)', text.replace(/\n/g, '').length.toLocaleString('es-ES')],
    ['Párrafos', String(paragraphs)], ['Títulos', String(headings)], ['Páginas', String(app.status.totalPages)],
    ['Imágenes', String(images)], ['Tablas', String(tables)], ['Ecuaciones', String(equations)], ['Notas al pie', String(notes)],
    ['Tiempo de lectura', `${Math.max(1, Math.round(words / 200))} min`], ['Tiempo de lectura en voz alta', `${Math.max(1, Math.round(words / 130))} min`],
  ];
  await modal(empty ? 'Contar palabras' : 'Contar palabras (selección)', h('table', { class: 'stats' }, ...rows.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v)))), [{ label: 'Cerrar', value: null, kind: 'primary' }]);
}

// ---------- Hipervínculo ----------
export async function linkDialog(app: App) {
  const ed = app.editor;
  const prev = ed.getAttributes('link').href as string | undefined;
  const { from, to, empty } = ed.state.selection;
  const textIn = h('input', { class: 'input', placeholder: 'Texto que se mostrará', value: empty ? '' : ed.state.doc.textBetween(from, to, ' ') });
  const urlIn = h('input', { class: 'input', placeholder: 'https://…', value: prev ?? '' });
  const body = h('div', { class: 'form' },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Dirección'), urlIn),
    empty ? h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Texto'), textIn) : null);
  setTimeout(() => urlIn.focus(), 30);
  const r = await modal('Insertar hipervínculo', body, [
    ...(prev ? [{ label: 'Quitar vínculo', value: 'remove', kind: 'danger' as const }] : []),
    { label: 'Cancelar', value: null, kind: 'ghost' }, { label: 'Aceptar', value: 'ok', kind: 'primary' },
  ]);
  if (r === 'remove') { ed.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
  if (r !== 'ok') return;
  let url = urlIn.value.trim();
  if (!url) return;
  if (!/^[a-z]+:/i.test(url) && !url.startsWith('#')) url = (url.includes('@') && !url.includes('/') ? 'mailto:' : 'https://') + url;
  if (empty) {
    const t = textIn.value.trim() || url;
    ed.chain().focus().insertContent({ type: 'text', text: t, marks: [{ type: 'link', attrs: { href: url } }] }).run();
  } else ed.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
}

// ---------- Notas al pie ----------
export async function footnoteDialog(app: App) {
  const t = await promptText('Insertar nota al pie', 'Texto de la nota', '', { placeholder: 'Fuente, aclaración o referencia bibliográfica', ok: 'Insertar' });
  if (t && t.trim()) app.editor.chain().focus().insertFootnote(t.trim()).run();
}

// ---------- Comentarios ----------
export async function commentDialog(app: App) {
  const ed = app.editor;
  if (ed.state.selection.empty) {
    // como Word: sin selección se comenta la palabra actual
    const $p = ed.state.selection.$from;
    const text = $p.parent.textContent;
    let s = $p.parentOffset, e = s;
    while (s > 0 && /\S/.test(text[s - 1])) s--;
    while (e < text.length && /\S/.test(text[e])) e++;
    if (s === e) { toast('Selecciona el texto que quieres comentar'); return; }
    ed.commands.setTextSelection({ from: $p.start() + s, to: $p.start() + e });
  }
  const t = await promptText('Nuevo comentario', 'Comentario', '', { multiline: true, placeholder: 'Escribe tu comentario… (Ctrl+Intro para guardar)', ok: 'Comentar' });
  if (!t || !t.trim()) return;
  const id = Math.random().toString(36).slice(2, 10);
  ed.chain().focus().setComment({ id, text: t.trim(), author: app.settings.authorName || 'Yo' }).run();
  app.panels.show('comments');
}

// ---------- Ecuaciones ----------
const MATH_SNIPPETS: [string, string][] = [
  ['\\frac{a}{b}', 'a/b'], ['x^{2}', 'xⁿ'], ['x_{i}', 'xᵢ'], ['\\sqrt{x}', '√'], ['\\sqrt[n]{x}', 'ⁿ√'], ['\\sum_{i=1}^{n}', 'Σ'],
  ['\\int_{a}^{b}', '∫'], ['\\lim_{x \\to \\infty}', 'lím'], ['\\pi', 'π'], ['\\alpha', 'α'], ['\\beta', 'β'], ['\\theta', 'θ'],
  ['\\Delta', 'Δ'], ['\\infty', '∞'], ['\\cdot', '·'], ['\\times', '×'], ['\\div', '÷'], ['\\pm', '±'], ['\\leq', '≤'], ['\\geq', '≥'],
  ['\\neq', '≠'], ['\\approx', '≈'], ['\\rightarrow', '→'], ['\\vec{v}', 'v→'], ['\\overline{AB}', 'AB̄'], ['^{\\circ}', '°'],
  ['\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', '( )'], ['\\left( \\right)', '( )'], ['\\text{texto}', 'abc'],
];

export function mathEditor(anchor: HTMLElement | DOMRect, latex: string, display: boolean, save: (l: string) => void) {
  const ta = h('textarea', { class: 'input math-input', rows: display ? 3 : 2, spellcheck: 'false', placeholder: 'LaTeX, p. ej. \\frac{1}{2} o x^2 + y^2 = r^2' });
  ta.value = latex;
  const preview = h('div', { class: 'math-preview' });
  const draw = () => loadKatex().then((k) => {
    try { k.render(ta.value || '\\square', preview, { throwOnError: true, displayMode: true }); preview.classList.remove('error'); }
    catch (e: any) { preview.textContent = e.message.replace('KaTeX parse error: ', ''); preview.classList.add('error'); }
  });
  draw();
  ta.addEventListener('input', draw);
  const insert = (snip: string) => {
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.setRangeText(snip, s, e, 'end');
    ta.focus();
    draw();
  };
  const snippets = h('div', { class: 'math-snippets' }, ...MATH_SNIPPETS.map(([snip, label]) => h('button', { class: 'chip', title: snip, onclick: () => insert(snip) }, label)));
  let done = false;
  const commit = () => { if (done) return; done = true; save(ta.value.trim()); p.close(); };
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done = true; if (!latex) save(''); p.close(); }
  });
  const content = h('div', { class: 'math-editor' }, preview, ta, snippets,
    h('div', { class: 'math-foot' }, h('span', { class: 'muted small' }, 'Intro para aceptar · Mayús+Intro nueva línea · Esc cancelar'),
      h('button', { class: 'btn btn-sm btn-primary', onclick: commit }, 'Aceptar')));
  const p = popover(anchor, content, { className: 'math-popover', onClose: () => { if (!done) { done = true; save(ta.value.trim()); } } });
  setTimeout(() => { ta.focus(); ta.select(); }, 20);
}

export function mathInlineDialog(app: App) {
  const ed = app.editor;
  const { from, to, empty } = ed.state.selection;
  const initial = empty ? '' : ed.state.doc.textBetween(from, to, ' ');
  const coords = ed.view.coordsAtPos(from);
  mathEditor(new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top), initial, false, (latex) => {
    if (!latex) { ed.commands.focus(); return; }
    ed.chain().focus().insertMathInline(latex).run();
  });
}

export function imageAltDialog(app: App) {
  const img = app.selectedImage();
  if (!img) return;
  void promptText('Texto alternativo', 'Describe la imagen para lectores de pantalla y por si no se carga', img.attrs.alt ?? '', { multiline: true })
    .then((t) => { if (t !== null) app.editor.chain().focus().updateAttributes('image', { alt: t }).run(); });
}

/** Conecta los eventos que emiten los bloques del editor con los diálogos. */
export function registerEditorDialogs(app: App) {
  on('math:edit', ({ latex, display, anchor, save }) => mathEditor(anchor, latex, display, save));
  on('math:edit-last-block', () => {
    // abre el editor de la ecuación en bloque recién insertada (la seleccionada o la anterior al cursor)
    requestAnimationFrame(() => {
      const ed = app.editor;
      let target: HTMLElement | null = null;
      const $from = ed.state.selection.$from;
      ed.state.doc.nodesBetween(0, $from.pos, (n, pos) => {
        if (n.type.name === 'mathBlock' && !n.attrs.latex) target = ed.view.nodeDOM(pos) as HTMLElement;
      });
      (target as HTMLElement | null)?.click();
    });
  });
  on('footnote:edit', ({ text, anchor, save }) => {
    const ta = h('textarea', { class: 'input', rows: 3 });
    ta.value = text;
    let done = false;
    const commit = () => { if (!done) { done = true; save(ta.value); } };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); p.close(); } });
    const p = popover(anchor, h('div', { class: 'footnote-editor' }, h('div', { class: 'field-label' }, 'Nota al pie'), ta,
      h('div', { class: 'math-foot' }, h('button', { class: 'btn btn-sm btn-danger-ghost', onclick: () => { done = true; save(''); p.close(); } }, 'Eliminar nota'),
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => { commit(); p.close(); } }, 'Aceptar'))), { onClose: commit });
    setTimeout(() => ta.focus(), 20);
  });
  on('callout:menu', ({ anchor, set }) => {
    popupMenu(anchor, Object.entries(CALLOUT_KINDS).map(([k, v]) => ({ label: v.label, icon: v.icon, run: () => set(k) })));
  });
  on('ui:insert-image', () => {
    const input = h('input', { type: 'file', accept: 'image/*', multiple: true });
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      if (!files.length || !app.doc) return;
      try {
        await (app.editor as any).uploadImages(files);
      } catch (e) { toast(`No se pudo insertar la imagen: ${e}`, { kind: 'error' }); }
    };
    input.click();
  });
  on('ui:math-inline', () => mathInlineDialog(app));
  on('ui:footnote', () => void footnoteDialog(app));
  on('ui:comment', () => void commentDialog(app));
}
