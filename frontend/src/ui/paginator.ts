// Orquesta la paginación del editor: mide, decide los cortes y dibuja las
// hojas (huecos entre páginas, notas al pie, relleno de la última hoja).
import type { App } from '../app';
import {
  computePagination, footerText, getPagination, paginationKey, SHEET_GAP,
  type PageBreak, type PageChrome, type PaginationResult,
} from '../editor/pagination';
import { expandPlaceholders, pageSizeMM } from '../io';

const MM = 96 / 25.4;

export interface LayoutSnapshot {
  breaks: PageBreak[];
  footnoteBreaks: number[];
  pages: number;
}

export class Paginator {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private raf = 0;
  private footnoteSpacers = new Map<number, number>();
  private idle: ReturnType<typeof setTimeout> | undefined;
  private lastRun = 0;
  /** Bloque editado y su altura en la última comprobación. */
  private lastBlock: { el: Element; h: number; count: number } | null = null;
  last: PaginationResult | null = null;

  constructor(private app: App) {
    document.fonts?.ready.then(() => this.schedule());
    document.fonts?.addEventListener?.('loadingdone', () => this.schedule());
  }

  get pages() { return this.last?.pages ?? 1; }

  /** Recalcula en el siguiente frame: una pasada cuesta poco y así el texto no invade el pie al escribir. */
  schedule(delay = 0) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => this.run());
    }, delay);
  }

  /**
   * Tras escribir: si el bloque editado mide lo mismo y no han cambiado los
   * bloques, los cortes no se mueven y no hace falta medir el documento entero
   * (es lo que hace pesado escribir en documentos largos). Al dejar de escribir
   * se hace igualmente una pasada completa, por si acaso.
   */
  scheduleEdit() {
    if (!this.app.settings.pageView) return;
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.schedule(0), 800);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      const ed = this.app.editor;
      const root = ed.view.dom;
      const $head = ed.state.selection.$head;
      const el = $head.depth > 0 ? ed.view.nodeDOM($head.before(1)) as Element | null : null;
      const block = el instanceof Element ? { el, h: (el as HTMLElement).offsetHeight, count: root.childElementCount } : null;
      const prev = this.lastBlock;
      this.lastBlock = block;
      if (block && prev && prev.el === block.el && prev.h === block.h && prev.count === block.count) return;
      // Como mucho una pasada cada 200 ms mientras se escribe (en un párrafo
      // partido entre dos hojas, casi cada palabra mueve el corte).
      const wait = this.lastRun + 200 - performance.now();
      if (wait <= 0) this.run();
      else { clearTimeout(this.timer); this.timer = setTimeout(() => this.schedule(0), wait); }
    });
  }

  private chrome(): PageChrome | null {
    const d = this.app.doc;
    if (!d) return null;
    const s = d.setup;
    return {
      header: expandPlaceholders(s.header || '', d.meta.title, this.app.settings.authorName),
      footer: expandPlaceholders(s.footer || '', d.meta.title, this.app.settings.authorName),
      pageNumbers: s.pageNumbers, marginTop: s.marginTop * MM, marginBottom: s.marginBottom * MM, gap: SHEET_GAP,
    };
  }

  /** Mide y aplica. Devuelve true si ha cambiado algo. */
  run(): boolean {
    this.lastRun = performance.now();
    const app = this.app;
    const ed = app.editor;
    const view = app.view;
    if (!app.doc || !app.settings.pageView) {
      this.clear();
      return false;
    }
    const chrome = this.chrome()!;
    const [, hmm] = pageSizeMM(app.doc.setup);
    const geo = { pageH: hmm * MM, marginTop: chrome.marginTop, marginBottom: chrome.marginBottom };
    const res = computePagination(ed, view.page, geo, view.footnoteBlocks(), this.footnoteSpacers, view.pageEnd());
    this.last = res;

    // Notas al pie y relleno final (fuera de ProseMirror: DOM directo)
    this.footnoteSpacers = new Map(res.footnoteBreaks.map((f) => [f.index, f.height]));
    view.applyFootnoteBreaks(res.footnoteBreaks, chrome, res.pages);
    view.applyFiller(res.filler, footerText(chrome, res.lastPage, res.pages), chrome);
    view.applyFirstHeader(chrome);

    const st = getPagination(ed);
    const sig = (b: PageBreak[], p: number, c: PageChrome | null) =>
      JSON.stringify([b.map((x) => [x.pos, x.kind, Math.round(x.height * 2) / 2, x.page]), p, c]);
    const changed = sig(st.breaks, st.pages, st.chrome) !== sig(res.breaks, res.pages, chrome);
    if (changed) {
      ed.view.dispatch(ed.state.tr.setMeta(paginationKey, { breaks: res.breaks, pages: res.pages, chrome }).setMeta('addToHistory', false));
      // Una segunda pasada confirma que los cortes son estables.
      this.schedule(0);
    }
    app.status.updatePage();
    return changed;
  }

  private clear() {
    const ed = this.app.editor;
    this.last = null;
    this.footnoteSpacers.clear();
    this.app.view.applyFootnoteBreaks([], null, 1);
    this.app.view.applyFiller(0, '', null);
    if (getPagination(ed).breaks.length || getPagination(ed).chrome) {
      ed.view.dispatch(ed.state.tr.setMeta(paginationKey, { breaks: [], pages: 1, chrome: null }).setMeta('addToHistory', false));
    }
  }

  /** Recalcula de inmediato hasta que los cortes se estabilizan (para exportar). */
  async settle(): Promise<LayoutSnapshot> {
    clearTimeout(this.timer);
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      if (!this.run()) break;
    }
    const st = getPagination(this.app.editor);
    return { breaks: st.breaks, footnoteBreaks: this.last?.footnoteBreaks.map((f) => f.index) ?? [], pages: st.pages };
  }
}
