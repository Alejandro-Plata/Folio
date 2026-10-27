import { Editor, Extension } from '@tiptap/core';
import type { AnyExtension, JSONContent } from '@tiptap/core';
import { AllSelection, EditorState, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { columnResizingPluginKey } from '@tiptap/pm/tables';
import StarterKit from '@tiptap/starter-kit';
import Strike from '@tiptap/extension-strike';
import Code from '@tiptap/extension-code';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import Typography from '@tiptap/extension-typography';
import {
  AnswerLines, BlockFormat, Callout, Comment, FolioImage, FolioTableCell, FolioTableHeader, FontSize,
  Footnote, MathBlock, MathInline, PageBreak, PrintBreak, PrintBreakInline, PrintBreakRow, TableOfContents, Toggle, findAnchor,
} from './extensions';
import { emit } from '../bus';
import { Pagination } from './pagination';
import { Find } from './find';
import { Slash } from './slash';
import { api } from '../api';

function collapseAll(editor: Editor, dir: 1 | -1): boolean {
  const { state, view } = editor;
  if (!(state.selection instanceof AllSelection)) return false;
  const sel = dir > 0 ? TextSelection.atEnd(state.doc) : TextSelection.atStart(state.doc);
  view.dispatch(state.tr.setSelection(sel).scrollIntoView());
  return true;
}

/** Tab inserta tabulación (como Word) cuando no estamos en una lista o tabla. */
const TabKey = Extension.create({
  name: 'tabKey',
  priority: 10,
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.isActive('codeBlock')) return this.editor.commands.insertContent('    ');
        return this.editor.commands.insertContent('\t');
      },
      'Shift-Tab': () => this.editor.commands.outdent(),
      // Tras «Seleccionar todo», Inicio/Fin y las flechas colapsan la selección como en Word
      End: () => collapseAll(this.editor, 1),
      Home: () => collapseAll(this.editor, -1),
      ArrowRight: () => collapseAll(this.editor, 1),
      ArrowDown: () => collapseAll(this.editor, 1),
      ArrowLeft: () => collapseAll(this.editor, -1),
      ArrowUp: () => collapseAll(this.editor, -1),
    };
  },
});

/** Extensiones del esquema: las comparten el editor y la exportación. */
export function schemaExtensions(opts: { smartQuotes?: boolean } = {}): AnyExtension[] {
  const exts: AnyExtension[] = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      strike: false,
      code: false,
      dropcursor: { color: 'var(--accent)', width: 2 },
    }),
    Strike,
    Code,
    Underline,
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    BlockFormat,
    Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: null } }),
    FolioImage.configure({ allowBase64: true }),
    Table.configure({ resizable: true, cellMinWidth: 40 }),
    TableRow,
    FolioTableHeader,
    FolioTableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    PageBreak,
    Callout,
    Toggle,
    AnswerLines,
    MathInline,
    MathBlock,
    Footnote,
    TableOfContents,
    Comment,
    PrintBreak,
    PrintBreakRow,
    PrintBreakInline,
  ];
  if (opts.smartQuotes) {
    exts.push(Typography.configure({ openDoubleQuote: '«', closeDoubleQuote: '»', openSingleQuote: '‘', closeSingleQuote: '’' }));
  }
  return exts;
}

export interface EditorOptions {
  element: HTMLElement;
  smartQuotes: boolean;
  spellcheck: boolean;
  getDocId: () => string | null;
  onUpdate: (e: Editor) => void;
  onSelection: (e: Editor) => void;
}

export function createEditor(o: EditorOptions): Editor {
  const upload = async (files: File[], pos?: number) => {
    const id = o.getDocId();
    if (!id) return;
    for (const f of files) {
      const src = await uploadImage(id, f);
      const node = { type: 'image', attrs: { src, alt: f.name.replace(/\.[^.]+$/, '') } };
      if (pos !== undefined) editor.chain().focus().insertContentAt(pos, node).run();
      else editor.chain().focus().insertContent(node).run();
    }
  };
  const editor: Editor = new Editor({
    element: o.element,
    extensions: [
      ...schemaExtensions({ smartQuotes: o.smartQuotes }),
      Placeholder.configure({
        placeholder: ({ node }) => (node.type.name === 'heading' ? `Título ${node.attrs.level}` : 'Escribe «/» para insertar bloques, ecuaciones, cuadros…'),
      }),
      CharacterCount,
      Find,
      Slash,
      TabKey,
      Pagination,
    ],
    editorProps: {
      attributes: { spellcheck: String(o.spellcheck), lang: 'es', class: 'doc-body' },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        void upload(files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void upload(files, pos);
        return true;
      },
      handleClick: (view, _pos, event) => {
        const a = (event.target as HTMLElement).closest('a');
        const href = a?.getAttribute('href') || '';
        // Enlace a un título del propio documento: basta un clic (también en el móvil)
        if (a && href.startsWith('#')) {
          const pos = findAnchor(view.state.doc, href);
          if (pos !== null) { emit('editor:scroll-to', pos); return true; }
        }
        if (a && (event.ctrlKey || event.metaKey)) {
          void api.OpenURL(a.getAttribute('href') || '');
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => o.onUpdate(editor),
    onSelectionUpdate: ({ editor }) => o.onSelection(editor),
    onTransaction: ({ editor, transaction }) => {
      if (!transaction.docChanged && transaction.selectionSet) return;
      o.onSelection(editor);
    },
  });
  (editor as any).uploadImages = upload;
  return editor;
}

function withoutEmptyText(n: JSONContent): JSONContent {
  if (!n.content) return n;
  return { ...n, content: n.content.filter((c) => !(c.type === 'text' && !c.text)).map(withoutEmptyText) };
}

/** Sustituye el documento y reinicia el historial de deshacer. */
export function loadContent(editor: Editor, content: JSONContent) {
  const parse = (c: JSONContent) => { const d = editor.schema.nodeFromJSON(c); d.check(); return d; };
  let doc;
  try {
    doc = parse(content);
  } catch {
    // Un texto vacío (de un archivo editado fuera o importado) invalida el
    // documento entero: se quitan antes de dar el documento por vacío
    try { doc = parse(withoutEmptyText(content)); } catch { doc = parse({ type: 'doc', content: [{ type: 'paragraph' }] }); }
  }
  const state = EditorState.create({ doc, plugins: editor.state.plugins });
  editor.view.updateState(state);
}

const DOCX_SAFE = ['image/png', 'image/jpeg', 'image/gif'];

/** Guarda la imagen en el documento. Formatos que Word no admite se pasan a PNG. */
export async function uploadImage(docId: string, file: File): Promise<string> {
  let blob: Blob = file;
  let name = file.name || 'imagen.png';
  if (!DOCX_SAFE.includes(file.type)) {
    blob = await toPNG(file);
    name = name.replace(/\.[^.]+$/, '') + '.png';
  } else if (file.size > 4_000_000 && file.type !== 'image/gif') {
    blob = await toPNG(file, 2400); // reduce fotos enormes del móvil
    name = name.replace(/\.[^.]+$/, '') + '.png';
  }
  const b64 = await blobToBase64(blob);
  return api.SaveImage(docId, name, b64);
}

async function toPNG(file: Blob, maxSide = 4000): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || 800, img.naturalHeight || 600));
    const c = document.createElement('canvas');
    c.width = Math.round((img.naturalWidth || 800) * scale);
    c.height = Math.round((img.naturalHeight || 600) * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo convertir la imagen'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}

/**
 * prosemirror-tables mide el arrastre de columnas en píxeles de pantalla; con
 * un zoom distinto de 100 % la columna se movería más (o menos) que el ratón.
 * Mientras se arrastra, se reenvían los movimientos convertidos a píxeles del
 * documento.
 */
export function scaleColumnDrag(view: EditorView, zoom: () => number) {
  const scaled = new WeakSet<Event>();
  const fix = (e: MouseEvent) => {
    const z = zoom();
    const drag = columnResizingPluginKey.getState(view.state)?.dragging;
    if (z === 1 || !drag || scaled.has(e)) return;
    e.stopImmediatePropagation();
    const ev = new MouseEvent(e.type, { clientX: drag.startX + (e.clientX - drag.startX) / z, clientY: e.clientY, button: e.button, buttons: e.buttons });
    scaled.add(ev);
    window.dispatchEvent(ev);
  };
  window.addEventListener('mousemove', fix, true);
  window.addEventListener('mouseup', fix, true);
}
