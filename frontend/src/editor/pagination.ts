// Paginación real en el editor. Calcula dónde acaba cada página igual que el
// motor de impresión y dibuja hojas separadas con encabezado, pie y número de
// página. Los mismos cortes se usan después al exportar (PDF, impresión, HTML)
// como saltos de página explícitos, de modo que cada página del editor
// contiene exactamente lo mismo que la página del PDF.
//
// Funcionamiento: los cortes se dibujan con widgets (huecos con la altura
// necesaria para empujar el contenido a la hoja siguiente). Para decidir se
// mide el documento en coordenadas «naturales», restando la altura de los
// huecos ya dibujados; como el contenido no usa margin-top (ver content-css),
// las posiciones naturales no dependen de los cortes y el cálculo converge
// en una pasada.
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export type BreakKind = 'block' | 'row' | 'inline';

export interface PageBreak {
  pos: number;
  kind: BreakKind;
  height: number; // px de maquetación (sin zoom)
  page: number; // página (desde 0) que termina en este corte
}

export interface PageChrome {
  header: string;
  footer: string;
  pageNumbers: boolean;
  marginTop: number; // px
  marginBottom: number; // px
  gap: number; // separación visual entre hojas, px
}

interface PState {
  breaks: PageBreak[];
  pages: number;
  chrome: PageChrome | null;
  deco: DecorationSet;
}

export const paginationKey = new PluginKey<PState>('pagination');

export const SHEET_GAP = 28;

export function footerText(c: PageChrome, page: number, pages: number) {
  const num = c.pageNumbers ? `Página ${page + 1} de ${pages}` : '';
  return [c.footer, num].filter(Boolean).join('   ·   ');
}

/** Dibujo de la separación entre hojas: fin de la hoja actual, banda y comienzo de la siguiente. */
export function sheetElement(height: number, page: number, pages: number, c: PageChrome): HTMLElement {
  const sheet = document.createElement('div');
  sheet.className = 'pb-sheet';
  sheet.contentEditable = 'false';
  sheet.style.height = `${height}px`;
  const footer = document.createElement('div');
  footer.className = 'pb-footer';
  footer.textContent = footerText(c, page, pages);
  footer.style.bottom = `${c.gap + c.marginTop + c.marginBottom / 2}px`;
  const band = document.createElement('div');
  band.className = 'pb-band';
  band.style.bottom = `${c.marginTop}px`;
  band.style.height = `${c.gap}px`;
  const header = document.createElement('div');
  header.className = 'pb-header';
  header.textContent = c.header;
  header.style.bottom = `${c.marginTop / 2}px`;
  sheet.append(footer, band, header);
  return sheet;
}

/** Número de columnas de una tabla (una celda con más colspan crearía columnas nuevas). */
export function tableColumns(table: PMNode): number {
  let cols = 0;
  table.firstChild?.forEach((cell) => { cols += (cell.attrs.colspan as number) || 1; });
  return Math.max(1, cols);
}

function widgetDOM(b: PageBreak, st: PState, doc: PMNode): HTMLElement {
  const sheet = sheetElement(b.height, b.page, st.pages, st.chrome!);
  if (b.kind === 'row') {
    const tr = document.createElement('tr');
    tr.className = 'pb-row';
    const td = document.createElement('td');
    td.colSpan = tableColumns(doc.resolve(b.pos).parent);
    td.style.height = `${b.height}px`;
    td.append(sheet);
    tr.append(td);
    return tr;
  }
  const el = document.createElement(b.kind === 'inline' ? 'span' : 'div');
  el.className = 'pb-gap';
  el.style.height = `${b.height}px`;
  el.append(sheet);
  return el;
}

function buildDeco(doc: PMNode, st: PState): DecorationSet {
  if (!st.chrome || !st.breaks.length) return DecorationSet.empty;
  return DecorationSet.create(doc, st.breaks.map((b) =>
    Decoration.widget(b.pos, () => widgetDOM(b, st, doc), {
      // Sin la posición en la clave: si un corte solo se desplaza con el texto,
      // ProseMirror reutiliza su DOM en vez de volver a crear la hoja.
      side: -1, ignoreSelection: true, key: `pb:${b.kind}:${b.height.toFixed(1)}:${b.page}:${st.pages}:${st.chrome!.header}:${st.chrome!.footer}:${st.chrome!.pageNumbers}`,
    })));
}

export const Pagination = Extension.create({
  name: 'pagination',
  addProseMirrorPlugins() {
    return [new Plugin<PState>({
      key: paginationKey,
      state: {
        init: () => ({ breaks: [], pages: 1, chrome: null, deco: DecorationSet.empty }),
        apply(tr, prev, _old, state) {
          const meta = tr.getMeta(paginationKey) as Partial<PState> | undefined;
          if (meta) {
            const next = { ...prev, ...meta } as PState;
            next.deco = buildDeco(state.doc, next);
            return next;
          }
          if (!tr.docChanged || !prev.breaks.length) return prev;
          // Mientras se recalcula, los cortes siguen al texto que se edita. Las
          // decoraciones se desplazan (no se rehacen): escribir no toca las hojas.
          const breaks: PageBreak[] = [];
          for (const b of prev.breaks) {
            const r = tr.mapping.mapResult(b.pos, -1);
            if (!r.deleted) breaks.push({ ...b, pos: r.pos });
          }
          return { ...prev, breaks, deco: prev.deco.map(tr.mapping, state.doc) };
        },
      },
      props: { decorations: (state) => paginationKey.getState(state)?.deco },
    })];
  },
});

export function getPagination(editor: Editor): PState {
  return paginationKey.getState(editor.state)!;
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

export interface PageGeometry {
  pageH: number;
  marginTop: number;
  marginBottom: number;
}

interface Unit {
  pos: number; // posición del nodo
  breakPos: number; // dónde va el corte si hay que pasarlo a la hoja siguiente
  dom: HTMLElement;
  hoistDom: HTMLElement;
  kind: 'text' | 'atom' | 'row' | 'footnote';
  heading: boolean;
  forced: boolean; // va justo después de un salto de página manual
  node?: PMNode;
  top: number; // naturales
  bottom: number;
  hoistTop: number;
}

const CONTAINERS = new Set(['bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'blockquote', 'callout', 'toggle']);
const SAFETY = 2; // px de holgura para absorber diferencias de redondeo entre motores

export interface PaginationResult {
  breaks: PageBreak[];
  pages: number;
  footnoteBreaks: { index: number; height: number; page: number }[];
  filler: number;
  lastPage: number;
}

/**
 * Calcula los cortes. `footnotes` son los bloques de la lista de notas (el
 * primero empieza en el título de la lista) y `endEl` el último elemento de la hoja.
 */
export function computePagination(
  editor: Editor, page: HTMLElement, geo: PageGeometry,
  footnotes: { top: HTMLElement; bottom: HTMLElement }[], footnoteSpacers: Map<number, number>, endEl: HTMLElement,
): PaginationResult {
  const view = editor.view;
  const st = getPagination(editor);
  const pageRect = page.getBoundingClientRect();
  const scale = pageRect.width / (page.offsetWidth || pageRect.width) || 1;
  const toY = (clientY: number) => (clientY - pageRect.top) / scale;
  const pmBreaks = st.breaks;
  const breaksBefore = (pos: number) => {
    let h = 0;
    for (const b of pmBreaks) if (b.pos <= pos) h += b.height;
    return h;
  };
  const totalPm = pmBreaks.reduce((a, b) => a + b.height, 0);

  // ---- Recogida de unidades en orden de documento ----
  const units: Unit[] = [];
  let forcedNext = false;
  const hidden = (el: HTMLElement | null) => !el || el.offsetParent === null && el.getClientRects().length === 0;
  const push = (node: PMNode, pos: number, breakPos: number, kind: Unit['kind']) => {
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    if (!dom || !(dom instanceof HTMLElement) || hidden(dom)) return;
    const hoistDom = (breakPos === pos ? dom : (view.nodeDOM(breakPos) as HTMLElement | null)) ?? dom;
    const r = dom.getBoundingClientRect();
    const hr = hoistDom.getBoundingClientRect();
    const before = breaksBefore(pos);
    // Los cortes dentro del propio nodo (párrafos partidos) alargan su caja.
    let inside = 0;
    for (const b of pmBreaks) if (b.pos > pos && b.pos < pos + node.nodeSize) inside += b.height;
    units.push({
      pos, breakPos, dom, hoistDom, kind, node, heading: node.type.name === 'heading', forced: forcedNext,
      top: toY(r.top) - before, bottom: toY(r.bottom) - before - inside, hoistTop: toY(hr.top) - breaksBefore(breakPos),
    });
    forcedNext = false;
  };
  const walk = (parent: PMNode, contentStart: number, hoist: number | null) => {
    let first = true;
    parent.forEach((child, offset) => {
      const pos = contentStart + offset;
      const bp = first && hoist !== null ? hoist : pos;
      const name = child.type.name;
      if (name === 'pageBreak') {
        forcedNext = true;
      } else if (name === 'table') {
        let firstRow = true;
        child.forEach((row, rOff) => {
          const rp = pos + 1 + rOff;
          push(row, rp, firstRow ? bp : rp, 'row');
          firstRow = false;
        });
      } else if (CONTAINERS.has(name)) {
        walk(child, pos + 1, bp);
      } else {
        push(child, pos, bp, child.isTextblock ? 'text' : 'atom');
      }
      first = false;
    });
  };
  walk(view.state.doc, 0, null);

  // Notas al pie (fuera del editor, al final de la última hoja)
  let spacersBefore = 0;
  footnotes.forEach((f, i) => {
    spacersBefore += footnoteSpacers.get(i) ?? 0;
    const t = toY(f.top.getBoundingClientRect().top) - totalPm - spacersBefore;
    units.push({
      pos: -1 - i, breakPos: -1 - i, dom: f.bottom, hoistDom: f.top, kind: 'footnote', heading: false, forced: false,
      top: t, bottom: toY(f.bottom.getBoundingClientRect().bottom) - totalPm - spacersBefore, hoistTop: t,
    });
  });
  const allSpacers = [...footnoteSpacers.values()].reduce((a, b) => a + b, 0);
  const endY = toY(endEl.getBoundingClientRect().bottom) - totalPm - allSpacers;

  // ---- Decisión ----
  const pitch = geo.pageH + SHEET_GAP;
  const contentTop = (k: number) => k * pitch + geo.marginTop;
  const limit = (k: number) => k * pitch + geo.pageH - geo.marginBottom - SAFETY;
  const breaks: PageBreak[] = [];
  const footnoteBreaks: PaginationResult['footnoteBreaks'] = [];
  let k = 0;
  let shift = 0;
  const addBreak = (pos: number, kind: BreakKind, naturalTop: number) => {
    const height = Math.max(0, contentTop(k + 1) - (naturalTop + shift));
    if (pos < 0) footnoteBreaks.push({ index: -1 - pos, height, page: k });
    else breaks.push({ pos, kind, height, page: k });
    shift += height;
    k++;
  };
  const kindAt = (pos: number): BreakKind => {
    const parent = view.state.doc.resolve(pos).parent;
    if (parent.type.name === 'table') return 'row';
    return parent.isTextblock ? 'inline' : 'block';
  };

  let prev: (Unit & { page: number }) | null = null;
  for (const u of units) {
    if (u.forced && u.hoistTop + shift > contentTop(k) + 0.5) addBreak(u.breakPos, kindAt(u.breakPos), u.hoistTop);
    if (u.bottom + shift <= limit(k)) { prev = { ...u, page: k }; continue; }

    // Párrafos: se parten por líneas (mínimo dos líneas a cada lado, como Word).
    if (u.kind === 'text' && u.node && trySplit(u)) { prev = { ...u, page: k }; continue; }

    if (u.hoistTop + shift <= contentTop(k) + 0.5) {
      // Ya empieza arriba de la hoja y aun así no cabe (bloque más alto que una página).
      prev = { ...u, page: k };
      continue;
    }
    // Un título nunca se queda solo al final de la hoja.
    let target: Unit = u;
    if (prev && prev.heading && prev.page === k && prev.hoistTop + shift > contentTop(k) + 0.5 && prev.breakPos !== u.breakPos) target = prev;
    addBreak(target.breakPos, target.pos < 0 ? 'block' : kindAt(target.breakPos), target.hoistTop);
    if (target !== u) {
      // el título ha bajado: comprobamos que el bloque actual cabe con él
      if (u.bottom + shift > limit(k) && u.kind === 'text' && u.node) trySplit(u);
    } else if (u.bottom + shift > limit(k) && u.kind === 'text' && u.node) {
      trySplit(u);
    }
    prev = { ...u, page: k };
  }

  /**
   * Parte un párrafo entre hojas por líneas. Devuelve false si no se puede
   * dejar al menos dos líneas en la hoja actual (entonces se mueve entero).
   */
  function trySplit(u: Unit): boolean {
    const node = u.node!;
    const cs = getComputedStyle(u.dom);
    const lh = parseFloat(cs.lineHeight);
    if (!Number.isFinite(lh) || lh <= 0) return false;
    const cTop = u.top + parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
    const cBottom = u.bottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth);
    const total = Math.round((cBottom - cTop) / lh);
    if (total < 4) return false;
    let line = 0; // primera línea que aún no tiene hoja
    let did = false;
    for (;;) {
      if (u.bottom + shift <= limit(k)) return true;
      const remaining = total - line;
      let n = Math.floor((limit(k) - (cTop + line * lh + shift)) / lh); // líneas que caben aquí
      if (n >= remaining) return true; // solo sobresale el espacio inferior del párrafo
      if (remaining - n < 2) n = remaining - 2; // viudas: al menos dos líneas pasan
      if (n < 2) return did; // huérfanas: no dejamos una línea sola
      const lineTop = cTop + (line + n) * lh;
      const at = findLineStart(node, u.pos, lineTop);
      if (at === null) return did;
      addBreak(at, 'inline', lineTop);
      line += n;
      did = true;
    }
  }

  /** Primera posición del párrafo que cae en la línea que empieza en `lineTop` (coordenadas naturales). */
  function findLineStart(node: PMNode, pos: number, lineTop: number): number | null {
    const first = pos + 1;
    const last = pos + node.nodeSize - 1;
    const centerOf = (p: number) => {
      try {
        const c = view.coordsAtPos(p, 1);
        return toY((c.top + c.bottom) / 2) - breaksBefore(p);
      } catch { return -Infinity; }
    };
    if (centerOf(last - 1) < lineTop) return null;
    let lo = first;
    let hi = last - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (centerOf(mid) < lineTop) lo = mid + 1; else hi = mid;
    }
    return lo > first && lo < last ? lo : null;
  }

  const filler = Math.max(0, k * pitch + geo.pageH - (endY + shift));
  return { breaks, pages: k + 1, footnoteBreaks, filler, lastPage: k };
}
