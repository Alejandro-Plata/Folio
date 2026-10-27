import { Extension, Mark, Node, mergeAttributes, InputRule } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import Image from '@tiptap/extension-image';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { emit } from '../bus';
import { renderMath } from './math';
import { icon as svgIcon } from '../ui/icons';
import { headingSlug } from './anchors';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: { setFontSize: (size: string) => ReturnType; unsetFontSize: () => ReturnType };
    blockFormat: {
      setLineHeight: (v: number | null) => ReturnType;
      indent: () => ReturnType;
      outdent: () => ReturnType;
      resetParagraph: () => ReturnType;
    };
    pageBreak: { setPageBreak: () => ReturnType };
    callout: { setCallout: (kind?: string) => ReturnType; setCalloutKind: (kind: string) => ReturnType };
    toggle: { setToggle: (attrs?: { title?: string; solution?: boolean }) => ReturnType };
    answerLines: { insertAnswerLines: (lines?: number) => ReturnType };
    math: { insertMathInline: (latex?: string) => ReturnType; insertMathBlock: (latex?: string) => ReturnType };
    footnote: { insertFootnote: (text: string) => ReturnType };
    toc: { insertToc: () => ReturnType };
    comment: { setComment: (attrs: { id: string; text: string; author: string }) => ReturnType; removeComment: (id: string) => ReturnType };
  }
}

type GetPos = () => number;

// ---------- Tamaño de fuente (en puntos, como Word) ----------
export const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (el) => el.style.fontSize || null,
          renderHTML: (a) => (a.fontSize ? { style: `font-size:${a.fontSize}` } : {}),
        },
      },
    }];
  },
  addCommands() {
    return {
      setFontSize: (size) => ({ chain }) => chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }) => chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

// ---------- Interlineado y sangría de párrafo ----------
const BLOCK_TYPES = ['paragraph', 'heading'];

function updateBlocks(tr: any, from: number, to: number, fn: (attrs: any) => any) {
  tr.doc.nodesBetween(from, to, (node: PMNode, pos: number) => {
    if (BLOCK_TYPES.includes(node.type.name)) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...fn(node.attrs) });
      return false;
    }
    return true;
  });
  return true;
}

export const BlockFormat = Extension.create({
  name: 'blockFormat',
  addGlobalAttributes() {
    return [{
      types: BLOCK_TYPES,
      attributes: {
        lineHeight: {
          default: null,
          parseHTML: (el) => {
            const v = parseFloat(el.style.lineHeight);
            return Number.isFinite(v) && v > 0 && v < 5 ? v : null;
          },
          renderHTML: (a) => (a.lineHeight ? { style: `line-height:${a.lineHeight}` } : {}),
        },
        indent: {
          default: 0,
          parseHTML: (el) => parseInt(el.getAttribute('data-indent') || '0', 10) || 0,
          renderHTML: (a) => (a.indent ? { 'data-indent': a.indent, style: `margin-left:${a.indent * 2.5}em` } : {}),
        },
      },
    }];
  },
  addCommands() {
    return {
      setLineHeight: (v) => ({ tr, state }) =>
        updateBlocks(tr, state.selection.from, state.selection.to, () => ({ lineHeight: v })),
      indent: () => ({ tr, state, editor }) => {
        if (editor.isActive('listItem') || editor.isActive('taskItem')) {
          return editor.commands.sinkListItem(editor.isActive('taskItem') ? 'taskItem' : 'listItem');
        }
        return updateBlocks(tr, state.selection.from, state.selection.to, (a) => ({ indent: Math.min(8, (a.indent || 0) + 1) }));
      },
      outdent: () => ({ tr, state, editor }) => {
        if (editor.isActive('listItem') || editor.isActive('taskItem')) {
          return editor.commands.liftListItem(editor.isActive('taskItem') ? 'taskItem' : 'listItem');
        }
        return updateBlocks(tr, state.selection.from, state.selection.to, (a) => ({ indent: Math.max(0, (a.indent || 0) - 1) }));
      },
      resetParagraph: () => ({ tr, state }) =>
        updateBlocks(tr, state.selection.from, state.selection.to, () => ({ lineHeight: null, indent: 0, textAlign: 'left' })),
    };
  },
});

// ---------- Salto de página ----------
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }, { tag: 'hr.page-break' }];
  },
  renderHTML() {
    return ['div', { 'data-page-break': '', class: 'page-break' }];
  },
  addCommands() {
    return {
      setPageBreak: () => ({ chain }) =>
        chain().insertContent([{ type: this.name }, { type: 'paragraph' }]).run(),
    };
  },
});

// ---------- Cuadros destacados (definición, ejemplo, importante…) ----------
export const CALLOUT_KINDS: Record<string, { icon: string; label: string }> = {
  info: { icon: 'info', label: 'Información' },
  tip: { icon: 'lightbulb', label: 'Consejo' },
  warning: { icon: 'alert', label: 'Atención' },
  important: { icon: 'alertCircle', label: 'Importante' },
  definition: { icon: 'bookOpen', label: 'Definición' },
  example: { icon: 'flask', label: 'Ejemplo' },
  exercise: { icon: 'pencil', label: 'Ejercicio' },
};

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      kind: {
        default: 'info',
        parseHTML: (el) => el.getAttribute('data-callout') || 'info',
        renderHTML: (a) => ({ 'data-callout': a.kind, 'data-label': CALLOUT_KINDS[a.kind]?.label ?? '' }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'callout' }), 0];
  },
  addCommands() {
    return {
      setCallout: (kind = 'info') => ({ commands }) => commands.wrapIn(this.name, { kind }),
      setCalloutKind: (kind) => ({ commands }) => commands.updateAttributes(this.name, { kind }),
    };
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'callout';
      const icon = document.createElement('button');
      icon.className = 'callout-icon';
      icon.contentEditable = 'false';
      icon.title = 'Cambiar tipo de cuadro';
      const label = document.createElement('div');
      label.className = 'callout-label';
      label.contentEditable = 'false';
      const content = document.createElement('div');
      content.className = 'callout-content';
      dom.append(icon, label, content);
      let current = node;
      const sync = () => {
        const k = CALLOUT_KINDS[current.attrs.kind] ?? CALLOUT_KINDS.info;
        dom.dataset.callout = current.attrs.kind;
        icon.innerHTML = svgIcon(k.icon, 18);
        label.textContent = k.label;
      };
      sync();
      icon.addEventListener('mousedown', (e) => {
        e.preventDefault();
        emit('callout:menu', {
          anchor: icon,
          set: (kind: string) => {
            if (typeof getPos !== 'function') return;
            const pos = (getPos as GetPos)();
            editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, kind }));
          },
        });
      });
      return {
        dom,
        contentDOM: content,
        update(n) {
          if (n.type !== current.type) return false;
          current = n;
          sync();
          return true;
        },
        stopEvent: (e) => e.target === icon,
        ignoreMutation: (m) => !content.contains(m.target),
      };
    };
  },
});

// ---------- Bloque plegable / solución (se puede ocultar al exportar para el alumnado) ----------
export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      title: { default: '', parseHTML: (el) => el.getAttribute('data-title') || '', renderHTML: (a) => ({ 'data-title': a.title }) },
      open: { default: true, parseHTML: (el) => el.getAttribute('data-open') !== 'false', renderHTML: (a) => ({ 'data-open': String(a.open) }) },
      solution: { default: false, parseHTML: (el) => el.getAttribute('data-solution') === 'true', renderHTML: (a) => ({ 'data-solution': String(a.solution) }) },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-toggle]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toggle': '', class: 'toggle' }), 0];
  },
  addCommands() {
    return {
      setToggle: (attrs = {}) => ({ commands }) => commands.wrapIn(this.name, { open: true, ...attrs }),
    };
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'toggle';
      const head = document.createElement('div');
      head.className = 'toggle-head';
      head.contentEditable = 'false';
      const chevron = document.createElement('button');
      chevron.className = 'toggle-chevron';
      chevron.title = 'Plegar / desplegar';
      chevron.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const input = document.createElement('input');
      input.className = 'toggle-title';
      input.placeholder = 'Título del bloque plegable';
      const badge = document.createElement('button');
      badge.className = 'toggle-badge';
      badge.title = 'Marcar como solución (se oculta en la versión del alumnado)';
      head.append(chevron, input, badge);
      const content = document.createElement('div');
      content.className = 'toggle-content';
      dom.append(head, content);

      const setAttrs = (patch: Record<string, unknown>) => {
        if (typeof getPos !== 'function') return;
        const pos = (getPos as GetPos)();
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...patch }));
      };
      const sync = () => {
        dom.classList.toggle('is-open', current.attrs.open);
        dom.classList.toggle('is-solution', current.attrs.solution);
        if (document.activeElement !== input) input.value = current.attrs.title;
        badge.textContent = current.attrs.solution ? 'Solución' : 'Marcar solución';
        input.placeholder = current.attrs.solution ? 'Solución' : 'Título del bloque plegable';
      };
      sync();
      chevron.addEventListener('mousedown', (e) => { e.preventDefault(); setAttrs({ open: !current.attrs.open }); });
      badge.addEventListener('mousedown', (e) => { e.preventDefault(); setAttrs({ solution: !current.attrs.solution }); });
      input.addEventListener('change', () => setAttrs({ title: input.value }));
      input.addEventListener('blur', () => { if (input.value !== current.attrs.title) setAttrs({ title: input.value }); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault();
          setAttrs({ title: input.value, open: true });
          if (typeof getPos === 'function') {
            const pos = (getPos as GetPos)() + 2;
            editor.chain().focus().setTextSelection(pos).run();
          }
        }
        e.stopPropagation();
      });
      return {
        dom,
        contentDOM: content,
        update(n) {
          if (n.type !== current.type) return false;
          current = n;
          sync();
          return true;
        },
        stopEvent: (e) => head.contains(e.target as HTMLElement),
        ignoreMutation: (m) => head.contains(m.target as HTMLElement) || m.type === 'attributes' && m.target === dom,
      };
    };
  },
});

// ---------- Líneas para responder (exámenes y fichas) ----------
export const AnswerLines = Node.create({
  name: 'answerLines',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      lines: {
        default: 4,
        parseHTML: (el) => parseInt(el.getAttribute('data-lines') || '4', 10),
        renderHTML: (a) => ({ 'data-lines': a.lines, style: `--lines:${a.lines}` }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-answer-lines]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-answer-lines': '', class: 'answer-lines' })];
  },
  addCommands() {
    return {
      insertAnswerLines: (lines = 4) => ({ chain }) =>
        chain().insertContent([{ type: this.name, attrs: { lines } }, { type: 'paragraph' }]).run(),
    };
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'answer-lines';
      dom.contentEditable = 'false';
      const ctrl = document.createElement('div');
      ctrl.className = 'answer-ctrl';
      const minus = document.createElement('button');
      minus.textContent = '−';
      minus.title = 'Quitar línea';
      const count = document.createElement('span');
      const plus = document.createElement('button');
      plus.textContent = '+';
      plus.title = 'Añadir línea';
      ctrl.append(minus, count, plus);
      dom.append(ctrl);
      const sync = () => {
        dom.style.setProperty('--lines', String(current.attrs.lines));
        count.textContent = `${current.attrs.lines} líneas`;
      };
      sync();
      const change = (d: number) => (e: Event) => {
        e.preventDefault();
        if (typeof getPos !== 'function') return;
        const lines = Math.max(1, Math.min(40, current.attrs.lines + d));
        editor.view.dispatch(editor.state.tr.setNodeMarkup((getPos as GetPos)(), undefined, { lines }));
      };
      minus.addEventListener('mousedown', change(-1));
      plus.addEventListener('mousedown', change(1));
      return {
        dom,
        update(n) {
          if (n.type !== current.type) return false;
          current = n;
          sync();
          return true;
        },
        stopEvent: (e) => ctrl.contains(e.target as HTMLElement),
        ignoreMutation: () => true,
      };
    };
  },
});

// ---------- Ecuaciones (LaTeX con KaTeX) ----------
function mathView(display: boolean) {
  return ({ node, getPos, editor }: { node: PMNode; getPos: any; editor: Editor }) => {
    let current = node;
    const dom = document.createElement(display ? 'div' : 'span');
    dom.className = display ? 'math-block' : 'math-inline';
    dom.contentEditable = 'false';
    const draw = () => renderMath(dom, current.attrs.latex, display);
    draw();
    const edit = () => emit('math:edit', {
      latex: current.attrs.latex,
      display,
      anchor: dom,
      save: (latex: string) => {
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        if (latex.trim() === '' ) {
          editor.chain().focus().deleteRange({ from: pos, to: pos + current.nodeSize }).run();
          return;
        }
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { latex }));
        editor.commands.focus();
      },
    });
    dom.addEventListener('dblclick', edit);
    dom.addEventListener('click', (e) => { if ((e as MouseEvent).detail === 1) edit(); });
    return {
      dom,
      update(n: PMNode) {
        if (n.type !== current.type) return false;
        const changed = n.attrs.latex !== current.attrs.latex;
        current = n;
        if (changed) draw();
        return true;
      },
      selectNode: () => dom.classList.add('is-selected'),
      deselectNode: () => dom.classList.remove('is-selected'),
      ignoreMutation: () => true,
    };
  };
}

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { latex: { default: '', parseHTML: (el) => el.getAttribute('data-latex') || el.textContent || '' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-math-inline]' }];
  },
  renderHTML({ node }) {
    return ['span', { 'data-math-inline': '', 'data-latex': node.attrs.latex, class: 'math-inline' }, node.attrs.latex];
  },
  renderText({ node }) {
    return `$${node.attrs.latex}$`;
  },
  addCommands() {
    return {
      insertMathInline: (latex = '') => ({ chain }) => chain().insertContent({ type: this.name, attrs: { latex } }).run(),
    };
  },
  addInputRules() {
    // $x^2$ → ecuación en línea
    return [new InputRule({
      find: /(?:^|\s)\$([^$\s][^$]*?)\$$/,
      handler: ({ state, range, match }) => {
        const start = range.from + (match[0].startsWith('$') ? 0 : 1);
        state.tr.replaceWith(start, range.to, this.type.create({ latex: match[1] }));
      },
    })];
  },
  addNodeView() {
    return mathView(false) as any;
  },
});

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { latex: { default: '', parseHTML: (el) => el.getAttribute('data-latex') || el.textContent || '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-math-block]' }];
  },
  renderHTML({ node }) {
    return ['div', { 'data-math-block': '', 'data-latex': node.attrs.latex, class: 'math-block' }, node.attrs.latex];
  },
  renderText({ node }) {
    return `$$${node.attrs.latex}$$`;
  },
  addCommands() {
    return {
      insertMathBlock: (latex = '') => ({ chain }) =>
        chain().insertContent([{ type: this.name, attrs: { latex } }, { type: 'paragraph' }]).run(),
    };
  },
  addInputRules() {
    return [new InputRule({
      find: /^\$\$\s$/,
      handler: ({ state, range }) => {
        const $start = state.doc.resolve(range.from);
        const blockStart = $start.before();
        state.tr.replaceWith(blockStart, $start.after(), this.type.create({ latex: '' }));
        setTimeout(() => emit('math:edit-last-block'), 0);
      },
    })];
  },
  addNodeView() {
    return mathView(true) as any;
  },
});

// ---------- Notas al pie ----------
export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { text: { default: '', parseHTML: (el) => el.getAttribute('data-text') || el.getAttribute('title') || '' } };
  },
  parseHTML() {
    return [{ tag: 'sup[data-footnote]' }];
  },
  renderHTML({ node }) {
    return ['sup', { 'data-footnote': '', 'data-text': node.attrs.text, title: node.attrs.text, class: 'footnote-ref' }];
  },
  renderText() {
    return '';
  },
  addCommands() {
    return {
      insertFootnote: (text) => ({ chain }) => chain().insertContent({ type: this.name, attrs: { text } }).run(),
    };
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement('sup');
      dom.className = 'footnote-ref';
      dom.contentEditable = 'false';
      dom.title = current.attrs.text;
      dom.addEventListener('click', () => emit('footnote:edit', {
        text: current.attrs.text,
        anchor: dom,
        save: (text: string) => {
          if (typeof getPos !== 'function') return;
          const pos = (getPos as GetPos)();
          if (!text.trim()) editor.chain().focus().deleteRange({ from: pos, to: pos + 1 }).run();
          else editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { text }));
        },
      }));
      return {
        dom,
        update(n) {
          if (n.type !== current.type) return false;
          current = n;
          dom.title = n.attrs.text;
          return true;
        },
        ignoreMutation: () => true,
      };
    };
  },
});

// ---------- Índice automático ----------
export interface HeadingInfo { level: number; text: string; pos: number }

/** Posición del título al que apunta un enlace «#ancla» (o null). */
export function findAnchor(doc: PMNode, href: string): number | null {
  const want = decodeURIComponent(href.replace(/^#/, ''));
  return collectHeadings(doc).find((h) => headingSlug(h.text) === want)?.pos ?? null;
}

export function collectHeadings(doc: PMNode): HeadingInfo[] {
  const out: HeadingInfo[] = [];
  doc.descendants((n, pos) => {
    if (n.type.name === 'heading') {
      const text = n.textContent.trim();
      if (text) out.push({ level: n.attrs.level, text, pos });
      return false;
    }
    return true;
  });
  return out;
}

export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-toc]' }];
  },
  renderHTML() {
    return ['div', { 'data-toc': '', class: 'toc' }];
  },
  addCommands() {
    return {
      insertToc: () => ({ chain }) => chain().insertContent([{ type: this.name }, { type: 'paragraph' }]).run(),
    };
  },
  addNodeView() {
    return ({ editor }) => {
      const dom = document.createElement('div');
      dom.className = 'toc';
      dom.contentEditable = 'false';
      let last = '';
      const draw = () => {
        const hs = collectHeadings(editor.state.doc).filter((h) => h.level <= 3);
        const sig = hs.map((h) => h.level + h.text).join('|');
        if (sig === last) return;
        last = sig;
        dom.innerHTML = '';
        const title = document.createElement('div');
        title.className = 'toc-title';
        title.textContent = 'Índice';
        dom.append(title);
        if (!hs.length) {
          const empty = document.createElement('div');
          empty.className = 'toc-empty';
          empty.textContent = 'Añade títulos (Ctrl+Alt+1, 2, 3) y aparecerán aquí.';
          dom.append(empty);
        }
        hs.forEach((h, i) => {
          const a = document.createElement('a');
          a.className = `toc-item toc-l${h.level}`;
          a.textContent = h.text;
          a.addEventListener('click', () => {
            const cur = collectHeadings(editor.state.doc).filter((x) => x.level <= 3)[i];
            if (cur) emit('editor:scroll-to', cur.pos);
          });
          dom.append(a);
        });
      };
      draw();
      editor.on('update', draw);
      return {
        dom,
        ignoreMutation: () => true,
        destroy: () => editor.off('update', draw),
      };
    };
  },
});

// ---------- Comentarios de revisión ----------
export const Comment = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes() {
    return {
      id: { default: '', parseHTML: (el) => el.getAttribute('data-comment-id'), renderHTML: (a) => ({ 'data-comment-id': a.id }) },
      text: { default: '', parseHTML: (el) => el.getAttribute('data-comment') || '', renderHTML: (a) => ({ 'data-comment': a.text }) },
      author: { default: '', parseHTML: (el) => el.getAttribute('data-author') || '', renderHTML: (a) => ({ 'data-author': a.author }) },
      created: { default: '', parseHTML: (el) => el.getAttribute('data-created') || '', renderHTML: (a) => ({ 'data-created': a.created }) },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'comment-mark' }), 0];
  },
  addCommands() {
    return {
      setComment: (attrs) => ({ commands }) =>
        commands.setMark(this.name, { ...attrs, created: new Date().toISOString() }),
      removeComment: (id) => ({ tr, state, dispatch }) => {
        const type = state.schema.marks.comment;
        state.doc.descendants((n, pos) => {
          n.marks.forEach((m) => {
            if (m.type === type && m.attrs.id === id) tr.removeMark(pos, pos + n.nodeSize, m);
          });
        });
        if (dispatch) dispatch(tr);
        return true;
      },
    };
  },
});

// ---------- Imagen con tamaño y alineación ----------
export const FolioImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const w = parseInt(el.getAttribute('width') || el.style.width || '', 10);
          return Number.isFinite(w) ? w : null;
        },
        renderHTML: (a) => (a.width ? { width: a.width } : {}),
      },
      align: {
        default: 'center',
        parseHTML: (el) => el.getAttribute('data-align') || 'center',
        renderHTML: (a) => ({ 'data-align': a.align }),
      },
    };
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'image-block';
      const frame = document.createElement('div');
      frame.className = 'image-frame';
      const img = document.createElement('img');
      img.draggable = false;
      const handle = document.createElement('span');
      handle.className = 'image-handle';
      handle.title = 'Arrastra para cambiar el tamaño';
      frame.append(img, handle);
      dom.append(frame);
      img.addEventListener('load', () => emit('layout:changed'));
      const sync = () => {
        img.src = current.attrs.src;
        img.alt = current.attrs.alt || '';
        frame.style.width = current.attrs.width ? `${current.attrs.width}px` : '';
        dom.dataset.align = current.attrs.align || 'center';
      };
      sync();
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = img.getBoundingClientRect().width;
        const zoom = startW / (img.offsetWidth || startW) || 1;
        const maxW = (dom.parentElement?.clientWidth ?? 2000);
        let w = startW / zoom;
        const move = (ev: PointerEvent) => {
          w = Math.max(40, Math.min(maxW, (startW + (ev.clientX - startX) * (current.attrs.align === 'center' ? 2 : 1)) / zoom));
          frame.style.width = `${Math.round(w)}px`;
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          if (typeof getPos === 'function') {
            editor.view.dispatch(editor.state.tr.setNodeMarkup((getPos as GetPos)(), undefined, { ...current.attrs, width: Math.round(w) }));
          }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
      return {
        dom,
        update(n) {
          if (n.type !== current.type) return false;
          current = n;
          sync();
          return true;
        },
        selectNode: () => dom.classList.add('is-selected'),
        deselectNode: () => dom.classList.remove('is-selected'),
        stopEvent: (e) => e.target === handle,
        ignoreMutation: () => true,
      };
    };
  },
});

// ---------- Celdas de tabla con color de fondo ----------
const backgroundAttr = {
  background: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-background') || el.style.backgroundColor || null,
    renderHTML: (a: Record<string, any>) => (a.background ? { 'data-background': a.background, style: `background-color:${a.background}` } : {}),
  },
};
export const FolioTableCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...backgroundAttr }; } });
export const FolioTableHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...backgroundAttr }; } });

// ---------- Utilidades de edición estilo Word ----------

/** Mueve el bloque actual (párrafo, elemento de lista…) arriba o abajo (Alt+Mayús+↑/↓). */
export function moveBlock(editor: Editor, dir: -1 | 1): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  let depth = $from.depth;
  while (depth > 0 && !$from.node(depth).isTextblock) depth--;
  if (depth === 0) return false;
  if (depth > 1 && ['listItem', 'taskItem'].includes($from.node(depth - 1).type.name)) depth--;
  // sube hasta un nivel donde haya un hermano al que moverse
  while (depth > 1) {
    const parent = $from.node(depth - 1);
    const idx = $from.index(depth - 1);
    if ((dir < 0 && idx > 0) || (dir > 0 && idx < parent.childCount - 1)) break;
    depth--;
  }
  const parent = $from.node(depth - 1);
  const idx = $from.index(depth - 1);
  const target = idx + dir;
  if (target < 0 || target >= parent.childCount) return false;
  const node = $from.node(depth);
  const start = $from.before(depth);
  const end = $from.after(depth);
  const offset = state.selection.from - start;
  const sibling = parent.child(target);
  const tr = state.tr.delete(start, end);
  const insertAt = dir < 0 ? start - sibling.nodeSize : start + sibling.nodeSize;
  tr.insert(insertAt, node);
  tr.setSelection(TextSelection.create(tr.doc, insertAt + offset));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Mayús+F3: alterna minúsculas → MAYÚSCULAS → Tipo Título. */
export function changeCase(editor: Editor, forced?: 'upper' | 'lower' | 'title'): boolean {
  const { state } = editor;
  let { from, to } = state.selection;
  if (from === to) {
    // sin selección: la palabra bajo el cursor
    const $p = state.selection.$from;
    const text = $p.parent.textContent;
    const off = $p.parentOffset;
    let s = off, e = off;
    while (s > 0 && /[\p{L}\p{N}]/u.test(text[s - 1])) s--;
    while (e < text.length && /[\p{L}\p{N}]/u.test(text[e])) e++;
    if (s === e) return false;
    from = $p.start() + s;
    to = $p.start() + e;
  }
  const sel = state.doc.textBetween(from, to, '\n');
  const mode = forced ?? (sel === sel.toLowerCase() ? 'upper' : sel === sel.toUpperCase() ? 'title' : 'lower');
  const conv = (s: string, atWordStart: boolean) => {
    if (mode === 'upper') return s.toLocaleUpperCase('es');
    if (mode === 'lower') return s.toLocaleLowerCase('es');
    let out = '';
    let start = atWordStart;
    for (const ch of s) {
      out += start ? ch.toLocaleUpperCase('es') : ch.toLocaleLowerCase('es');
      start = !/[\p{L}\p{N}]/u.test(ch);
    }
    return out;
  };
  const tr = state.tr;
  const parts: { pos: number; end: number; text: string; marks: any }[] = [];
  state.doc.nodesBetween(from, to, (n, pos) => {
    if (!n.isText) return true;
    const s = Math.max(from, pos), e = Math.min(to, pos + n.nodeSize);
    const before = s > 0 ? state.doc.textBetween(s - 1, s, '\n', ' ') : ' ';
    parts.push({ pos: s, end: e, text: conv(n.text!.slice(s - pos, e - pos), !/[\p{L}\p{N}]/u.test(before)), marks: n.marks });
    return false;
  });
  for (const p of parts.reverse()) tr.replaceWith(p.pos, p.end, state.schema.text(p.text, p.marks));
  tr.setSelection(TextSelection.create(tr.doc, from, tr.mapping.map(to)));
  editor.view.dispatch(tr);
  return true;
}

// ---------- Marcas de salto para exportar ----------
// Nunca existen en el editor: se insertan en una copia del documento al
// exportar, en las posiciones exactas donde el editor ha cortado las páginas.
export const PrintBreak = Node.create({
  name: 'printBreak',
  group: 'block',
  atom: true,
  renderHTML: () => ['div', { class: 'pb-print' }],
});
export const PrintBreakRow = Node.create({
  name: 'printBreakRow',
  atom: true,
  addAttributes: () => ({ cols: { default: 1 } }),
  renderHTML: ({ node }) => ['tr', { class: 'pb-print-row' }, ['td', { colspan: String(node.attrs.cols) }]],
});
export const PrintBreakInline = Node.create({
  name: 'printBreakInline',
  group: 'inline',
  inline: true,
  atom: true,
  renderHTML: () => ['span', { class: 'pb-print-inline' }],
});
