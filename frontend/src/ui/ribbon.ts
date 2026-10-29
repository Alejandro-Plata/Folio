// Cinta de opciones con pestañas (Inicio, Insertar, Disposición, Referencias,
// Revisar, Vista y pestañas contextuales de tabla e imagen). Toma la
// organización de Word pero con menos ruido visual: grupos con nombre,
// botones grandes solo donde aportan y el resto en filas compactas.
import type { App } from '../app';
import { FONT_SIZES } from '../app';
import { h, popupMenu, popover, type MenuItem } from './dom';
import { icon } from './icons';
import { findFont } from '../fonts';
import { FontPicker } from './fontpicker';
import { BLOCKS, blockIconHTML } from '../editor/blocks';
import { CALLOUT_KINDS, changeCase } from '../editor/extensions';
import { shortcutLabel } from '../shortcuts';
import * as dialogs from './dialogs';
import { openBackstage } from './backstage';
import { emit } from '../bus';

const TEXT_COLORS = [
  ['#000000', '#404040', '#7f7f7f', '#bfbfbf', '#ffffff'],
  ['#c0392b', '#e67e22', '#d4ac0d', '#27ae60', '#16a085'],
  ['#2471a3', '#1f3a93', '#7d3c98', '#c2185b', '#6d4c41'],
  ['#f1948a', '#f5cba7', '#f9e79f', '#a9dfbf', '#a3e4d7'],
  ['#aed6f1', '#a9cce3', '#d2b4de', '#f8bbd0', '#d7ccc8'],
];
const HIGHLIGHTS = ['#fff3a3', '#c8f7c5', '#c5eff7', '#ffd6e7', '#dcd3ff', '#ffe0b2', '#e5e5e5'];
const CELL_COLORS = ['#f2f2f2', '#fff3a3', '#e3f2fd', '#e8f5e9', '#fce4ec', '#ede7f6', '#fff8e1'];

const STYLES: { label: string; value: string; cls: string }[] = [
  { label: 'Normal', value: 'p', cls: 'st-normal' }, { label: 'Título 1', value: 'h1', cls: 'st-h1' },
  { label: 'Título 2', value: 'h2', cls: 'st-h2' }, { label: 'Título 3', value: 'h3', cls: 'st-h3' },
  { label: 'Cita', value: 'quote', cls: 'st-quote' }, { label: 'Código', value: 'code', cls: 'st-code' },
];

type TabId = 'home' | 'insert' | 'layout' | 'refs' | 'review' | 'view' | 'table' | 'image';
const TABS: { id: TabId; label: string; contextual?: boolean }[] = [
  { id: 'home', label: 'Inicio' }, { id: 'insert', label: 'Insertar' }, { id: 'layout', label: 'Disposición' },
  { id: 'refs', label: 'Referencias' }, { id: 'review', label: 'Revisar' }, { id: 'view', label: 'Vista' },
  { id: 'table', label: 'Tabla', contextual: true }, { id: 'image', label: 'Imagen', contextual: true },
];

export class Ribbon {
  private el = document.getElementById('ribbon')!;
  private tabsEl = h('div', { class: 'rb-tabs', role: 'tablist' });
  private body = h('div', { class: 'rb-body' });
  private scrollPrev = h('button', { class: 'rb-scroll rb-scroll-prev', title: 'Ver más opciones', 'aria-label': 'Desplazar la cinta a la izquierda', html: icon('chevronLeft', 14), hidden: true });
  private scrollNext = h('button', { class: 'rb-scroll rb-scroll-next', title: 'Ver más opciones', 'aria-label': 'Desplazar la cinta a la derecha', html: icon('chevronRight', 14), hidden: true });
  private tabButtons = new Map<TabId, HTMLButtonElement>();
  private buttons = new Map<string, HTMLButtonElement>();
  private styleTiles = new Map<string, HTMLButtonElement>();
  private fontSel: FontPicker | null = null;
  private sizeInput: HTMLInputElement | null = null;
  private colorBar: HTMLElement | null = null;
  private tab: TabId = 'home';
  private lastColor = '#c0392b';
  private lastHighlight = '#fff3a3';

  constructor(private app: App) {
    this.buildTabs();
    this.el.append(this.tabsEl, h('div', { class: 'rb-frame' }, this.body, this.scrollPrev, this.scrollNext));
    this.bindFit();
    this.renderTab();
  }

  // ---------- Ajuste al ancho ----------

  /**
   * Si los grupos no caben, la cinta se compacta por niveles (menos márgenes,
   * botones pequeños solo con icono, galería de estilos más corta) en lugar de
   * mostrar una barra de desplazamiento que taparía los rótulos de los grupos.
   * Si ni así cabe, aparecen flechas para desplazarla.
   */
  private static readonly FIT_LEVELS = 3;
  private fitWidth = 0;

  private bindFit() {
    const step = (dir: number) => this.body.scrollBy({ left: dir * this.body.clientWidth * 0.6, behavior: 'smooth' });
    for (const [b, dir] of [[this.scrollPrev, -1], [this.scrollNext, 1]] as const) {
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => step(dir));
    }
    this.body.addEventListener('scroll', () => this.updateArrows(), { passive: true });
    // La rueda vertical desplaza en horizontal cuando la cinta no cabe
    this.body.addEventListener('wheel', (e) => {
      if (this.body.scrollWidth <= this.body.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      this.body.scrollLeft += e.deltaY;
    }, { passive: false });
    new ResizeObserver(() => {
      if (this.body.clientWidth !== this.fitWidth) this.fit();
    }).observe(this.body);
  }

  private fit() {
    this.fitWidth = this.body.clientWidth;
    const overflows = () => this.body.scrollWidth > this.body.clientWidth + 1;
    let level = 0;
    this.el.dataset.fit = '0';
    while (level < Ribbon.FIT_LEVELS && overflows()) this.el.dataset.fit = String(++level);
    this.updateArrows();
  }

  private updateArrows() {
    const b = this.body;
    const over = b.scrollWidth > b.clientWidth + 1;
    this.scrollPrev.hidden = !over || b.scrollLeft <= 1;
    this.scrollNext.hidden = !over || b.scrollLeft + b.clientWidth >= b.scrollWidth - 1;
  }

  // ---------- Pestañas ----------

  private buildTabs() {
    const file = h('button', { class: 'rb-tab rb-file', onclick: () => openBackstage(this.app, 'info') }, 'Archivo');
    this.tabsEl.append(file);
    for (const t of TABS) {
      const b = h('button', {
        class: `rb-tab ${t.contextual ? 'rb-tab-ctx' : ''}`, role: 'tab',
        onmousedown: (e: MouseEvent) => e.preventDefault(),
        onclick: () => this.select(t.id),
        ondblclick: () => this.app.run('ribbon'),
      }, t.label);
      this.tabButtons.set(t.id, b);
      this.tabsEl.append(b);
    }
    this.tabsEl.append(h('div', { class: 'spacer' }),
      h('button', {
        class: 'rb-collapse', title: 'Mostrar u ocultar la cinta (Ctrl+F1)', html: icon('chevronUp', 14),
        onmousedown: (e: MouseEvent) => e.preventDefault(), onclick: () => this.app.run('ribbon'),
      }));
  }

  select(id: TabId) {
    if (!this.app.settings.ribbon) this.app.setSetting('ribbon', true);
    this.tab = id;
    this.renderTab();
  }

  private renderTab() {
    this.tabButtons.forEach((b, id) => b.classList.toggle('on', id === this.tab));
    this.buttons.clear();
    this.styleTiles.clear();
    this.fontSel = null;
    this.sizeInput = null;
    this.colorBar = null;
    this.body.innerHTML = '';
    const build: Record<TabId, () => HTMLElement[]> = {
      home: () => this.homeTab(), insert: () => this.insertTab(), layout: () => this.layoutTab(), refs: () => this.refsTab(),
      review: () => this.reviewTab(), view: () => this.viewTab(), table: () => this.tableTab(), image: () => this.imageTab(),
    };
    this.body.append(...build[this.tab]());
    this.body.scrollLeft = 0;
    this.fit();
    this.update();
  }

  /** Reconstruye la cinta (al cambiar de mapa de atajos o de documento). */
  rebuild() { this.renderTab(); }

  // ---------- Piezas ----------

  private tip(label: string, action?: string) {
    const k = action ? shortcutLabel(action, this.app.keymap) : '';
    return k ? `${label} (${k})` : label;
  }

  private group(label: string, ...content: (HTMLElement | null)[]) {
    return h('div', { class: 'rg' }, h('div', { class: 'rg-content' }, ...content), h('div', { class: 'rg-label' }, label));
  }

  private rows(...rows: HTMLElement[][]) {
    return h('div', { class: 'rg-rows' }, ...rows.map((r) => h('div', { class: 'rg-row' }, ...r)));
  }

  private stack(...items: HTMLElement[]) {
    return h('div', { class: 'rg-stack' }, ...items);
  }

  private reg(id: string, b: HTMLButtonElement) {
    this.buttons.set(id, b);
    return b;
  }

  /** Botón pequeño solo con icono. `g:texto|clase` dibuja un glifo tipográfico. */
  private ib(id: string, ic: string, label: string, run: (e: MouseEvent) => void, action?: string) {
    let content = icon(ic);
    if (ic.startsWith('g:')) {
      const [text, cls = ''] = ic.slice(2).split('|');
      content = `<span class="rb-glyph ${cls}">${text}</span>`;
    }
    return this.reg(id, h('button', {
      class: 'rb-btn', title: this.tip(label, action ?? id), 'aria-label': label, html: content,
      onmousedown: (e: MouseEvent) => e.preventDefault(), onclick: run,
    }));
  }

  /** Botón pequeño con icono y texto (en columnas apiladas, como Word). */
  private sb(id: string, ic: string, label: string, run: (e: MouseEvent) => void, action?: string) {
    return this.reg(id, h('button', {
      class: 'rb-small', title: this.tip(label, action ?? id),
      onmousedown: (e: MouseEvent) => e.preventDefault(), onclick: run,
    }, h('span', { html: icon(ic, 16) }), h('span', { class: 'rb-small-label' }, label)));
  }

  /** Botón grande con el icono sobre la etiqueta. */
  private bb(id: string, ic: string, label: string, run: (e: MouseEvent) => void, opts: { action?: string; caret?: boolean } = {}) {
    return this.reg(id, h('button', {
      class: 'rb-big', title: this.tip(label, opts.action ?? id),
      onmousedown: (e: MouseEvent) => e.preventDefault(), onclick: run,
    }, h('span', { class: 'rb-big-ic', html: icon(ic, 22) }),
      h('span', { class: 'rb-big-label' }, label, opts.caret ? h('span', { class: 'rb-caret-inline', html: icon('chevronDown', 10) }) : null)));
  }

  private ed() { return this.app.editor.chain().focus(); }

  // ---------- Inicio ----------

  private homeTab(): HTMLElement[] {
    const app = this.app;
    // Word en español rotula N/K/S; en inglés, B/I/U.
    const [gb, gi, gu] = app.keymap === 'es' ? ['N', 'K', 'S'] : ['B', 'I', 'U'];

    this.fontSel = new FontPicker({
      title: this.tip('Fuente', 'font'), className: 'rb-select rb-font', allowDefault: true,
      onChange: (v) => {
        const f = findFont(v);
        if (f) this.ed().setFontFamily(f.stack).run(); else this.ed().unsetFontFamily().run();
      },
    });
    const sizes = h('datalist', { id: 'font-sizes' }, ...FONT_SIZES.map((s) => h('option', { value: String(s) })));
    this.sizeInput = h('input', { class: 'rb-size', list: 'font-sizes', title: this.tip('Tamaño de fuente', 'fontSize'), 'aria-label': 'Tamaño de fuente', inputmode: 'decimal' });
    const applySize = () => {
      const n = parseFloat(this.sizeInput!.value.replace(',', '.'));
      if (Number.isFinite(n) && n >= 1 && n <= 400) app.applyFontSize(n);
    };
    this.sizeInput.addEventListener('change', applySize);
    this.sizeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applySize(); if (app.view.titleActive) app.view.focusTitle(); else app.editor.commands.focus(); } });

    this.colorBar = h('span', { class: 'rb-colorbar', style: { background: this.lastColor } });
    const colorBtn = this.split(this.ib('color', 'g:A|rb-a', 'Color de fuente', () => this.ed().setColor(this.lastColor).run()), (a) => this.colorPicker(a));
    colorBtn.querySelector('.rb-btn')!.append(this.colorBar);
    const hlBar = h('span', { class: 'rb-colorbar', style: { background: this.lastHighlight } });
    const hlBtn = this.split(this.ib('highlight', 'highlighter', 'Color de resaltado', () => this.ed().toggleHighlight({ color: this.lastHighlight }).run()), (a) => this.highlightPicker(a, hlBar));
    hlBtn.querySelector('.rb-btn')!.append(hlBar);

    const gallery = h('div', { class: 'style-gallery' });
    for (const s of STYLES) {
      const tile = h('button', {
        class: 'style-tile', title: `Estilo ${s.label}`,
        onmousedown: (e: MouseEvent) => e.preventDefault(), onclick: () => this.applyStyle(s.value),
      }, h('span', { class: `style-sample ${s.cls}` }, 'AaBbCc'), h('span', { class: 'style-name' }, s.label));
      this.styleTiles.set(s.value, tile);
      gallery.append(tile);
    }

    return [
      this.group('Portapapeles', this.stack(
        this.sb('cut', 'scissors', 'Cortar', () => { app.editor.commands.focus(); document.execCommand('cut'); }),
        this.sb('copy', 'copy', 'Copiar', () => { app.editor.commands.focus(); document.execCommand('copy'); }),
        this.sb('painter', 'brush', 'Copiar formato', () => this.togglePainter(), 'copyFormat'),
      )),
      this.group('Fuente', this.rows(
        [this.fontSel.el, this.sizeInput, sizes,
          this.ib('growFont', 'g:A<sup>+</sup>|rb-grow', 'Aumentar tamaño', () => app.run('growFont')),
          this.ib('shrinkFont', 'g:A<sup>−</sup>|rb-shrink', 'Reducir tamaño', () => app.run('shrinkFont')),
          this.ib('case', 'g:Aa|rb-case', 'Cambiar mayúsculas y minúsculas', (e) => this.caseMenu(e.currentTarget as HTMLElement), 'changeCase'),
          this.ib('clearMarks', 'eraser', 'Borrar formato', () => app.run('clearMarks'))],
        [this.ib('bold', `g:${gb}|rb-b`, 'Negrita', () => app.run('bold')),
          this.ib('italic', `g:${gi}|rb-i`, 'Cursiva', () => app.run('italic')),
          this.ib('underline', `g:${gu}|rb-u`, 'Subrayado', () => app.run('underline')),
          this.ib('strike', 'g:abc|rb-s', 'Tachado', () => app.run('strike')),
          this.ib('subscript', 'g:x<sub>2</sub>', 'Subíndice', () => app.run('subscript')),
          this.ib('superscript', 'g:x<sup>2</sup>', 'Superíndice', () => app.run('superscript')),
          h('span', { class: 'rg-sep' }), hlBtn, colorBtn],
      )),
      this.group('Párrafo', this.rows(
        [this.ib('bulletList', 'listBullet', 'Viñetas', () => app.run('bulletList')),
          this.ib('orderedList', 'listOrdered', 'Numeración', () => app.run('orderedList')),
          this.ib('taskList', 'listTodo', 'Lista de tareas', () => this.ed().toggleTaskList().run()),
          h('span', { class: 'rg-sep' }),
          this.ib('outdent', 'outdent', 'Reducir sangría', () => app.run('outdent')),
          this.ib('indent', 'indent', 'Aumentar sangría', () => app.run('indent')),
          h('span', { class: 'rg-sep' }),
          this.ib('showMarks', 'pilcrow', 'Mostrar marcas de formato', () => app.run('showMarks'))],
        [this.ib('alignLeft', 'alignLeft', 'Alinear a la izquierda', () => app.run('alignLeft')),
          this.ib('alignCenter', 'alignCenter', 'Centrar', () => app.run('alignCenter')),
          this.ib('alignRight', 'alignRight', 'Alinear a la derecha', () => app.run('alignRight')),
          this.ib('alignJustify', 'alignJustify', 'Justificar', () => app.run('alignJustify')),
          h('span', { class: 'rg-sep' }),
          this.ib('lineSpacing', 'lineSpacing', 'Interlineado', (e) => this.lineSpacingMenu(e.currentTarget as HTMLElement))],
      )),
      this.group('Estilos', gallery),
      this.group('Edición', this.stack(
        this.sb('find', 'search', 'Buscar', () => app.run('find')),
        this.sb('replace', 'replace', 'Reemplazar', () => app.run('replace')),
        this.sb('selectAll', 'selectAll', 'Seleccionar todo', () => app.run('selectAll')),
      )),
    ];
  }

  private split(main: HTMLButtonElement, open: (anchor: HTMLElement) => void) {
    return h('div', { class: 'rb-split' }, main,
      h('button', { class: 'rb-caret', title: 'Más opciones', html: icon('chevronDown', 11), onmousedown: (e: MouseEvent) => e.preventDefault(), onclick: (e: MouseEvent) => open(e.currentTarget as HTMLElement) }));
  }

  private applyStyle(v: string) {
    const c = this.ed();
    if (v === 'p') c.setParagraph().run();
    else if (v.startsWith('h')) c.setHeading({ level: Number(v[1]) as 1 | 2 | 3 | 4 }).run();
    else if (v === 'quote') c.toggleBlockquote().run();
    else if (v === 'code') c.toggleCodeBlock().run();
  }

  private togglePainter() {
    const app = this.app;
    if (app.formatClipboard && app.painterOnce) {
      app.painterOnce = false;
      document.body.classList.remove('painter');
      this.update();
    } else app.copyFormat();
  }

  // ---------- Insertar ----------

  private insertTab(): HTMLElement[] {
    const app = this.app;
    const runBlock = (id: string) => () => BLOCKS.find((b) => b.id === id)!.run(app.editor);
    return [
      this.group('Páginas', this.bb('pageBreak', 'pageBreak', 'Salto de página', () => app.run('pageBreak'))),
      this.group('Tablas', this.bb('table', 'table', 'Tabla', (e) => this.tablePicker(e.currentTarget as HTMLElement), { caret: true })),
      this.group('Ilustraciones', this.bb('image', 'image', 'Imagen', () => emit('ui:insert-image'))),
      this.group('Vínculos', this.bb('link', 'link', 'Vínculo', () => app.run('link'))),
      this.group('Comentarios', this.bb('comment', 'comment', 'Comentario', () => app.run('comment'))),
      this.group('Texto',
        this.bb('callout', 'callout', 'Cuadro', (e) => this.calloutMenu(e.currentTarget as HTMLElement), { caret: true }),
        this.stack(
          this.sb('toggle', 'toggleBlock', 'Plegable', runBlock('toggle')),
          this.sb('quoteBlock', 'quote', 'Cita', runBlock('quote')),
          this.sb('codeBlock', 'code', 'Código', runBlock('code')),
        )),
      this.group('Símbolos',
        this.bb('equationBlock', 'sigma', 'Ecuación', runBlock('math')),
        this.stack(
          this.sb('mathInline', 'sigma', 'En línea', () => app.run('equation'), 'equation'),
          this.sb('hr', 'minus', 'Separador', runBlock('hr')),
          this.sb('date', 'calendar', 'Fecha', () => app.run('date')),
        )),
      this.group('Docente',
        this.bb('solution', 'checkCircle', 'Solución', runBlock('solution')),
        this.bb('lines', 'lines', 'Líneas', runBlock('lines')),
        this.bb('question', 'question', 'Pregunta', runBlock('question')),
      ),
      this.group('Bloques', this.bb('insert', 'blocks', 'Todos', (e) => this.insertMenu(e.currentTarget as HTMLElement), { caret: true })),
    ];
  }

  // ---------- Disposición ----------

  private layoutTab(): HTMLElement[] {
    const app = this.app;
    const s = () => app.doc?.setup;
    const set = (patch: Record<string, unknown>) => {
      const cur = s();
      if (cur) void app.setSetup({ ...cur, ...patch }).then(() => this.renderTab());
    };
    const fmt = (n: number) => String(n).replace('.', ',');
    const margins = (e: MouseEvent) => popupMenu(e.currentTarget as HTMLElement, [
      ...([['Normal', 25, 25, 25, 25], ['Estrecho', 12.7, 12.7, 12.7, 12.7], ['Moderado', 25.4, 25.4, 19.1, 19.1], ['Ancho', 25.4, 25.4, 50.8, 50.8]] as [string, number, number, number, number][])
        .map(([n, t, b, l, r]) => ({
          label: `${n} · ${fmt(t)} / ${fmt(l)} mm`, checked: s()?.marginTop === t && s()?.marginLeft === l,
          run: () => set({ marginTop: t, marginBottom: b, marginLeft: l, marginRight: r }),
        })),
      { separator: true },
      { label: 'Márgenes personalizados…', run: () => dialogs.pageSetupDialog(app) },
    ]);
    const orientation = (e: MouseEvent) => popupMenu(e.currentTarget as HTMLElement, [
      { label: 'Vertical', checked: s()?.orientation === 'portrait', run: () => set({ orientation: 'portrait' }) },
      { label: 'Horizontal', checked: s()?.orientation === 'landscape', run: () => set({ orientation: 'landscape' }) },
    ]);
    const size = (e: MouseEvent) => popupMenu(e.currentTarget as HTMLElement, [
      ['A4', 'A4 · 210 × 297 mm'], ['A5', 'A5 · 148 × 210 mm'], ['Letter', 'Carta · 216 × 279 mm'], ['Legal', 'Oficio · 216 × 356 mm'],
    ].map(([v, l]) => ({ label: l, checked: s()?.paper === v, run: () => set({ paper: v }) })));
    const docFont = new FontPicker({ title: 'Fuente del documento', className: 'rb-select rb-font', onChange: (v) => set({ fontFamily: v }) });
    docFont.value = s()?.fontFamily ?? '';
    const docSize = h('select', { class: 'rb-select rb-docsize', title: 'Tamaño base del texto', 'aria-label': 'Tamaño base' },
      ...[9, 10, 10.5, 11, 12, 13, 14, 16].map((n) => h('option', { value: String(n), selected: s()?.fontSize === n }, `${fmt(n)} pt`)));
    docSize.addEventListener('change', () => set({ fontSize: Number(docSize.value) }));
    const docLine = h('select', { class: 'rb-select rb-docsize', title: 'Interlineado del documento', 'aria-label': 'Interlineado del documento' },
      ...[1, 1.15, 1.3, 1.5, 1.8, 2].map((n) => h('option', { value: String(n), selected: s()?.lineHeight === n }, `${fmt(n)} líneas`)));
    docLine.addEventListener('change', () => set({ lineHeight: Number(docLine.value) }));
    const pnum = this.sb('pageNumbers', 'hash', 'Números de página', () => set({ pageNumbers: !s()?.pageNumbers }));
    pnum.classList.toggle('on', !!s()?.pageNumbers);
    return [
      this.group('Configurar página',
        this.bb('margins', 'margins', 'Márgenes', margins, { caret: true }),
        this.bb('orientation', 'orientation', 'Orientación', orientation, { caret: true }),
        this.bb('paper', 'paperSize', 'Tamaño', size, { caret: true }),
      ),
      this.group('Encabezado y pie',
        this.bb('headerFooter', 'headerFooter', 'Editar', () => dialogs.pageSetupDialog(app)),
        this.stack(pnum),
      ),
      this.group('Texto del documento', this.rows([docFont.el], [docSize, docLine])),
      this.group('Opciones', this.bb('pageSetup', 'pageSetup', 'Configurar página', () => dialogs.pageSetupDialog(app))),
    ];
  }

  // ---------- Referencias ----------

  private refsTab(): HTMLElement[] {
    const app = this.app;
    return [
      this.group('Tabla de contenido', this.bb('toc', 'outline', 'Índice', () => app.editor.chain().focus().insertToc().run())),
      this.group('Notas al pie', this.bb('footnote', 'footnote', 'Insertar nota al pie', () => app.run('footnote'))),
      this.group('Navegación',
        this.bb('nav', 'sidebar', 'Panel de navegación', () => app.panels.toggle('outline')),
        this.bb('goto', 'search', 'Ir a título', () => app.run('goto')),
      ),
    ];
  }

  // ---------- Revisar ----------

  private reviewTab(): HTMLElement[] {
    const app = this.app;
    return [
      this.group('Revisión',
        this.bb('spell', 'spell', 'Ortografía', () => { app.setSetting('spellcheck', !app.settings.spellcheck); this.update(); }),
        this.bb('wordCount', 'barChart', 'Contar palabras', () => app.run('wordCount')),
      ),
      this.group('Comentarios',
        this.bb('newComment', 'comment', 'Nuevo comentario', () => app.run('comment'), { action: 'comment' }),
        this.stack(this.sb('showComments', 'outline', 'Mostrar comentarios', () => app.panels.toggle('comments'))),
      ),
      this.group('Versiones',
        this.bb('history', 'history', 'Historial', () => app.panels.toggle('versions'), { action: 'versions' }),
        this.bb('saveVersion', 'save', 'Guardar versión', () => app.run('saveVersion')),
      ),
    ];
  }

  // ---------- Vista ----------

  private viewTab(): HTMLElement[] {
    const app = this.app;
    const check = (label: string, on: boolean, run: () => void) => {
      const box = h('input', { type: 'checkbox', checked: on });
      box.addEventListener('change', run);
      return h('label', { class: 'rb-check' }, box, label);
    };
    const theme = (e: MouseEvent) => popupMenu(e.currentTarget as HTMLElement, ([['system', 'Según el sistema'], ['light', 'Claro'], ['dark', 'Oscuro']] as const)
      .map(([v, l]) => ({ label: l, checked: app.settings.theme === v, run: () => app.setSetting('theme', v) })));
    const fit = app.settings.zoomFit !== false;
    const zoom = (e: MouseEvent) => popupMenu(e.currentTarget as HTMLElement, [
      { label: 'Ajustar al ancho', checked: fit, run: () => app.zoomToFit() },
      ...[50, 75, 90, 100, 110, 125, 150, 175, 200]
        .map((z) => ({ label: `${z} %`, checked: !fit && Math.round(app.settings.zoom * 100) === z, run: () => app.zoom(0, z / 100) }))]);
    return [
      this.group('Vistas',
        this.bb('viewPage', 'page', 'Diseño de impresión', () => app.setSetting('pageView', true)),
        this.bb('viewWeb', 'alignJustify', 'Lectura', () => app.setSetting('pageView', false)),
        this.bb('focus', 'focus', 'Concentración', () => app.toggleFocus()),
      ),
      this.group('Docente', this.bb('studentView', 'users', 'Vista del alumnado', () => app.toggleStudentView())),
      this.group('Mostrar', h('div', { class: 'rg-stack checks' },
        check('Marcas de formato', app.settings.showMarks, () => app.run('showMarks')),
        check('Panel de navegación', document.body.classList.contains('panel-open'), () => app.panels.toggle('outline')),
        check('Panel de documentos', app.sidebarVisible, () => app.run('sidebar')),
      )),
      this.group('Zoom',
        this.bb('zoomMenu', 'search', 'Zoom', zoom, { caret: true }),
        this.stack(
          this.sb('zoom100', 'page', 'Ajustar', () => app.zoomToFit(), 'zoomReset'),
          this.sb('zoomIn', 'plus', 'Acercar', () => app.zoom(0.1)),
          this.sb('zoomOut', 'minus', 'Alejar', () => app.zoom(-0.1)),
        )),
      this.group('Apariencia', this.bb('theme', 'moon', 'Tema', theme, { caret: true })),
    ];
  }

  // ---------- Pestañas contextuales ----------

  private tableTab(): HTMLElement[] {
    const cellColor = (e: MouseEvent) => {
      const grid = h('div', { class: 'color-grid hl' });
      const pick = (c: string | null) => { this.ed().setCellAttribute('background', c).run(); p.close(); };
      for (const c of CELL_COLORS) grid.append(h('button', { class: 'swatch', style: { background: c }, onclick: () => pick(c) }));
      const p = popover(e.currentTarget as HTMLElement, h('div', { class: 'color-picker' }, grid, h('button', { class: 'btn btn-ghost btn-sm btn-block', onclick: () => pick(null) }, 'Sin color')));
    };
    return [
      this.group('Filas y columnas',
        this.bb('rowAbove', 'rowAbove', 'Encima', () => this.ed().addRowBefore().run()),
        this.bb('rowBelow', 'rowBelow', 'Debajo', () => this.ed().addRowAfter().run()),
        this.bb('colLeft', 'colLeft', 'Izquierda', () => this.ed().addColumnBefore().run()),
        this.bb('colRight', 'colRight', 'Derecha', () => this.ed().addColumnAfter().run()),
      ),
      this.group('Eliminar', this.stack(
        this.sb('rowDel', 'rowDel', 'Eliminar fila', () => this.ed().deleteRow().run()),
        this.sb('colDel', 'colDel', 'Eliminar columna', () => this.ed().deleteColumn().run()),
        this.sb('tableDel', 'trash', 'Eliminar tabla', () => this.ed().deleteTable().run()),
      )),
      this.group('Combinar', this.bb('merge', 'merge', 'Combinar o dividir', () => this.ed().mergeOrSplit().run())),
      this.group('Estilo',
        this.bb('headerRow', 'header', 'Fila de encabezado', () => this.ed().toggleHeaderRow().run()),
        this.bb('cellColor', 'paint', 'Sombreado', cellColor, { caret: true }),
      ),
    ];
  }

  private imageTab(): HTMLElement[] {
    const set = (attrs: Record<string, unknown>) => this.ed().updateAttributes('image', attrs).run();
    const w = () => Math.round(this.app.view.editorEl.clientWidth);
    return [
      this.group('Alineación',
        this.bb('imgLeft', 'alignLeft', 'Izquierda', () => set({ align: 'left' })),
        this.bb('imgCenter', 'alignCenter', 'Centro', () => set({ align: 'center' })),
        this.bb('imgRight', 'alignRight', 'Derecha', () => set({ align: 'right' })),
      ),
      this.group('Tamaño', this.stack(
        this.sb('imgSmall', 'minus', 'Pequeña (25 %)', () => set({ width: Math.round(w() * 0.25) })),
        this.sb('imgHalf', 'image', 'Media (50 %)', () => set({ width: Math.round(w() * 0.5) })),
        this.sb('imgFull', 'plus', 'Ancho de página', () => set({ width: w() })),
      ), this.bb('imgReset', 'restore', 'Tamaño original', () => set({ width: null }))),
      this.group('Accesibilidad', this.bb('imgAlt', 'type', 'Texto alternativo', () => dialogs.imageAltDialog(this.app))),
      this.group('Eliminar', this.bb('imgDel', 'trash', 'Eliminar imagen', () => this.ed().deleteSelection().run())),
    ];
  }

  // ---------- Menús ----------

  private caseMenu(anchor: HTMLElement) {
    const ed = this.app.editor;
    popupMenu(anchor, [
      { label: 'minúsculas', run: () => changeCase(ed, 'lower') },
      { label: 'MAYÚSCULAS', run: () => changeCase(ed, 'upper') },
      { label: 'Tipo Título', run: () => changeCase(ed, 'title') },
      { separator: true },
      { label: 'Alternar', hint: 'Mayús+F3', run: () => changeCase(ed) },
    ]);
  }

  private colorPicker(anchor: HTMLElement) {
    const grid = h('div', { class: 'color-grid' });
    const pick = (c: string | null) => {
      if (c) { this.lastColor = c; if (this.colorBar) this.colorBar.style.background = c; this.ed().setColor(c).run(); }
      else this.ed().unsetColor().run();
      p.close();
    };
    for (const row of TEXT_COLORS) for (const c of row) grid.append(h('button', { class: 'swatch', title: c, style: { background: c }, onclick: () => pick(c) }));
    const custom = h('input', { type: 'color', value: this.lastColor, title: 'Más colores' });
    custom.addEventListener('change', () => pick(custom.value));
    const p = popover(anchor, h('div', { class: 'color-picker' },
      h('button', { class: 'btn btn-ghost btn-sm btn-block', onclick: () => pick(null) }, 'Automático'),
      grid, h('label', { class: 'color-more' }, custom, 'Más colores…')));
  }

  private highlightPicker(anchor: HTMLElement, bar: HTMLElement) {
    const grid = h('div', { class: 'color-grid hl' });
    const pick = (c: string | null) => {
      if (c) { this.lastHighlight = c; bar.style.background = c; this.ed().setHighlight({ color: c }).run(); }
      else this.ed().unsetHighlight().run();
      p.close();
    };
    for (const c of HIGHLIGHTS) grid.append(h('button', { class: 'swatch', title: c, style: { background: c }, onclick: () => pick(c) }));
    const p = popover(anchor, h('div', { class: 'color-picker' }, grid, h('button', { class: 'btn btn-ghost btn-sm btn-block', onclick: () => pick(null) }, 'Sin resaltado')));
  }

  private lineSpacingMenu(anchor: HTMLElement) {
    const ed = this.app.editor;
    const cur = ed.getAttributes('paragraph').lineHeight ?? ed.getAttributes('heading').lineHeight ?? null;
    const set = (v: number | null) => ed.chain().focus().setLineHeight(v).run();
    popupMenu(anchor, [
      { label: 'Predeterminado del documento', checked: cur === null, run: () => set(null) },
      ...[1, 1.15, 1.5, 2, 2.5, 3].map((v) => ({
        label: v.toLocaleString('es-ES'), checked: cur === v,
        hint: v === 1 ? 'Ctrl+1' : v === 1.5 ? 'Ctrl+5' : v === 2 ? 'Ctrl+2' : '',
        run: () => set(v),
      })),
    ]);
  }

  private tablePicker(anchor: HTMLElement) {
    const grid = h('div', { class: 'table-grid' });
    const label = h('div', { class: 'table-grid-label' }, 'Insertar tabla');
    const cells: HTMLElement[] = [];
    let p: { close: () => void };
    for (let r = 1; r <= 8; r++) {
      for (let c = 1; c <= 10; c++) {
        const cell = h('button', { class: 'tg-cell', dataset: { r: String(r), c: String(c) } });
        cell.addEventListener('mouseenter', () => {
          label.textContent = `Tabla de ${c} × ${r}`;
          cells.forEach((x) => x.classList.toggle('on', Number(x.dataset.r) <= r && Number(x.dataset.c) <= c));
        });
        cell.addEventListener('click', () => {
          this.ed().insertTable({ rows: r, cols: c, withHeaderRow: true }).run();
          p.close();
        });
        cells.push(cell);
        grid.append(cell);
      }
    }
    p = popover(anchor, h('div', { class: 'table-picker' }, label, grid));
  }

  private calloutMenu(anchor: HTMLElement) {
    popupMenu(anchor, Object.entries(CALLOUT_KINDS).map(([k, v]) => ({
      label: v.label, icon: v.icon,
      run: () => {
        const ed = this.app.editor;
        if (ed.isActive('callout')) ed.chain().focus().setCalloutKind(k).run();
        else ed.chain().focus().setCallout(k).run();
      },
    })));
  }

  private insertMenu(anchor: HTMLElement) {
    const out: MenuItem[] = [];
    let group = '';
    for (const b of BLOCKS) {
      if (b.group !== group) { group = b.group; out.push({ heading: group }); }
      out.push({ label: b.title, iconHTML: blockIconHTML(b, 16), hint: b.shortcut, run: () => b.run(this.app.editor) });
    }
    popupMenu(anchor, out, { className: 'menu-tall' });
  }

  focusFont() { this.select('home'); requestAnimationFrame(() => this.fontSel?.open()); }
  focusSize() { this.select('home'); requestAnimationFrame(() => { this.sizeInput?.focus(); this.sizeInput?.select(); }); }
  focusStyle() { this.select('home'); requestAnimationFrame(() => this.styleTiles.get('p')?.focus()); }

  // ---------- Estado ----------

  update() {
    const ed = this.app.editor;
    // Oculta (móvil, cinta plegada o agenda): no merece la pena consultar el formato
    if (!ed || this.app.mobile || !this.app.settings.ribbon || this.app.mode === 'agenda') return;
    const inTable = ed.isActive('table');
    const onImage = !!this.app.selectedImage();
    this.tabButtons.get('table')!.hidden = !inTable;
    this.tabButtons.get('image')!.hidden = !onImage;
    if ((this.tab === 'table' && !inTable) || (this.tab === 'image' && !onImage)) {
      this.tab = 'home';
      this.renderTab();
      return;
    }
    const active = (id: string, on: boolean) => this.buttons.get(id)?.classList.toggle('on', on);
    for (const m of ['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript', 'highlight', 'bulletList', 'orderedList', 'taskList', 'link', 'callout']) {
      active(m, ed.isActive(m));
    }
    active('painter', this.app.painterOnce);
    active('showMarks', this.app.settings.showMarks);
    active('spell', this.app.settings.spellcheck);
    active('viewPage', this.app.settings.pageView);
    active('viewWeb', !this.app.settings.pageView);
    active('focus', this.app.focusMode);
    active('studentView', this.app.studentView);
    for (const a of ['left', 'center', 'right', 'justify']) active(`align${a[0].toUpperCase()}${a.slice(1)}`, ed.isActive({ textAlign: a }));
    const img = this.app.selectedImage();
    if (img) for (const a of ['Left', 'Center', 'Right']) active(`img${a}`, img.attrs.align === a.toLowerCase());

    let style = 'p';
    for (let l = 1; l <= 4; l++) if (ed.isActive('heading', { level: l })) style = `h${l}`;
    if (ed.isActive('codeBlock')) style = 'code';
    else if (ed.isActive('blockquote') && style === 'p') style = 'quote';
    this.styleTiles.forEach((t, v) => t.classList.toggle('on', v === style));
    if (this.fontSel) {
      const ff = (ed.getAttributes('textStyle').fontFamily as string | undefined) ?? '';
      this.fontSel.value = ff;
    }
    if (this.sizeInput && document.activeElement !== this.sizeInput) this.sizeInput.value = String(this.app.currentFontSize()).replace('.', ',');
    if (this.colorBar) this.colorBar.style.background = (ed.getAttributes('textStyle').color as string | undefined) ?? this.lastColor;
  }
}
