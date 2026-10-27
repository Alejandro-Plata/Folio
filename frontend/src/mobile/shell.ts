// Estructura de la interfaz móvil: barra superior, navegación inferior (Documentos,
// Agenda, Buscar, Más), botón flotante y las pantallas. Reutiliza el editor y la
// agenda del escritorio: solo cambia lo que los rodea (ver mobile.css).
import type { App } from '../app';
import { goBack, initBack, pushBack } from '../platform/back';
import { actionSheet } from './sheet';
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import * as dialogs from '../ui/dialogs';
import { openBackstage } from '../ui/backstage';
import { DocList } from './doclist';
import { FormatBar } from './formatbar';
import { MoreScreen } from './more';
import { SearchScreen } from './search';

export type Screen = 'docs' | 'editor' | 'agenda' | 'search' | 'more';

const NAV: [Screen, string, string][] = [['docs', 'file', 'Documentos'], ['agenda', 'calendar', 'Agenda'], ['search', 'search', 'Buscar'], ['more', 'more', 'Más']];

export class MobileShell {
  screen: Screen = 'docs';
  docList: DocList;
  private searchScreen: SearchScreen;
  private moreScreen: MoreScreen;
  private format: FormatBar;
  private appbar = h('header', { class: 'm-appbar' });
  private nav = h('nav', { class: 'm-nav', 'aria-label': 'Secciones' });
  private fab = h('button', { type: 'button', class: 'm-fab', hidden: true });
  private navBtns = new Map<Screen, HTMLButtonElement>();
  private removeEditorBack: (() => void) | null = null;

  constructor(private app: App) {
    const main = document.querySelector('.main') as HTMLElement;
    this.docList = new DocList(app, this);
    this.searchScreen = new SearchScreen(app, this);
    this.moreScreen = new MoreScreen(app, this);
    this.format = new FormatBar(app);

    for (const [id, ic, label] of NAV) {
      const b = h('button', { type: 'button', class: 'm-nav-btn', 'aria-label': label, onclick: () => void this.go(id) },
        h('span', { html: icon(ic, 22), 'aria-hidden': 'true' }), h('span', { class: 'm-nav-label' }, label));
      this.navBtns.set(id, b);
      this.nav.append(b);
    }
    main.prepend(this.appbar);
    document.getElementById('ribbon')!.after(this.docList.el, this.searchScreen.el, this.moreScreen.el);
    main.append(this.format.el, this.nav, this.fab);
    // Agenda: un toque abre la barra rápida; mantener pulsado dicta
    let hold: ReturnType<typeof setTimeout> | undefined;
    let held = false;
    this.fab.addEventListener('pointerdown', () => {
      held = false;
      if (this.screen !== 'agenda') return;
      hold = setTimeout(() => { held = true; navigator.vibrate?.(20); app.agenda.quick.startHold(); }, 450);
    });
    const release = () => { clearTimeout(hold); if (held) app.agenda.quick.endHold(); };
    this.fab.addEventListener('pointerup', release);
    this.fab.addEventListener('pointercancel', release);
    this.fab.addEventListener('click', () => { if (held) { held = false; return; } this.fabAction(); });

    // Primera vez en el móvil: lectura (cabe en la pantalla) en vez de hojas
    try {
      if (!localStorage.getItem('folio-mobile-init')) {
        localStorage.setItem('folio-mobile-init', '1');
        app.setSetting('pageView', false);
      }
    } catch { /* */ }

    initBack(() => app.flush());
    this.watchPanels();
    this.watchEditorFocus();
    void this.go(app.mode === 'agenda' ? 'agenda' : 'docs', true);
    this.docList.render();
  }

  // ---------- Navegación ----------

  async go(screen: Screen, initial = false) {
    const app = this.app;
    if (screen !== 'editor' && this.screen === 'editor') { await app.flush(); this.removeEditorBack?.(); this.removeEditorBack = null; }
    if (screen === 'agenda') await app.setMode('agenda');
    else if (app.mode === 'agenda') await app.setMode('docs');
    this.screen = screen;
    document.body.dataset.m = screen;
    document.body.classList.toggle('m-editing', screen === 'editor');
    if (screen === 'editor') requestAnimationFrame(() => this.app.view.autosize()); // el título se midió oculto
    if (screen === 'docs' && !initial) this.docList.reset();
    if (screen === 'search') { this.searchScreen.reset(); this.searchScreen.focus(); }
    if (screen === 'more') this.moreScreen.render();
    this.navBtns.forEach((b, id) => {
      const on = id === screen || (screen === 'editor' && id === 'docs');
      b.classList.toggle('on', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    this.renderBar();
  }

  /** Abre un documento en el editor. */
  async openDoc(id: string) {
    await this.app.open(id);
    this.afterOpen();
  }

  /** Pasa al editor cuando se ha abierto (o creado) un documento. */
  afterOpen() {
    if (this.screen === 'editor') { this.renderBar(); return; }
    // «Atrás» desde el editor vuelve a la lista
    this.removeEditorBack = pushBack(() => void this.go('docs'));
    void this.go('editor');
    this.app.view.scroller.scrollTop = 0;
  }

  /** Lo llama la app cuando se abre un documento por cualquier camino (buscador, plantillas…). */
  docOpened() { if (this.screen !== 'editor' && this.app.mode === 'docs') this.afterOpen(); else this.renderBar(); }

  // ---------- Barra superior y botón flotante ----------

  renderBar() {
    const app = this.app;
    const s = this.screen;
    const back = (label = 'Atrás') => h('button', { type: 'button', class: 'icon-btn m-back', title: label, 'aria-label': label, html: icon('arrowLeft', 22), onclick: () => { if (!goBack()) void this.go('docs'); } });
    const btn = (ic: string, label: string, run: () => void, disabled = false) =>
      h('button', { type: 'button', class: 'icon-btn', title: label, 'aria-label': label, html: icon(ic, 22), disabled, onclick: run, onmousedown: (e: MouseEvent) => e.preventDefault() });
    const items: (HTMLElement | null)[] = [];
    let title = '';
    if (s === 'docs') {
      title = this.docList.title;
      if (this.docList.path.length) items.push(back());
    } else if (s === 'editor') {
      title = app.doc?.meta.title || 'Sin título';
      items.push(back('Volver a los documentos'));
    } else if (s === 'more') title = 'Más';
    const t = h('h1', { class: 'm-title', onclick: () => { if (s === 'editor') { app.view.scroller.scrollTop = 0; app.view.focusTitle(); } } }, title);
    const actions = h('div', { class: 'm-bar-actions' });
    if (s === 'editor') {
      actions.append(
        btn('undo', 'Deshacer', () => app.run('undo')),
        btn('more', 'Más acciones', () => this.editorMenu()));
    } else if (s === 'docs') {
      actions.append(btn('trash', 'Papelera', () => void app.sidebar.trashDialog()));
    }
    this.appbar.replaceChildren(...items.filter((x): x is HTMLElement => !!x), t, actions);

    // Botón flotante
    const fab = s === 'docs' ? { label: 'Nuevo documento', ic: 'plus' } : s === 'agenda' ? { label: 'Nueva tarea', ic: 'plus' } : null;
    this.fab.hidden = !fab;
    if (fab) {
      this.fab.innerHTML = icon(fab.ic, 26);
      this.fab.title = fab.label;
      this.fab.setAttribute('aria-label', fab.label);
    }
  }

  private fabAction() {
    if (this.screen === 'docs') this.docList.newDocSheet();
    else if (this.screen === 'agenda') this.app.agenda.quick.openMobile();
  }

  private editorMenu() {
    const app = this.app;
    actionSheet(app.doc?.meta.title || 'Documento', [
      { label: 'Exportar…', icon: 'share', run: () => openBackstage(app, 'export') },
      { label: 'Imprimir', icon: 'print', run: () => openBackstage(app, 'print') },
      { label: 'Buscar y reemplazar', icon: 'search', run: () => app.run('find') },
      { label: 'Esquema', icon: 'outline', run: () => app.panels.show('outline') },
      { label: 'Comentarios', icon: 'comment', run: () => app.panels.show('comments') },
      { label: 'Historial de versiones', icon: 'history', run: () => app.panels.show('versions') },
      { label: 'Configurar página', icon: 'pageSetup', run: () => void dialogs.pageSetupDialog(app) },
      { label: app.settings.pageView ? 'Ver como lectura' : 'Ver como hojas', icon: app.settings.pageView ? 'alignJustify' : 'page', run: () => app.setSetting('pageView', !app.settings.pageView) },
      { label: app.studentView ? 'Salir de la vista del alumnado' : 'Vista del alumnado', icon: 'users', run: () => app.toggleStudentView() },
      { label: 'Contar palabras', icon: 'hash', run: () => void dialogs.wordCountDialog(app) },
    ]);
  }

  // ---------- Detalles ----------

  /** Los paneles (esquema, comentarios, versiones) ocupan toda la pantalla y «atrás» los cierra. */
  private watchPanels() {
    let off: (() => void) | null = null;
    new MutationObserver(() => {
      const open = document.body.classList.contains('panel-open');
      if (open && !off) off = pushBack(() => this.app.panels.close());
      else if (!open && off) { off(); off = null; }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  /** La barra de formato solo se ve mientras se escribe. */
  private watchEditorFocus() {
    const dom = this.app.editor.view.dom;
    dom.addEventListener('focusin', () => document.body.classList.add('m-typing'));
    dom.addEventListener('focusout', () => {
      setTimeout(() => {
        if (!dom.contains(document.activeElement) && !this.format.el.contains(document.activeElement)) document.body.classList.remove('m-typing');
      }, 120);
    });
  }
}
