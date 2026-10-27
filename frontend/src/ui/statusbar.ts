import type { App } from '../app';
import { h, relTime, debounce } from './dom';
import { icon } from './icons';
import { relativeTimeText } from '../sync/manager';
import * as dialogs from './dialogs';
import { pageSizeMM } from '../io';
import { SHEET_GAP } from '../editor/pagination';

export class StatusBar {
  private el = document.getElementById('statusbar')!;
  private page = h('button', { class: 'sb-stat', title: 'Ir a un título (Ctrl+I)' });
  private words = h('button', { class: 'sb-stat', title: 'Contar palabras (Ctrl+Mayús+G)' });
  private save = h('span', { class: 'sb-stat save-state' });
  private syncBtn = h('button', { class: 'sb-stat sb-sync', hidden: true });
  private keymap = h('button', { class: 'sb-stat', title: 'Mapa de atajos de teclado' });
  private zoomLabel = h('button', { class: 'sb-stat zoom-label', title: 'Ajustar al ancho (Ctrl+Alt+0)' });
  private zoomRange = h('input', { type: 'range', min: '50', max: '250', step: '10', class: 'zoom-range', 'aria-label': 'Zoom' });
  private viewPage = h('button', { class: 'sb-icon', title: 'Vista de página', html: icon('page', 14) });
  /** Páginas del documento según la última medición. */
  totalPages = 1;
  private viewWeb = h('button', { class: 'sb-icon', title: 'Vista de lectura (ancho completo)', html: icon('alignJustify', 14) });

  constructor(private app: App) {
    this.page.onclick = () => app.run('goto');
    this.words.onclick = () => void dialogs.wordCountDialog(app);
    this.syncBtn.onclick = () => void import('../sync/syncsettings').then((m) => m.syncDialog(app));
    this.keymap.onclick = () => {
      app.setSetting('keymap', app.keymap === 'es' ? 'en' : 'es');
      app.ribbon.rebuild();
      app.sidebar.rebuild();
    };
    this.zoomLabel.onclick = () => app.zoomToFit();
    this.zoomRange.addEventListener('input', () => app.zoom(0, Number(this.zoomRange.value) / 100));
    this.viewPage.onclick = () => app.setSetting('pageView', true);
    this.viewWeb.onclick = () => app.setSetting('pageView', false);
    this.el.append(
      this.page, this.words, this.save,
      h('div', { class: 'spacer' }),
      this.syncBtn,
      h('span', { class: 'sb-stat muted sb-lang' }, 'Español (España)'),
      this.keymap,
      this.viewPage, this.viewWeb,
      h('button', { class: 'sb-icon', title: 'Alejar (Ctrl+Alt+-)', onclick: () => app.zoom(-0.1) }, '−'),
      this.zoomRange,
      h('button', { class: 'sb-icon', title: 'Acercar (Ctrl+Alt+=)', onclick: () => app.zoom(0.1) }, '+'),
      this.zoomLabel,
    );
    setInterval(() => this.updateSave(), 20_000);
  }

  /** Indicador de la nube: solo se ve si hay una vinculada. */
  updateSync() {
    const m = this.app.sync;
    const btn = this.syncBtn;
    btn.hidden = !m?.linked;
    if (!m?.linked) return;
    const states = {
      idle: ['cloudCheck', 'Sincronizado', ''], syncing: ['refresh', m.progress ? `Sincronizando ${m.progress}` : 'Sincronizando…', 'is-syncing'],
      error: ['alert', 'Error de sincronización', 'is-error'], off: ['cloudOff', 'Sin nube', ''],
    } as const;
    const [ic, text, cls] = states[m.state];
    btn.className = `sb-stat sb-sync ${cls}`;
    btn.innerHTML = `${icon(ic, 14)}<span>${text}</span>`;
    btn.title = m.lastError || `Última sincronización: ${relativeTimeText(m.lastSync)}. Clic para abrir la sincronización.`;
    btn.setAttribute('aria-label', `${text}. ${btn.title}`);
  }

  update() {
    this.updateCounts();
    this.updateSave();
    this.updatePage();
    this.keymap.textContent = this.app.keymap === 'es' ? 'Atajos: Word ES' : 'Atajos: Word EN';
    const z = Math.round(this.app.zoomLevel * 100);
    this.zoomLabel.textContent = `${z} %`;
    this.zoomRange.value = String(z);
    this.viewPage.classList.toggle('on', this.app.settings.pageView);
    this.viewWeb.classList.toggle('on', !this.app.settings.pageView);
  }

  updateCounts = debounce(() => {
    const cc = this.app.editor.storage.characterCount;
    const w = cc.words();
    const mins = Math.max(1, Math.round(w / 200));
    this.words.textContent = `${w.toLocaleString('es-ES')} palabras · ${mins} min de lectura`;
  }, 400);

  /** Página actual (según el desplazamiento) y total de páginas calculado por la paginación. */
  updatePage() {
    const app = this.app;
    const view = app.view;
    if (!app.doc || !view) { this.page.textContent = ''; return; }
    if (!app.settings.pageView) { this.page.textContent = 'Vista de lectura'; return; }
    const total = app.paginator?.pages ?? 1;
    this.totalPages = total;
    const [, hmm] = pageSizeMM(app.doc.setup);
    const pitch = hmm * (96 / 25.4) + SHEET_GAP;
    const pr = view.page.getBoundingClientRect();
    const scale = pr.width / (view.page.offsetWidth || pr.width) || 1;
    const sc = view.scroller.getBoundingClientRect();
    const y = (sc.top + sc.height / 3 - pr.top) / scale;
    const cur = Math.min(total, Math.max(1, Math.floor(y / pitch) + 1));
    this.page.textContent = `Página ${cur} de ${total}`;
  }

  updateSave() {
    const s = this.app.saveState;
    const last = this.app.lastSaved;
    this.save.className = `sb-stat save-state ${s}`;
    this.save.textContent = s === 'saving' ? 'Guardando…' : s === 'dirty' ? 'Cambios sin guardar' : s === 'error' ? 'Error al guardar' : last ? `Guardado ${relTime(last.toISOString())}` : 'Guardado';
  }
}
