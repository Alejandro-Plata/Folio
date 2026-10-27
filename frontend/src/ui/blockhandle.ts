// Asa de bloque: al pasar el ratón por un bloque (párrafo, título, cuadro,
// tabla…) aparecen a su izquierda «+» para insertar debajo y «⋮⋮» para
// arrastrarlo o abrir su menú. Hace visible que el documento está hecho de
// bloques que se pueden mover, convertir y duplicar.
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { App } from '../app';
import { BLOCKS, blockIconHTML } from '../editor/blocks';
import { h, popupMenu, type MenuItem } from './dom';
import { wantsMobileUI } from '../platform/platform';
import { icon } from './icons';

/** Bloques a los que se puede convertir un bloque de texto. */
const CONVERT = ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo', 'quote', 'definition', 'example', 'important'];

export class BlockHandle {
  private el = h('div', { class: 'block-handle', hidden: true });
  private add = h('button', { class: 'bh-btn', title: 'Insertar un bloque debajo', 'aria-label': 'Insertar un bloque debajo', html: icon('plus', 15) });
  private grip = h('button', { class: 'bh-btn bh-grip', title: 'Arrastra para mover · clic para más opciones', 'aria-label': 'Opciones del bloque', draggable: 'true', html: icon('grip', 15) });
  /** Posición del bloque señalado (hijo directo del documento). */
  private pos = -1;
  private menuOpen = false;
  /** Como mucho un cálculo por fotograma. */
  private tracking = false;

  constructor(private app: App, private scroller: HTMLElement) {
    this.el.append(this.add, this.grip);
    scroller.append(this.el);
    const dom = app.editor.view.dom as HTMLElement;
    scroller.addEventListener('mousemove', (e) => this.track(e));
    scroller.addEventListener('mouseleave', () => { if (!this.menuOpen) this.hide(); });
    dom.addEventListener('keydown', () => this.hide());
    scroller.addEventListener('scroll', () => this.hide(), { passive: true });
    for (const b of [this.add, this.grip]) b.addEventListener('mousedown', (e) => { if (b === this.add) e.preventDefault(); });
    this.add.addEventListener('click', () => this.insertBelow());
    this.grip.addEventListener('click', () => this.openMenu());
    this.grip.addEventListener('dragstart', (e) => this.dragStart(e));
    this.grip.addEventListener('dragend', () => this.hide());
    if (wantsMobileUI()) this.longPress(dom);
  }

  /** Móvil: mantener pulsado un bloque abre su menú (convertir, duplicar, mover, eliminar). */
  private longPress(dom: HTMLElement) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let x = 0, y = 0;
    const cancel = () => clearTimeout(timer);
    dom.addEventListener('touchstart', (e) => {
      cancel();
      if (e.touches.length !== 1 || !this.app.doc || !this.view.editable) return;
      x = e.touches[0].clientX; y = e.touches[0].clientY;
      timer = setTimeout(() => {
        const b = this.blockAt({ clientX: x, clientY: y });
        if (!b) return;
        navigator.vibrate?.(12);
        this.pos = b.pos;
        this.openMenu(b.dom);
        // Al soltar el dedo no debe salir un clic que cierre el menú recién abierto
        dom.addEventListener('touchend', (ev) => ev.preventDefault(), { once: true, passive: false });
      }, 450);
    }, { passive: true });
    dom.addEventListener('touchmove', (e) => {
      if (Math.hypot(e.touches[0].clientX - x, e.touches[0].clientY - y) > 8) cancel();
    }, { passive: true });
    for (const ev of ['touchend', 'touchcancel'] as const) dom.addEventListener(ev, cancel, { passive: true });
    // Evita la selección de palabra / menú del sistema cuando la pulsación larga ya abrió el nuestro
    dom.addEventListener('contextmenu', (e) => { if (this.menuOpen) e.preventDefault(); });
  }

  private get view() { return this.app.editor.view; }

  private hide() {
    this.el.hidden = true;
    this.pos = -1;
  }

  /** Bloque de primer nivel bajo el ratón (o a su altura, si el ratón está en el margen). */
  private blockAt(e: { clientX: number; clientY: number }): { node: PMNode; pos: number; dom: HTMLElement } | null {
    const view = this.view;
    if (!this.app.doc || !view.editable) return null;
    const root = view.dom as HTMLElement;
    const r = root.getBoundingClientRect();
    if (e.clientY < r.top || e.clientY > r.bottom) return null;
    // A la altura del ratón pero dentro del texto, para que el margen también cuente
    const probe = document.elementFromPoint(Math.min(Math.max(e.clientX, r.left + 4), r.right - 4), e.clientY);
    if (!probe || !root.contains(probe)) return null;
    // Se sube desde el elemento señalado hasta el hijo directo del editor: no
    // depende del tamaño del documento.
    let dom: Node | null = probe;
    while (dom && dom.parentNode !== root) dom = dom.parentNode;
    if (!(dom instanceof HTMLElement)) return null;
    let pos: number;
    try { pos = view.posAtDOM(dom, 0); } catch { return null; }
    const $pos = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size));
    const start = $pos.depth > 0 ? $pos.before(1) : pos;
    const node = view.state.doc.nodeAt(start);
    if (!node || view.nodeDOM(start) !== dom) return null;
    return { node, pos: start, dom };
  }

  private track(e: MouseEvent) {
    if (this.menuOpen || (e.target as Node) && this.el.contains(e.target as Node)) return;
    if (this.tracking) return;
    this.tracking = true;
    requestAnimationFrame(() => { this.tracking = false; });
    const b = this.blockAt(e);
    if (!b) { this.hide(); return; }
    this.pos = b.pos;
    const sr = this.scroller.getBoundingClientRect();
    const br = b.dom.getBoundingClientRect();
    const line = Math.min(br.height, 28);
    this.el.style.top = `${br.top - sr.top + this.scroller.scrollTop + (line - 26) / 2}px`;
    this.el.style.left = `${br.left - sr.left + this.scroller.scrollLeft - 56}px`;
    this.el.hidden = false;
  }

  private current(): PMNode | null {
    return this.pos >= 0 ? this.view.state.doc.nodeAt(this.pos) : null;
  }

  /** Línea nueva debajo del bloque con el menú de bloques abierto. */
  private insertBelow() {
    const node = this.current();
    if (!node) return;
    const at = this.pos + node.nodeSize;
    const ed = this.app.editor;
    const empty = node.type.name === 'paragraph' && node.content.size === 0;
    if (empty) ed.chain().focus().setTextSelection(this.pos + 1).insertContent('/').run();
    else ed.chain().focus().insertContentAt(at, { type: 'paragraph' }).setTextSelection(at + 1).insertContent('/').run();
    this.hide();
  }

  private select() {
    const view = this.view;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, this.pos)));
  }

  private dragStart(e: DragEvent) {
    const node = this.current();
    if (!node || !e.dataTransfer) return;
    const view = this.view;
    this.select();
    const slice = view.state.selection.content();
    const { dom, text } = (view as any).serializeForClipboard(slice);
    e.dataTransfer.clearData();
    e.dataTransfer.setData('text/html', dom.innerHTML);
    e.dataTransfer.setData('text/plain', text);
    e.dataTransfer.effectAllowed = 'copyMove';
    const ghost = view.nodeDOM(this.pos);
    if (ghost instanceof HTMLElement) e.dataTransfer.setDragImage(ghost, 0, 0);
    // ProseMirror se encarga del resto al soltar (mueve el bloque)
    (view as any).dragging = { slice, move: true };
  }

  private openMenu(anchor: HTMLElement = this.grip) {
    const node = this.current();
    if (!node) return;
    const pos = this.pos;
    const ed = this.app.editor;
    const isText = node.isTextblock || ['bulletList', 'orderedList', 'taskList', 'blockquote', 'callout'].includes(node.type.name);
    const focusIn = () => {
      const view = this.view;
      const inside = Math.min(pos + 1, view.state.doc.content.size);
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(inside))));
      ed.commands.focus();
    };
    const items: MenuItem[] = [];
    if (isText) {
      for (const id of CONVERT) {
        const b = BLOCKS.find((x) => x.id === id);
        if (b) items.push({ label: `Convertir en ${b.title.toLowerCase()}`, iconHTML: blockIconHTML(b, 16), run: () => { focusIn(); b.run(ed); } });
      }
      items.push({ separator: true });
    }
    items.push(
      { label: 'Duplicar', icon: 'copy', run: () => ed.chain().insertContentAt(pos + node.nodeSize, node.toJSON()).run() },
      { label: 'Mover arriba', icon: 'chevronUp', hint: 'Alt+Mayús+↑', run: () => this.move(pos, -1) },
      { label: 'Mover abajo', icon: 'chevronDown', hint: 'Alt+Mayús+↓', run: () => this.move(pos, 1) },
      { separator: true },
      { label: 'Eliminar', icon: 'trash', danger: true, run: () => ed.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run() },
    );
    this.menuOpen = true;
    this.grip.classList.add('on');
    popupMenu(anchor, items, { onClose: () => { this.menuOpen = false; this.grip.classList.remove('on'); this.hide(); } });
  }

  /** Intercambia el bloque con su vecino. */
  private move(pos: number, dir: -1 | 1) {
    const view = this.view;
    const doc = view.state.doc;
    const node = doc.nodeAt(pos);
    if (!node) return;
    const $pos = doc.resolve(pos);
    const idx = $pos.index(0);
    const target = idx + dir;
    if (target < 0 || target >= doc.childCount) return;
    const sibling = doc.child(target);
    const tr = view.state.tr.delete(pos, pos + node.nodeSize);
    const at = dir < 0 ? pos - sibling.nodeSize : pos + sibling.nodeSize;
    tr.insert(at, node);
    tr.setSelection(NodeSelection.create(tr.doc, at)).scrollIntoView();
    view.dispatch(tr);
    view.focus();
  }
}
