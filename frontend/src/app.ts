import type { Editor, JSONContent } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { api, isNative, onEvent, setWindowTitle } from './api';
import { on } from './bus';
import { createEditor, loadContent, scaleColumnDrag } from './editor/editor';
import { changeCase, moveBlock } from './editor/extensions';
import { clearFind } from './editor/find';
import { findShortcut, isNativeEditingCombo, type KeymapId } from './shortcuts';
import { TEMPLATES, WELCOME, jsonToText, type Template } from './templates';
import { debounce, hasOpenModal, closeMenu, toast, confirmDialog, promptText } from './ui/dom';
import { Sidebar } from './ui/sidebar';
import { Ribbon } from './ui/ribbon';
import { Panels } from './ui/panels';
import { Palette } from './ui/palette';
import * as dialogs from './ui/dialogs';
import { openBackstage } from './ui/backstage';
import { FindBar } from './ui/findbar';
import { StatusBar } from './ui/statusbar';
import { DocView } from './ui/docview';
import { Paginator, type LayoutSnapshot } from './ui/paginator';
import { Tour, removeLeftoverPractice } from './ui/tour';
import { BlockHandle } from './ui/blockhandle';
import { dropPdfs } from './ui/pdfmerge';
import { AgendaView } from './agenda/view';
import { SyncManager } from './sync/manager';
import type { MobileShell } from './mobile/shell';
import { isAndroid } from './platform/platform';
import { initAndroid, updateStatusBar } from './platform/android-init';
import { Reminders } from './platform/reminders';
import { SocialManager } from './social/manager';
import { contentCSS, PAGE_EXTRAS_CSS } from './content-css';
import type { Doc, ExportOptions, InitData, Meta, PageSetup, Settings } from './types';

export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

interface FormatClipboard { marks: any[]; block: Record<string, unknown> }

export class App {
  settings!: Settings;
  docs: Meta[] = [];
  doc: Doc | null = null;
  version = '';
  os = '';
  workspace = '';
  editor!: Editor;

  sidebar!: Sidebar;
  ribbon!: Ribbon;
  panels!: Panels;
  palette!: Palette;
  findbar!: FindBar;
  status!: StatusBar;
  view!: DocView;
  paginator!: Paginator;
  private tour: Tour | null = null;
  /** Espacio activo: documentos o agenda. */
  mode: 'docs' | 'agenda' = 'docs';
  agenda!: AgendaView;
  sync!: SyncManager;
  social = new SocialManager(this);
  mobile: MobileShell | null = null;
  reminders = new Reminders(this);
  /** Vista del alumnado: oculta las soluciones (y pagina sin ellas). */
  studentView = false;

  saveState: 'saved' | 'dirty' | 'saving' | 'error' = 'saved';
  lastSaved: Date | null = null;
  formatClipboard: FormatClipboard | null = null;
  painterOnce = false;
  focusMode = false;
  /** Ventana estrecha: el panel de documentos flota sobre el documento y empieza cerrado. */
  private narrow = matchMedia('(max-width: 1100px)');
  private sidebarFloating = false;

  private saveQueued = false;
  private saving: Promise<void> | null = null;
  private loadToken = 0;

  async start() {
    const init: InitData = await api.Init();
    this.settings = { ...init.settings, keymap: init.settings.keymap || 'es' };
    this.docs = init.docs ?? [];
    this.version = init.version;
    this.os = init.os;
    this.workspace = init.workspace;
    this.applyTheme();
    // Estilos del contenido compartidos con la exportación
    const css = document.createElement('style');
    css.id = 'content-css';
    css.textContent = contentCSS('.doc-body') + PAGE_EXTRAS_CSS;
    document.head.append(css);

    this.view = new DocView(this);
    this.editor = createEditor({
      element: this.view.editorEl,
      smartQuotes: this.settings.smartQuotes,
      spellcheck: this.settings.spellcheck,
      getDocId: () => this.doc?.meta.id ?? null,
      onUpdate: () => this.onEditorUpdate(),
      onSelection: () => this.onSelection(),
    });
    scaleColumnDrag(this.editor.view, () => this.zoomLevel);
    this.paginator = new Paginator(this);
    this.sidebar = new Sidebar(this);
    this.ribbon = new Ribbon(this);
    this.panels = new Panels(this);
    this.palette = new Palette(this);
    this.findbar = new FindBar(this);
    this.status = new StatusBar(this);
    this.view.mount();
    new BlockHandle(this, this.view.scroller);
    window.runtime?.OnFileDrop((_x, _y, paths) => void dropPdfs(this, paths), false);
    this.agenda = new AgendaView(this);
    this.sync = new SyncManager(this);
    this.sync.onChange(() => this.status.updateSync());
    if (isAndroid) { initAndroid(this); void this.reminders.init(); }
    if (isNative) void import('./ui/updates').then((m) => m.scheduleUpdateCheck(this));
    this.applyLayout();
    this.bindGlobalEvents();
    this.narrow.addEventListener('change', () => { this.sidebarFloating = false; this.applyLayout(); });
    document.getElementById('sidebar-scrim')!.addEventListener('click', () => this.showSidebar(false));
    // El zoom «ajustar al ancho» depende del espacio disponible
    let lastW = 0;
    new ResizeObserver(() => {
      const w = this.view.scroller.clientWidth;
      if (w !== lastW) { lastW = w; this.view.applyZoom(); this.status.update(); }
    }).observe(this.view.scroller);

    if (!this.docs.length) {
      const m = await this.createFromJSON('Guía rápida de Folio', 'lightbulb', WELCOME(), '');
      this.docs = await api.ListDocs();
      await this.open(m.id);
    } else {
      const last = this.docs.find((d) => d.id === this.settings.lastDoc && !d.trashed) ?? this.docs.find((d) => !d.trashed);
      if (last) await this.open(last.id);
      else this.view.showEmpty();
    }
    this.sidebar.render();
    try { if (localStorage.getItem('folio-mode') === 'agenda') await this.setMode('agenda'); } catch { /* */ }
    // Interfaz móvil: se monta al final, para no saltar al editor al abrir el último documento
    if (document.body.classList.contains('is-mobile')) {
      const { MobileShell } = await import('./mobile/shell');
      this.mobile = new MobileShell(this);
    }
    document.body.classList.add('ready');
    void this.sync.init();
    void this.social.init();
    await removeLeftoverPractice(this);
    // La primera vez, el tutorial (que en Windows ya explica cómo anclar Folio).
    if (!this.settings.tourDone) void this.startTour(); else this.showPinTip();
  }

  /** Cambia entre Documentos y Agenda. */
  async setMode(mode: 'docs' | 'agenda') {
    if (mode === 'agenda' && !this.agenda.root.isConnected) {
      document.getElementById('ribbon')!.after(this.agenda.root);
    }
    this.mode = mode;
    document.body.classList.toggle('mode-agenda', mode === 'agenda');
    try { localStorage.setItem('folio-mode', mode); } catch { /* */ }
    if (mode === 'agenda') {
      await this.flush();
      await this.agenda.mount(document.querySelector('.main')!);
      this.agenda.show();
      this.sidebar.setMode('agenda', this.agenda.sidebar.el);
      if (this.agenda.sidebar.stale) void this.agenda.sidebar.render();
      this.findbar.close();
      this.panels.close();
    } else {
      this.agenda.hide();
      this.sidebar.setMode('docs');
      this.ribbon.update();
      if (this.doc && !this.mobile) this.editor.commands.focus();
    }
    this.view.updateBreadcrumb();
    setWindowTitle(mode === 'agenda' ? 'Agenda — Folio' : `${this.doc?.meta.title || 'Sin título'} — Folio`);
  }

  startTour(kind: 'docs' | 'agenda' = 'docs') {
    this.tour ??= new Tour(this);
    return this.tour.start(kind);
  }

  /** Windows no deja que un programa se ancle solo a la barra de tareas: se explica una vez cómo hacerlo. */
  private showPinTip() {
    if (this.os !== 'windows' || this.settings.pinTipShown) return;
    this.settings.pinTipShown = true;
    this.persistSettings();
    toast('Para tener Folio siempre a mano, haz clic derecho en su icono de la barra de tareas y elige «Anclar a la barra de tareas».', { ms: 15000 });
  }

  // ---------- Documentos ----------

  async open(id: string, focus: 'editor' | 'title' = 'editor') {
    if (this.narrow.matches && this.sidebarFloating) this.showSidebar(false);
    if (this.doc?.meta.id === id) return;
    await this.flush();
    const token = ++this.loadToken;
    let doc: Doc;
    try {
      doc = await api.GetDoc(id);
    } catch (e) {
      toast(`No se pudo abrir el documento: ${e}`, { kind: 'error' });
      return;
    }
    if (token !== this.loadToken) return;
    this.doc = doc;
    clearFind(this.editor);
    this.findbar.close();
    loadContent(this.editor, doc.content);
    this.view.showDoc(doc);
    this.paginator.schedule(0);
    this.saveState = 'saved';
    this.lastSaved = new Date(doc.meta.updated);
    this.settings.lastDoc = id;
    this.persistSettings();
    this.sidebar.render();
    this.panels.refresh();
    this.status.update();
    this.ribbon.update();
    setWindowTitle(`${doc.meta.title || 'Sin título'} — Folio`);
    // focus() de TipTap se aplica en el siguiente frame; el título también debe esperar.
    if (focus === 'title') requestAnimationFrame(() => this.view.focusTitle());
    else if (!this.mobile) this.editor.commands.focus('start');
    this.view.scroller.scrollTop = 0;
    this.mobile?.docOpened();
  }

  async createFromJSON(title: string, icon: string, content: JSONContent, parentId = '', setup?: Partial<PageSetup>): Promise<Meta> {
    // Página predeterminada de Ajustes; si no hay, la del documento abierto sin su encabezado ni pie
    const def = this.settings.docSetup;
    const base = def ? { ...defaultSetup(), ...def } : this.doc ? { ...this.doc.setup, header: '', footer: '' } : defaultSetup();
    const fullSetup = setup || def ? { ...base, ...setup } as PageSetup : null;
    return api.CreateDoc({ parentId, title, icon, content: JSON.stringify(content), text: jsonToText(content), setup: fullSetup });
  }

  async newDoc(parentId = '', tpl?: Template) {
    await this.flush();
    const t = tpl ?? TEMPLATES[0];
    const m = await this.createFromJSON(tpl && tpl.id !== 'blank' ? t.title : '', tpl && tpl.id !== 'blank' ? t.icon : '', t.content(), parentId, t.setup ?? {});
    if (parentId) this.sidebar.expand(parentId);
    await this.refreshDocs();
    await this.open(m.id, t.id === 'blank' ? 'title' : 'editor');
  }

  /**
   * Vuelve a leer el documento abierto (porque otro dispositivo lo ha cambiado).
   * Si se está escribiendo en él no se toca: la siguiente sincronización resuelve
   * el conflicto y la versión que pierda queda en el historial.
   */
  async reloadCurrentDoc() {
    const cur = this.doc;
    if (!cur || this.saveState !== 'saved') return;
    const id = cur.meta.id;
    const gone = !this.docs.some((d) => d.id === id && !d.trashed);
    const scroll = this.view.scroller.scrollTop;
    this.doc = null;
    if (gone) {
      const next = this.docs.find((x) => !x.trashed);
      if (next) await this.open(next.id); else this.view.showEmpty();
      toast('El documento que tenías abierto se ha borrado en otro dispositivo.');
      return;
    }
    await this.open(id);
    this.view.scroller.scrollTop = scroll;
  }

  async refreshDocs() {
    this.docs = await api.ListDocs();
    this.sidebar.render();
  }

  patchLocalMeta(m: Meta) {
    const i = this.docs.findIndex((d) => d.id === m.id);
    if (i >= 0) this.docs[i] = m; else this.docs.push(m);
    if (this.doc?.meta.id === m.id) this.doc.meta = m;
  }

  async updateMeta(id: string, patch: Parameters<typeof api.UpdateMeta>[1]) {
    try {
      const m = await api.UpdateMeta(id, patch);
      this.patchLocalMeta(m);
      this.sidebar.render();
      if (this.doc?.meta.id === id) {
        setWindowTitle(`${m.title || 'Sin título'} — Folio`);
        this.view.updateBreadcrumb();
      }
      return m;
    } catch (e) {
      toast(String(e), { kind: 'error' });
      return null;
    }
  }

  async trash(id: string) {
    const d = this.docs.find((x) => x.id === id);
    await api.TrashDoc(id);
    await this.refreshDocs();
    toast(`«${d?.title || 'Sin título'}» se ha movido a la papelera`, { action: { label: 'Deshacer', run: async () => { await api.RestoreDoc(id); await this.refreshDocs(); } } });
    if (this.doc && (this.doc.meta.id === id || this.isDescendant(this.doc.meta.id, id))) {
      this.doc = null;
      const next = this.docs.find((x) => !x.trashed);
      if (next) await this.open(next.id); else this.view.showEmpty();
    }
  }

  /** Borra un documento sin pasar por la papelera (lo usa el tutorial con su práctica). */
  async deleteForever(id: string) {
    if (this.doc && (this.doc.meta.id === id || this.isDescendant(this.doc.meta.id, id))) {
      const next = this.docs.find((x) => !x.trashed && x.id !== id && !this.isDescendant(x.id, id));
      if (next) await this.open(next.id);
      else { await this.flush(); this.doc = null; this.view.showEmpty(); }
    }
    try { await api.DeleteDoc(id); } catch (e) { toast(`No se pudo borrar el documento: ${e}`, { kind: 'error' }); }
    await this.refreshDocs();
  }

  isDescendant(id: string, ancestor: string): boolean {
    let cur = this.docs.find((d) => d.id === id);
    while (cur?.parentId) {
      if (cur.parentId === ancestor) return true;
      cur = this.docs.find((d) => d.id === cur!.parentId);
    }
    return false;
  }

  async duplicate(id: string) {
    await this.flush();
    const m = await api.DuplicateDoc(id);
    await this.refreshDocs();
    await this.open(m.id);
    toast('Documento duplicado', { kind: 'ok' });
  }

  async setSetup(setup: PageSetup) {
    if (!this.doc) return;
    this.doc.setup = setup;
    await api.SetSetup(this.doc.meta.id, setup);
    this.view.applySetup();
  }

  // ---------- Guardado ----------

  private onEditorUpdate() {
    if (!this.doc) return;
    this.saveState = 'dirty';
    this.status.updateSave();
    this.scheduleSave();
    this.status.updateCounts();
    this.view.updateFootnotes();
    this.paginator.scheduleEdit();
    this.sync.noteChange();
    this.panels.onDocChange();
  }

  private scheduleSave = debounce(() => void this.save(), 600);

  async save(): Promise<void> {
    if (!this.doc || this.saveState === 'saved') return;
    if (this.saving) { this.saveQueued = true; return this.saving; }
    const id = this.doc.meta.id;
    const json = this.editor.getJSON();
    const text = this.editor.getText({ blockSeparator: '\n' });
    const words = this.editor.storage.characterCount.words();
    this.saveState = 'saving';
    this.status.updateSave();
    this.saving = (async () => {
      try {
        const r = await api.SaveDoc(id, JSON.stringify(json), text, words);
        if (this.doc?.meta.id === id) {
          this.doc.meta.updated = r.updated;
          this.doc.meta.words = words;
          if (this.saveState === 'saving') this.saveState = 'saved';
          this.lastSaved = new Date();
          if (r.versionCreated) this.panels.refreshVersions();
        }
        const m = this.docs.find((d) => d.id === id);
        if (m) { m.updated = r.updated; m.words = words; }
      } catch (e) {
        this.saveState = 'error';
        toast(`Error al guardar: ${e}`, { kind: 'error' });
      } finally {
        this.saving = null;
        this.status.updateSave();
      }
    })();
    await this.saving;
    if (this.saveQueued) {
      this.saveQueued = false;
      if ((this.saveState as string) === 'dirty') await this.save();
    }
  }

  async flush() {
    this.scheduleSave.cancel();
    this.view.commitTitle();
    if (this.saving) await this.saving;
    if (this.saveState === 'dirty' || this.saveState === 'error') await this.save();
  }

  /** Ctrl+G / Ctrl+S: guarda y deja un punto de restauración en el historial. */
  async saveCheckpoint() {
    if (!this.doc) return;
    if (this.saveState === 'saved') this.saveState = 'dirty';
    await this.flush();
    try {
      const vs = await api.ListVersions(this.doc.meta.id);
      const last = vs[0];
      const changed = !last || last.words !== this.doc.meta.words || Date.now() - Date.parse(last.created) > 60_000;
      if (changed) await api.CreateVersion(this.doc.meta.id, `Guardado manual`);
      this.panels.refreshVersions();
      toast('Guardado', { kind: 'ok', ms: 1400 });
    } catch (e) {
      toast(String(e), { kind: 'error' });
    }
  }

  // ---------- Ajustes y apariencia ----------

  persistSettings = debounce(() => void api.SaveSettings(this.settings), 400);

  applyTheme() {
    const t = this.settings.theme;
    const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    if (isAndroid) updateStatusBar(dark);
  }

  applyLayout() {
    const b = document.body.classList;
    b.toggle('sidebar-closed', !this.sidebarVisible);
    b.toggle('ribbon-hidden', !this.settings.ribbon);
    b.toggle('show-marks', this.settings.showMarks);
    b.toggle('page-view', this.settings.pageView);
    b.toggle('focus-mode', this.focusMode);
    b.toggle('student-view', this.studentView);
    document.documentElement.style.setProperty('--sidebar-w', `${this.settings.sidebarWidth}px`);
    this.view.applyZoom();
    this.paginator?.schedule(0);
  }

  /** En ventanas estrechas el panel flota y no cambia la preferencia guardada. */
  get sidebarVisible() { return this.narrow.matches ? this.sidebarFloating : this.settings.sidebarOpen; }

  showSidebar(show: boolean) {
    if (this.sidebarVisible === show) return;
    if (this.narrow.matches) { this.sidebarFloating = show; this.applyLayout(); } else this.setSetting('sidebarOpen', show);
  }

  /**
   * Zoom real de la hoja. Con «ajustar al ancho» (el predeterminado) la hoja se
   * reduce lo justo para caber en pantallas pequeñas y nunca pasa del 100 %.
   */
  get zoomLevel(): number {
    if (this.settings.zoomFit === false) return this.settings.zoom;
    if (!this.settings.pageView || !this.view) return 1;
    const pageW = this.view.pageWidthPx();
    const avail = this.view.scroller.clientWidth - 40;
    if (!pageW || avail <= 0) return 1;
    // En el móvil la hoja puede reducirse mucho más para caber en la pantalla
    return Math.max(document.body.classList.contains('is-mobile') ? 0.3 : 0.5, Math.min(1, Math.floor((avail / pageW) * 100) / 100));
  }

  toggleStudentView() {
    this.studentView = !this.studentView;
    this.applyLayout();
    this.ribbon.update();
  }

  /**
   * Cortes de página para exportar. Se calculan en la vista de página, sin las
   * soluciones si es la versión del alumnado y sin el título si no se exporta;
   * después se restaura la vista (y el desplazamiento).
   */
  async layoutFor(o: ExportOptions): Promise<LayoutSnapshot> {
    const student = o.studentVersion;
    const noTitle = !o.includeTitle || !this.doc?.meta.title;
    const prev = { pageView: this.settings.pageView, student: this.studentView, scroll: this.view.scroller.scrollTop };
    const change = !prev.pageView || prev.student !== student || noTitle;
    if (change) {
      this.settings.pageView = true;
      this.studentView = student;
      document.body.classList.toggle('layout-no-title', noTitle);
      this.applyLayout();
    }
    const snap = await this.paginator.settle();
    if (change) {
      this.settings.pageView = prev.pageView;
      this.studentView = prev.student;
      document.body.classList.remove('layout-no-title');
      this.applyLayout();
      // Las hojas se redibujan en el siguiente cálculo; hasta entonces el alto cambia.
      void this.paginator.settle().then(() => { this.view.scroller.scrollTop = prev.scroll; });
    }
    return snap;
  }

  setSetting<K extends keyof Settings>(k: K, v: Settings[K]) {
    this.settings[k] = v;
    this.persistSettings();
    if (k === 'theme') this.applyTheme();
    this.applyLayout();
    this.status.update();
    if (k === 'spellcheck') this.editor.view.dom.setAttribute('spellcheck', String(v));
    if (k === 'ribbon') this.ribbon.update();
  }

  get keymap(): KeymapId { return this.settings.keymap === 'en' ? 'en' : 'es'; }

  // ---------- Atajos y acciones ----------

  private bindGlobalEvents() {
    window.addEventListener('keydown', (e) => this.onKeyDown(e), true);
    window.addEventListener('wheel', (e) => {
      if (e.ctrlKey && this.view.scroller.contains(e.target as Node)) {
        e.preventDefault();
        this.zoom(e.deltaY < 0 ? 0.1 : -0.1);
      }
    }, { passive: false });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
    window.addEventListener('beforeunload', () => { void this.flush(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) void this.flush(); });
    onEvent('app:before-close', async () => {
      try { await this.flush(); await this.sync.runBeforeClose(); } finally { await api.ConfirmClose(); }
    });
    on('editor:scroll-to', (pos: number) => this.scrollToPos(pos));
    on('layout:changed', () => this.paginator.schedule());
    // Pincel de formato: aplica al soltar el ratón tras seleccionar
    this.editor.view.dom.addEventListener('mouseup', () => {
      if (this.painterOnce && this.formatClipboard && !this.editor.state.selection.empty) {
        this.applyFormat();
        this.painterOnce = false;
        document.body.classList.remove('painter');
        this.ribbon.update();
      }
    });
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.isComposing) return;
    const inEditor = this.editor.view.dom.contains(e.target as Node);
    const inField = !inEditor && (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || (e.target as HTMLElement)?.isContentEditable);
    if (hasOpenModal() || document.querySelector('.backstage')) return;
    if (e.key === 'Escape') {
      if (this.focusMode) { this.toggleFocus(); e.preventDefault(); return; }
      if (this.painterOnce) { this.painterOnce = false; document.body.classList.remove('painter'); return; }
    }
    const sc = findShortcut(e, this.keymap);
    // En la agenda solo valen los atajos generales; el resto los gestiona la agenda
    if (this.mode === 'agenda') {
      if (sc && ['modeDocs', 'modeAgenda', 'palette', 'help', 'sidebar', 'new', 'open'].includes(sc.action)) {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        if (sc.action === 'new' || sc.action === 'open') void this.setMode('docs').then(() => this.run(sc.action));
        else this.run(sc.action);
      }
      return;
    }
    if (sc && (sc.scope === 'app' || (inEditor || (!inField && this.doc)))) {
      // En campos de texto dejamos que funcionen deshacer/seleccionar todo nativos
      if (inField && sc.scope === 'editor') return;
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      this.run(sc.action);
      return;
    }
    if (inEditor && !isNativeEditingCombo(e)) {
      // Cualquier otra combinación con Ctrl/Alt se bloquea para que el editor
      // no aplique atajos ajenos a Word.
      e.preventDefault();
      e.stopPropagation();
    }
  }

  run(action: string) {
    const ed = this.editor;
    const chain = () => ed.chain().focus();
    if (action === 'modeDocs') return void this.setMode('docs');
    if (action === 'modeAgenda') return void this.setMode('agenda');
    const needsDoc = !['new', 'open', 'palette', 'help', 'sidebar', 'ribbon', 'focus', 'zoomIn', 'zoomOut', 'zoomReset', 'showMarks'].includes(action);
    if (needsDoc && !this.doc) return;
    switch (action) {
      // Archivo
      case 'new': return openBackstage(this, 'new');
      case 'open': return openBackstage(this, 'open');
      case 'save': return void this.saveCheckpoint();
      case 'saveVersion': return void this.namedVersion();
      case 'print': return openBackstage(this, 'print');
      case 'export': return openBackstage(this, 'export');
      case 'versions': return this.panels.toggle('versions');
      // Edición
      case 'undo': return void chain().undo().run();
      case 'redo': return void chain().redo().run();
      case 'selectAll': return void chain().selectAll().run();
      case 'find': return this.findbar.open(false);
      case 'replace': return this.findbar.open(true);
      case 'goto': return this.palette.open('headings');
      case 'copyFormat': return this.copyFormat();
      case 'pasteFormat': return this.formatClipboard ? this.applyFormat() : void 0;
      case 'moveUp': return void moveBlock(ed, -1);
      case 'moveDown': return void moveBlock(ed, 1);
      // Fuente
      case 'bold': return void chain().toggleBold().run();
      case 'italic': return void chain().toggleItalic().run();
      case 'underline': return void chain().toggleUnderline().run();
      case 'strike': return void chain().toggleStrike().run();
      case 'subscript': return void chain().unsetSuperscript().toggleSubscript().run();
      case 'superscript': return void chain().unsetSubscript().toggleSuperscript().run();
      case 'growFont': return this.stepFont(1);
      case 'shrinkFont': return this.stepFont(-1);
      case 'font': return this.ribbon.focusFont();
      case 'fontSize': return this.ribbon.focusSize();
      case 'highlight': return void chain().toggleHighlight({ color: '#fff3a3' }).run();
      case 'clearMarks': return void chain().unsetMark('bold').unsetMark('italic').unsetMark('underline').unsetMark('strike')
        .unsetMark('subscript').unsetMark('superscript').unsetMark('highlight').unsetMark('code').unsetMark('textStyle').run();
      case 'upper': return void changeCase(ed, 'upper');
      case 'changeCase': return void changeCase(ed);
      case 'link': return void dialogs.linkDialog(this);
      // Párrafo
      case 'alignLeft': return void chain().setTextAlign('left').run();
      case 'alignCenter': return void chain().setTextAlign('center').run();
      case 'alignRight': return void chain().setTextAlign('right').run();
      case 'alignJustify': return void chain().setTextAlign('justify').run();
      case 'indent': return void chain().indent().run();
      case 'outdent': return void chain().outdent().run();
      case 'line1': return void chain().setLineHeight(1).run();
      case 'line15': return void chain().setLineHeight(1.5).run();
      case 'line2': return void chain().setLineHeight(2).run();
      case 'resetParagraph': return void chain().resetParagraph().run();
      case 'showMarks': return this.setSetting('showMarks', !this.settings.showMarks);
      // Estilos
      case 'normal': return void chain().setParagraph().run();
      case 'h1': return void chain().toggleHeading({ level: 1 }).run();
      case 'h2': return void chain().toggleHeading({ level: 2 }).run();
      case 'h3': return void chain().toggleHeading({ level: 3 }).run();
      case 'bulletList': return void chain().toggleBulletList().run();
      case 'orderedList': return void chain().toggleOrderedList().run();
      case 'styles': return this.ribbon.focusStyle();
      // Insertar
      case 'pageBreak': return void chain().setPageBreak().run();
      case 'footnote': return void dialogs.footnoteDialog(this);
      case 'comment': return void dialogs.commentDialog(this);
      case 'equation': return void dialogs.mathInlineDialog(this);
      case 'date': return void chain().insertContent(new Date().toLocaleDateString('es-ES')).run();
      case 'time': return void chain().insertContent(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })).run();
      case 'nbsp': return void chain().insertContent(' ').run();
      // Vista
      case 'ribbon': return this.setSetting('ribbon', !this.settings.ribbon);
      case 'sidebar': return this.showSidebar(!this.sidebarVisible);
      case 'focus': return this.toggleFocus();
      case 'zoomIn': return this.zoom(0.1);
      case 'zoomOut': return this.zoom(-0.1);
      case 'zoomReset': return this.zoomToFit();
      case 'wordCount': return void dialogs.wordCountDialog(this);
      case 'palette': return this.palette.open('commands');
      case 'help': return void dialogs.shortcutsDialog(this);
    }
  }

  toggleFocus() {
    this.focusMode = !this.focusMode;
    this.applyLayout();
    if (this.focusMode) toast('Modo concentración · Esc para salir', { ms: 1800 });
  }

  /** Cambia el zoom a mano (deja de ajustarse al ancho). */
  zoom(delta: number, abs?: number) {
    const z = Math.round(Math.max(0.5, Math.min(2.5, abs ?? this.zoomLevel + delta)) * 100) / 100;
    this.settings.zoomFit = false;
    this.setSetting('zoom', z);
  }

  zoomToFit() {
    this.settings.zoom = 1;
    this.setSetting('zoomFit', true);
  }

  currentFontSize(): number {
    const fs = this.editor.getAttributes('textStyle').fontSize as string | undefined;
    if (fs) return parseFloat(fs);
    if (this.editor.isActive('heading')) {
      const lvl = this.editor.getAttributes('heading').level as number;
      return Math.round((this.doc?.setup.fontSize ?? 11) * ({ 1: 1.75, 2: 1.4, 3: 1.18, 4: 1.05 } as Record<number, number>)[lvl]);
    }
    return this.doc?.setup.fontSize ?? 11;
  }

  stepFont(dir: 1 | -1) {
    const cur = this.currentFontSize();
    const next = dir > 0 ? FONT_SIZES.find((s) => s > cur) ?? cur + 10 : [...FONT_SIZES].reverse().find((s) => s < cur) ?? Math.max(1, cur - 1);
    this.editor.chain().focus().setFontSize(`${next}pt`).run();
  }

  copyFormat() {
    const { state } = this.editor;
    const { $from, from, to } = state.selection;
    let marks = $from.marks();
    if (from !== to) {
      state.doc.nodesBetween(from, to, (n) => {
        if (n.isText) { marks = n.marks; return false; }
        return true;
      });
    }
    const parent = $from.parent;
    this.formatClipboard = {
      marks: marks.filter((m) => m.type.name !== 'comment' && m.type.name !== 'link').map((m) => m.toJSON()),
      block: { textAlign: parent.attrs.textAlign, lineHeight: parent.attrs.lineHeight, indent: parent.attrs.indent },
    };
    this.painterOnce = true;
    document.body.classList.add('painter');
    this.ribbon.update();
    toast('Formato copiado. Selecciona texto para aplicarlo (o pulsa el atajo de pegar formato).', { ms: 2200 });
  }

  applyFormat() {
    const fc = this.formatClipboard;
    if (!fc) return;
    const { state } = this.editor;
    const { from, to } = state.selection;
    const tr = state.tr;
    const keep = new Set(['comment', 'link']);
    for (const name of Object.keys(state.schema.marks)) {
      if (!keep.has(name)) tr.removeMark(from, to, state.schema.marks[name]);
    }
    for (const m of fc.marks) tr.addMark(from, to, state.schema.markFromJSON(m));
    state.doc.nodesBetween(from, to, (n, pos) => {
      if (n.type.name === 'paragraph' || n.type.name === 'heading') {
        tr.setNodeMarkup(pos, undefined, { ...n.attrs, ...fc.block });
        return false;
      }
      return true;
    });
    this.editor.view.dispatch(tr);
  }

  async namedVersion() {
    if (!this.doc) return;
    await this.flush();
    const label = await promptText('Guardar versión', 'Nombre de la versión (por ejemplo «Primer borrador»)', '', { ok: 'Guardar versión' });
    if (label === null) return;
    await api.CreateVersion(this.doc.meta.id, label.trim() || 'Versión guardada');
    this.panels.refreshVersions();
    toast('Versión guardada en el historial', { kind: 'ok' });
  }

  async restoreVersion(vid: string) {
    if (!this.doc) return;
    const ok = await confirmDialog('Restaurar versión', 'El documento se sustituirá por esta versión. El estado actual queda guardado en el historial.', 'Restaurar');
    if (!ok) return;
    await this.flush();
    const d = await api.RestoreVersion(this.doc.meta.id, vid);
    this.doc = null;
    this.patchLocalMeta(d.meta);
    await this.open(d.meta.id);
    this.panels.refreshVersions();
    toast('Versión restaurada', { kind: 'ok' });
  }

  scrollToPos(pos: number) {
    try {
      const dom = this.editor.view.nodeDOM(pos) as HTMLElement | null;
      this.editor.chain().setTextSelection(pos + 1).focus().run();
      dom?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch { /* posición ya no existe */ }
  }

  private onSelection = (() => {
    let raf = 0;
    return () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        this.ribbon.update();
        this.view.updateQuick();
        this.panels.onSelection();
      });
    };
  })();

  /** Lleva el cursor al principio del documento de forma síncrona (sin esperar un frame). */
  focusEditorStart() {
    const ed = this.editor;
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.atStart(ed.state.doc)));
    ed.view.focus();
  }

  selectedImage() {
    const sel = this.editor.state.selection;
    return sel instanceof NodeSelection && sel.node.type.name === 'image' ? sel.node : null;
  }

  get native() { return isNative; }
}

export function defaultSetup(): PageSetup {
  return {
    paper: 'A4', orientation: 'portrait', marginTop: 25, marginBottom: 25, marginLeft: 25, marginRight: 25,
    header: '', footer: '', pageNumbers: true, fontFamily: 'Inter', fontSize: 11, lineHeight: 1.5,
  };
}
