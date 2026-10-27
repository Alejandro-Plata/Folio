import type { App } from '../app';
import { undoDepth, redoDepth } from '@tiptap/pm/history';
import { isDesktop } from '../platform/platform';
import type { Doc } from '../types';
import { h, iconButton, popupMenu, debounce } from './dom';
import { icon, docIcon, hasIcon } from './icons';
import { pageSizeMM, expandPlaceholders } from '../io';
import { fontStack } from '../fonts';
import { sheetElement, type PageChrome } from '../editor/pagination';
import { TEMPLATES } from '../templates';
import * as dialogs from './dialogs';
import { openBackstage } from './backstage';

const MM = 96 / 25.4; // px por mm a 96 ppp

export class DocView {
  scroller = document.getElementById('scroller')!;
  page = document.getElementById('page')!;
  editorEl = document.getElementById('editor')!;
  private head = document.getElementById('doc-head')!;
  private footnotes = document.getElementById('footnotes')!;
  private empty = document.getElementById('empty')!;
  private topbar = document.getElementById('topbar')!;
  private titleEl!: HTMLTextAreaElement;
  private filler = h('div', { id: 'page-filler', class: 'page-filler', contenteditable: 'false' });
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private crumbs!: HTMLElement;
  private headerPreview!: HTMLElement;

  constructor(private app: App) {}

  mount() {
    this.buildTopbar();
    this.buildHead();
    this.scroller.addEventListener('scroll', () => this.app.status.updatePage(), { passive: true });
    // Clic en el margen de la página: lleva el cursor al final, como Word
    this.page.addEventListener('mousedown', (e) => {
      if (e.target === this.page || (e.target as HTMLElement).classList.contains('page-inner')) {
        e.preventDefault();
        this.app.editor.commands.focus('end');
      }
    });
  }

  private buildTopbar() {
    const app = this.app;
    const k = (action: string) => {
      const sc = { save: app.keymap === 'es' ? 'Ctrl+G' : 'Ctrl+S', undo: 'Ctrl+Z', redo: 'Ctrl+Y' } as Record<string, string>;
      return sc[action];
    };
    this.crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Ruta del documento' });
    this.undoBtn = iconButton('undo', `Deshacer (${k('undo')})`, () => app.run('undo'));
    this.redoBtn = iconButton('redo', `Rehacer (${k('redo')})`, () => app.run('redo'));
    const quick = h('div', { class: 'quick' },
      iconButton('sidebar', 'Panel de documentos (Ctrl+\\)', () => app.run('sidebar')),
      h('span', { class: 'quick-sep' }),
      iconButton('save', `Guardar (${k('save')})`, () => app.run('save')),
      this.undoBtn, this.redoBtn);
    const search = h('button', { class: 'top-search', title: 'Buscar comandos y documentos (Alt+Q)', onclick: () => app.palette.open('commands') },
      h('span', { html: icon('search', 15) }), h('span', { class: 'top-search-text' }, 'Buscar'), h('kbd', {}, 'Alt+Q'));
    const actions = h('div', { class: 'top-actions' },
      iconButton('comment', 'Comentarios', () => app.panels.toggle('comments')),
      iconButton('history', 'Historial de versiones (Ctrl+Alt+H)', () => app.panels.toggle('versions')),
      h('button', { class: 'btn btn-sm btn-accent', title: 'Exportar a Word, PDF, HTML o Markdown', onclick: () => openBackstage(app, 'export') },
        h('span', { html: icon('share', 15) }), h('span', { class: 'btn-label' }, 'Exportar')),
      iconButton('help', 'Ayuda y tutorial', (e) => this.helpMenu(e.currentTarget as HTMLElement), { class: 'help-btn' }),
      iconButton('more', 'Más opciones', (e) => this.moreMenu(e.currentTarget as HTMLElement)),
    );
    this.topbar.append(quick, h('div', { class: 'top-center' }, this.crumbs), h('div', { class: 'top-right' }, search, actions, isDesktop ? this.windowControls() : null));
  }

  /**
   * La ventana no tiene marco del sistema: esta barra hace de barra de título
   * (se arrastra por cualquier hueco) y lleva minimizar, maximizar y cerrar.
   * Cerrar pasa por el mismo camino que el botón del sistema: se guarda antes.
   */
  private windowControls() {
    const rt = window.runtime!;
    const btn = (ic: string, title: string, run: () => void, cls = '') =>
      h('button', { class: `win-btn ${cls}`, title, 'aria-label': title, html: icon(ic, 14), onmousedown: (e: MouseEvent) => e.preventDefault(), onclick: run });
    const max = btn('winMax', 'Maximizar', () => rt.WindowToggleMaximise());
    const sync = async () => {
      const m = await rt.WindowIsMaximised();
      max.innerHTML = icon(m ? 'winRestore' : 'winMax', 14);
      max.title = m ? 'Restaurar' : 'Maximizar';
      max.setAttribute('aria-label', max.title);
      document.body.classList.toggle('win-maximised', m);
    };
    window.addEventListener('resize', debounce(() => void sync(), 120));
    void sync();
    // En Linux el gestor de ventanas no ve la barra como título: doble clic para maximizar
    if (this.app.os !== 'windows') {
      document.addEventListener('dblclick', (e) => {
        const t = e.target as Element;
        if (t.closest('.topbar, .sb-head') && !t.closest('button, input, a')) rt.WindowToggleMaximise();
      });
    }
    return h('div', { class: 'win-controls' },
      btn('winMin', 'Minimizar', () => rt.WindowMinimise()),
      max,
      btn('winClose', 'Cerrar', () => rt.Quit(), 'win-close'));
  }

  /** Estado de los botones de acceso rápido (deshacer/rehacer). */
  updateQuick() {
    // Mirar la profundidad del historial es inmediato; can().undo() simula la operación
    const st = this.app.editor.state;
    this.undoBtn.disabled = !this.app.doc || undoDepth(st) === 0;
    this.redoBtn.disabled = !this.app.doc || redoDepth(st) === 0;
  }

  private helpMenu(anchor: HTMLElement) {
    const app = this.app;
    popupMenu(anchor, [
      { label: 'Manual de Folio', icon: 'bookOpen', run: () => void app.openManual() },
      { label: 'Tutorial de documentos', icon: 'graduation', run: () => void app.startTour() },
      { label: 'Tutorial de la agenda', icon: 'calendar', run: () => void app.startTour('agenda') },
      { label: 'Atajos de teclado', icon: 'keyboard', run: () => app.run('help') },
    ], { align: 'right' });
  }

  private moreMenu(anchor: HTMLElement) {
    const app = this.app;
    const d = app.doc;
    if (!d) return;
    popupMenu(anchor, [
      { label: d.meta.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos', icon: 'star', run: () => app.updateMeta(d.meta.id, { favorite: !d.meta.favorite }) },
      { label: 'Cambiar icono…', icon: docIconName(d.meta.icon), run: () => dialogs.iconPicker(app, d.meta.id, anchor) },
      { label: 'Información del documento', icon: 'info', run: () => openBackstage(app, 'info') },
      { label: 'Configurar página…', icon: 'pageSetup', run: () => dialogs.pageSetupDialog(app) },
      { label: 'Guardar versión con nombre…', icon: 'history', hint: 'F12', run: () => app.namedVersion() },
      { label: 'Duplicar', icon: 'copy', run: () => app.duplicate(d.meta.id) },
      { label: 'Contar palabras', icon: 'outline', hint: 'Ctrl+Mayús+G', run: () => dialogs.wordCountDialog(app) },
      { separator: true },
      { label: 'Vista de página', checked: app.settings.pageView, run: () => app.setSetting('pageView', true) },
      { label: 'Vista de lectura (ancho completo)', checked: !app.settings.pageView, run: () => app.setSetting('pageView', false) },
      { label: 'Mostrar marcas ¶', checked: app.settings.showMarks, hint: 'Ctrl+Mayús+8', run: () => app.run('showMarks') },
      { label: 'Modo concentración', icon: 'focus', hint: 'Ctrl+Mayús+F11', run: () => app.toggleFocus() },
      { separator: true },
      { label: 'Atajos de teclado', icon: 'keyboard', hint: 'F1', run: () => dialogs.shortcutsDialog(app) },
      { label: 'Ajustes', icon: 'settings', run: () => dialogs.settingsDialog(app) },
      { separator: true },
      { label: 'Mover a la papelera', icon: 'trash', danger: true, run: () => app.trash(d.meta.id) },
    ], { align: 'right' });
  }

  private buildHead() {
    this.headerPreview = h('div', { class: 'header-preview', title: 'Encabezado (Disposición > Encabezado y pie)', onclick: () => dialogs.pageSetupDialog(this.app) });
    this.titleEl = h('textarea', { class: 'doc-title', rows: 1, placeholder: 'Sin título', spellcheck: 'true', 'aria-label': 'Título del documento' });
    const commit = debounce(() => this.commitTitle(), 500);
    this.titleEl.addEventListener('input', () => { this.autosize(); commit(); this.updateBreadcrumb(this.titleEl.value); this.app.paginator.schedule(); });
    this.titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || (e.key === 'ArrowDown' && this.titleEl.selectionStart === this.titleEl.value.length)) {
        e.preventDefault();
        this.commitTitle();
        this.app.focusEditorStart();
      }
    });
    this.page.prepend(this.headerPreview);
    this.head.append(this.titleEl);
    this.page.querySelector('.page-inner')!.append(this.filler);
  }

  /** Ajusta la altura del título a su texto (hay que repetirlo si estaba oculto al calcularlo). */
  autosize() {
    this.titleEl.style.height = 'auto';
    this.titleEl.style.height = `${this.titleEl.scrollHeight}px`;
  }

  commitTitle() {
    const d = this.app.doc;
    if (!d || !this.titleEl) return;
    const v = this.titleEl.value.replace(/\n/g, ' ').trim();
    if (v !== d.meta.title) {
      d.meta.title = v;
      void this.app.updateMeta(d.meta.id, { title: v });
    }
  }

  focusTitle() {
    this.titleEl.focus();
    this.titleEl.select();
  }

  showDoc(d: Doc) {
    this.empty.hidden = true;
    this.page.hidden = false;
    document.body.classList.remove('no-doc');
    this.titleEl.value = d.meta.title;
    requestAnimationFrame(() => this.autosize());
    this.applySetup();
    this.updateBreadcrumb();
    this.updateFootnotes();
  }

  updateBreadcrumb(liveTitle?: string) {
    const d = this.app.doc;
    this.crumbs.innerHTML = '';
    if (this.app.mode === 'agenda') {
      this.crumbs.append(h('span', { class: 'crumb current' }, h('span', { class: 'crumb-ic', html: icon('calendar', 14) }), 'Agenda'));
      return;
    }
    if (!d) return;
    const chain = [];
    let cur = this.app.docs.find((x) => x.id === d.meta.parentId);
    while (cur) {
      chain.unshift(cur);
      const pid: string = cur.parentId;
      cur = pid ? this.app.docs.find((x) => x.id === pid) : undefined;
    }
    for (const c of chain) {
      this.crumbs.append(
        h('button', { class: 'crumb', onclick: () => this.app.open(c.id) }, c.title || 'Sin título'),
        h('span', { class: 'crumb-sep' }, '/'),
      );
    }
    const title = liveTitle ?? d.meta.title;
    this.crumbs.append(h('span', { class: 'crumb current' }, h('span', { class: 'crumb-ic', html: docIcon(d.meta.icon, 15) }), title || 'Sin título'));
  }

  /** Aplica tamaño de papel, márgenes y fuente del documento a la vista de página. */
  applySetup() {
    const d = this.app.doc;
    if (!d) return;
    const s = d.setup;
    const [w, hgt] = pageSizeMM(s);
    const st = this.page.style;
    st.setProperty('--page-w', `${(w * MM).toFixed(1)}px`);
    st.setProperty('--page-h', `${(hgt * MM).toFixed(1)}px`);
    st.setProperty('--m-top', `${(s.marginTop * MM).toFixed(1)}px`);
    st.setProperty('--m-bottom', `${(s.marginBottom * MM).toFixed(1)}px`);
    st.setProperty('--m-left', `${(s.marginLeft * MM).toFixed(1)}px`);
    st.setProperty('--m-right', `${(s.marginRight * MM).toFixed(1)}px`);
    st.setProperty('--doc-font', fontStack(s.fontFamily));
    st.setProperty('--doc-size', `${s.fontSize}pt`);
    st.setProperty('--doc-lh', String(s.lineHeight));
    // Altura útil: las imágenes nunca superan una página (igual que en el PDF)
    st.setProperty('--content-h', `${((hgt - s.marginTop - s.marginBottom) * MM).toFixed(1)}px`);
    const header = expandPlaceholders(s.header || '', d.meta.title, this.app.settings.authorName);
    this.headerPreview.textContent = header;
    this.headerPreview.hidden = !header;
    this.app.status?.update();
    this.app.paginator?.schedule(0);
  }

  applyZoom() {
    this.page.style.setProperty('zoom', String(this.app.zoomLevel));
  }

  /** Ancho de la hoja sin zoom (0 en la vista de lectura). */
  pageWidthPx() {
    return parseFloat(getComputedStyle(this.page).getPropertyValue('--page-w')) || 0;
  }

  /** Lista de notas al pie al final del documento (misma estructura que en el PDF). */
  updateFootnotes = debounce(() => {
    const notes: { text: string; pos: number }[] = [];
    this.app.editor.state.doc.descendants((n, pos) => {
      if (n.type.name === 'footnote') notes.push({ text: n.attrs.text, pos });
      return true;
    });
    this.footnotes.innerHTML = '';
    this.footnotes.hidden = !notes.length;
    if (notes.length) {
      const ol = h('ol', {});
      notes.forEach((n) => {
        ol.append(h('li', {
          title: 'Editar nota', onclick: () => {
            const dom = this.app.editor.view.nodeDOM(n.pos) as HTMLElement | null;
            dom?.click();
            dom?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          },
        }, n.text || '(nota vacía)'));
      });
      this.footnotes.append(h('div', { class: 'footnotes-rule' }), h('div', { class: 'footnotes-title' }, 'Notas al pie'), ol);
    }
    this.app.paginator.schedule(0);
  }, 150);

  // ---------- Hojas (paginación) ----------

  /** Bloques de las notas al pie para paginar: el primero incluye el título de la lista. */
  footnoteBlocks(): { top: HTMLElement; bottom: HTMLElement }[] {
    if (this.footnotes.hidden) return [];
    const items = Array.from(this.footnotes.querySelectorAll<HTMLElement>(':scope > ol > li'));
    return items.map((li, i) => ({ top: i === 0 ? this.footnotes : li, bottom: li }));
  }

  /** Último elemento con contenido de la hoja. */
  pageEnd(): HTMLElement {
    return this.footnotes.hidden ? this.editorEl : this.footnotes;
  }

  applyFootnoteBreaks(breaks: { index: number; height: number; page: number }[], chrome: PageChrome | null, pages: number) {
    this.page.querySelectorAll('.pb-gap.fn').forEach((el) => el.remove());
    if (!chrome) return;
    const items = Array.from(this.footnotes.querySelectorAll<HTMLElement>(':scope > ol > li'));
    for (const b of breaks) {
      const gap = h('div', { class: 'pb-gap fn', style: { height: `${b.height}px` } }, sheetElement(b.height, b.page, pages, chrome));
      if (b.index === 0) this.footnotes.before(gap); else items[b.index]?.before(gap);
    }
  }

  /** Completa la última hoja hasta su final y dibuja su pie. */
  applyFiller(height: number, footer: string, chrome: PageChrome | null) {
    this.filler.style.height = chrome ? `${height}px` : '0';
    this.filler.innerHTML = '';
    if (!chrome || !footer) return;
    this.filler.append(h('div', { class: 'pb-footer', style: { bottom: `${chrome.marginBottom / 2}px` } }, footer));
  }

  applyFirstHeader(chrome: PageChrome) {
    this.headerPreview.textContent = chrome.header;
    this.headerPreview.hidden = !chrome.header;
  }

  showEmpty() {
    this.page.hidden = true;
    this.empty.hidden = false;
    document.body.classList.add('no-doc');
    this.crumbs.innerHTML = '';
    this.empty.innerHTML = '';
    const grid = h('div', { class: 'tpl-grid' });
    for (const t of TEMPLATES) {
      grid.append(h('button', { class: 'tpl-card', onclick: () => this.app.newDoc('', t) },
        h('span', { class: 'tpl-icon', html: icon(t.icon, 22) }), h('span', { class: 'tpl-title' }, t.title), h('span', { class: 'tpl-desc' }, t.description)));
    }
    this.empty.append(h('div', { class: 'empty-inner' },
      h('h1', {}, 'Empieza un documento'),
      h('p', { class: 'muted' }, 'Elige una plantilla o importa un archivo de Word.'),
      grid,
      h('button', { class: 'btn', onclick: () => dialogs.importDialog(this.app) }, h('span', { html: icon('upload') }), 'Importar .docx, .md o .html'),
    ));
  }
}

function docIconName(name: string) {
  return hasIcon(name) ? name : 'file';
}
