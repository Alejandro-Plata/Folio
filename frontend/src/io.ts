// Exportación (HTML, Markdown, PDF, impresión) e importación (.docx, .md, .html, .txt).
import { generateHTML, generateJSON, getSchema } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { schemaExtensions, blobToBase64 } from './editor/editor';
import { CALLOUT_KINDS } from './editor/extensions';
import { headingSlug } from './editor/anchors';
import { renderMathHTML } from './editor/math';
import { tableColumns, type PageBreak } from './editor/pagination';
import { contentCSS, PAGE_EXTRAS_CSS, PRINT_TOKENS } from './content-css';
import { icon } from './ui/icons';
import interLatin from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import interLatinExt from '@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2?url';

const KATEX_FONTS = import.meta.glob('../node_modules/katex/dist/fonts/*.woff2', { query: '?url', import: 'default' });
import { api } from './api';
import { escapeHTML } from './ui/dom';
import { bundledFontsUsed, embeddedFontFaces, fontStack, LATIN_RANGE } from './fonts';
import type { Meta, PageSetup } from './types';

export const PAPER_MM: Record<string, [number, number]> = {
  A4: [210, 297], Letter: [215.9, 279.4], A5: [148, 210], Legal: [215.9, 355.6],
};

export function pageSizeMM(s: PageSetup): [number, number] {
  const [w, h] = PAPER_MM[s.paper] ?? PAPER_MM.A4;
  return s.orientation === 'landscape' ? [h, w] : [w, h];
}

export function expandPlaceholders(s: string, title: string, author: string) {
  return s.replace(/\{t[ií]tulo\}/g, title).replace(/\{fecha\}/g, new Date().toLocaleDateString('es-ES')).replace(/\{autor\}/g, author);
}

export interface ExportOpts {
  studentVersion: boolean;
  includeTitle: boolean;
  embedImages: boolean;
  author?: string;
  /** Cortes de página calculados por el editor; sin ellos el navegador pagina por su cuenta. */
  layout?: { breaks: PageBreak[]; footnoteBreaks: number[] };
}

/** Copia del documento con marcas de salto en las posiciones de los cortes. */
function withPrintBreaks(doc: PMNode, breaks: PageBreak[]): PMNode {
  const schema = doc.type.schema;
  const at = new Map(breaks.map((b) => [b.pos, b.kind]));
  const blockMark = schema.nodes.printBreak.create();
  const rowMark = (table: PMNode) => schema.nodes.printBreakRow.create({ cols: tableColumns(table) });
  const inlineMark = schema.nodes.printBreakInline.create();
  const rebuild = (node: PMNode, start: number): PMNode => {
    const out: PMNode[] = [];
    if (node.isTextblock) {
      node.forEach((child, offset) => {
        const cpos = start + offset;
        if (!child.isText) {
          if (at.get(cpos) === 'inline') out.push(inlineMark);
          out.push(child);
          return;
        }
        const text = child.text!;
        let last = 0;
        for (let i = 0; i < text.length; i++) {
          if (at.get(cpos + i) !== 'inline') continue;
          if (i > last) out.push(schema.text(text.slice(last, i), child.marks));
          out.push(inlineMark);
          last = i;
        }
        out.push(last === 0 ? child : schema.text(text.slice(last), child.marks));
      });
      return node.copy(Fragment.fromArray(out));
    }
    node.forEach((child, offset) => {
      const cpos = start + offset;
      const k = at.get(cpos);
      if (k === 'block') out.push(blockMark);
      else if (k === 'row') out.push(rowMark(node));
      out.push(child.isLeaf ? child : rebuild(child, cpos + 1));
    });
    return node.copy(Fragment.fromArray(out));
  };
  return rebuild(doc, 0);
}

/**
 * Genera un HTML autónomo para imprimir o guardar. Reproduce la estructura del
 * editor (cuadros, plegables, imágenes, ecuaciones KaTeX) con los mismos
 * estilos y fuentes, y aplica los cortes de página calculados en el editor.
 */
export async function buildExportHTML(content: JSONContent, meta: Meta, setup: PageSetup, o: ExportOpts): Promise<string> {
  const exts = schemaExtensions();
  let json = content;
  if (o.layout?.breaks.length) {
    const schema = getSchema(exts);
    json = withPrintBreaks(schema.nodeFromJSON(content), o.layout.breaks).toJSON();
  }
  const body = generateHTML(json, exts);
  const doc = new DOMParser().parseFromString(`<body>${body}</body>`, 'text/html');
  const root = doc.body;
  const el = (tag: string, cls: string, html = '') => {
    const e = doc.createElement(tag);
    e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  };

  if (o.studentVersion) root.querySelectorAll('div[data-toggle][data-solution="true"]').forEach((n) => n.remove());

  // Plegables: misma cabecera que en el editor
  root.querySelectorAll<HTMLElement>('div[data-toggle]').forEach((n) => {
    const solution = n.getAttribute('data-solution') === 'true';
    const head = el('div', 'toggle-head');
    head.append(el('span', 'toggle-chevron'), el('span', 'toggle-title'));
    head.lastElementChild!.textContent = n.getAttribute('data-title') || (solution ? 'Solución' : '');
    const box = el('div', 'toggle-content');
    box.append(...Array.from(n.childNodes));
    n.className = `toggle is-open${solution ? ' is-solution' : ''}`;
    n.append(head, box);
  });

  // Cuadros destacados: icono, etiqueta y contenido como en el editor
  root.querySelectorAll<HTMLElement>('div[data-callout]').forEach((n) => {
    const k = CALLOUT_KINDS[n.getAttribute('data-callout') || 'info'] ?? CALLOUT_KINDS.info;
    const box = el('div', 'callout-content');
    box.append(...Array.from(n.childNodes));
    const label = el('div', 'callout-label');
    label.textContent = k.label;
    n.append(el('span', 'callout-icon', icon(k.icon, 18)), label, box);
  });

  // Ecuaciones con KaTeX, igual que en pantalla
  const maths = Array.from(root.querySelectorAll<HTMLElement>('[data-math-inline],[data-math-block]'));
  for (const n of maths) n.innerHTML = await renderMathHTML(n.getAttribute('data-latex') || '', n.hasAttribute('data-math-block'));

  // Mismas anclas que los enlaces internos del editor («#titulo»); repetidas, con sufijo
  const seen = new Map<string, number>();
  root.querySelectorAll<HTMLElement>('h1,h2,h3,h4').forEach((hd) => {
    const base = headingSlug(hd.textContent || '');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    hd.id = n > 1 ? `${base}-${n}` : base;
  });
  // Índice (títulos de nivel 1 a 3, como en el editor)
  const headings = Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3'));
  root.querySelectorAll<HTMLElement>('div[data-toc]').forEach((n) => {
    n.innerHTML = '<div class="toc-title">Índice</div>' + (headings.length
      ? headings.map((hd) => `<a class="toc-item toc-l${hd.tagName[1]}" href="#${hd.id}">${escapeHTML(hd.textContent || '')}</a>`).join('')
      : '<div class="toc-empty">Añade títulos (Ctrl+Alt+1, 2, 3) y aparecerán aquí.</div>');
  });

  // Notas al pie: llamadas numeradas por CSS y lista al final
  const notes: string[] = [];
  root.querySelectorAll<HTMLElement>('sup[data-footnote]').forEach((n) => {
    notes.push(n.getAttribute('data-text') || '');
    n.removeAttribute('title');
  });

  // Imágenes con el mismo marco que en el editor
  for (const img of Array.from(root.querySelectorAll<HTMLImageElement>('img'))) {
    const block = el('div', 'image-block');
    block.dataset.align = img.getAttribute('data-align') || 'center';
    const frame = el('div', 'image-frame');
    const w = img.getAttribute('width');
    if (w) frame.style.width = `${w}px`;
    img.removeAttribute('width');
    img.replaceWith(block);
    frame.append(img);
    block.append(frame);
    if (o.embedImages) {
      const src = img.getAttribute('src') || '';
      if (!src.startsWith('data:')) {
        try {
          const blob = await (await fetch(src)).blob();
          img.setAttribute('src', `data:${blob.type};base64,${await blobToBase64(blob)}`);
        } catch { /* se deja la ruta original */ }
      }
    }
  }

  // Tablas dentro del mismo contenedor que usa el editor
  root.querySelectorAll('table').forEach((t) => {
    const w = el('div', 'tableWrapper');
    t.replaceWith(w);
    w.append(t);
  });

  // Igual que ProseMirror: las líneas vacías finales ocupan una línea
  root.querySelectorAll('p, h1, h2, h3, h4, pre > code').forEach((b) => {
    const last = b.lastChild;
    if (!last || (last.nodeName === 'BR')) b.append(doc.createElement('br'));
  });

  // Los comentarios de revisión no se imprimen
  root.querySelectorAll('span.comment-mark').forEach((n) => n.replaceWith(...Array.from(n.childNodes)));

  const footBreaks = new Set(o.layout?.footnoteBreaks ?? []);
  const footnotes = notes.length
    ? `<div class="footnotes-area${footBreaks.has(0) ? ' pb-before' : ''}"><div class="footnotes-rule"></div><div class="footnotes-title">Notas al pie</div><ol>${
      notes.map((t, i) => `<li${i > 0 && footBreaks.has(i) ? ' class="pb-before"' : ''}>${escapeHTML(t || '(nota vacía)')}</li>`).join('')}</ol></div>`
    : '';
  const title = escapeHTML(meta.title || 'Sin título');
  const titleBlock = o.includeTitle && meta.title ? `<h1 class="doc-title">${title}</h1>` : '';
  const fonts = await embeddedFontsCSS(maths.length > 0) + await embeddedFontFaces(bundledFontsUsed(content, setup.fontFamily));
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><meta name="generator" content="Folio">
<style>${fonts}${exportCSS(setup, meta.title, o.author ?? '')}</style></head>
<body><main class="doc">${titleBlock}<div class="doc-body">${root.innerHTML}</div>${footnotes}</main></body></html>`;
}

function cssString(s: string) {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

export function exportCSS(s: PageSetup, title: string, author: string): string {
  const [w, h] = pageSizeMM(s);
  const header = expandPlaceholders(s.header || '', title, author);
  const footer = expandPlaceholders(s.footer || '', title, author);
  const pageNum = s.pageNumbers ? `"Página " counter(page) " de " counter(pages)` : '';
  const footerContent = [footer ? cssString(footer) : '', footer && pageNum ? '"   ·   "' : '', pageNum].filter(Boolean).join(' ');
  const chromeFont = `8.5pt/1.4 var(--font-ui)`;
  return `${PRINT_TOKENS}
@page { size: ${w}mm ${h}mm; margin: ${s.marginTop}mm ${s.marginRight}mm ${s.marginBottom}mm ${s.marginLeft}mm;
  ${header ? `@top-right { content: ${cssString(header)}; font: ${chromeFont}; color: #8a8a87; }` : ''}
  ${footerContent ? `@bottom-center { content: ${footerContent}; font: ${chromeFont}; color: #8a8a87; }` : ''}
}
* { box-sizing: border-box; orphans: 1; widows: 1; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: #fff; }
.doc { --doc-font: ${fontStack(s.fontFamily)}; --doc-size: ${s.fontSize}pt; --doc-lh: ${s.lineHeight};${s.titleSize ? ` --title-size: ${s.titleSize}pt;` : ''} --content-h: ${(h - s.marginTop - s.marginBottom).toFixed(2)}mm; }
button { font: inherit; }
${contentCSS('.doc-body')}
${PAGE_EXTRAS_CSS}
.toggle-chevron { visibility: hidden; }
.doc-body a { text-decoration-color: rgba(36, 99, 197, 0.4); }
.pb-print, .pb-print-inline { display: block; height: 0; break-before: page; }
tr.pb-print-row { break-before: page; }
tr.pb-print-row > td { padding: 0; border: 0; height: 0; }
.pb-before { break-before: page; }
@media screen {
  body { background: #e9e9e7; padding: 24px 0; }
  .doc { width: ${w}mm; margin: 0 auto; background: #fff; padding: ${s.marginTop}mm ${s.marginRight}mm ${s.marginBottom}mm ${s.marginLeft}mm; box-shadow: 0 1px 6px rgba(0,0,0,.15); }
  .pb-print, .pb-print-inline, .pb-before::before { display: block; height: 0; margin: ${s.marginBottom + 6}mm -${s.marginRight}mm ${s.marginTop + 6}mm -${s.marginLeft}mm; border-top: 2px dashed #d0d0cd; }
  .pb-before::before { content: ''; }
  tr.pb-print-row > td { height: 24px; border-top: 2px dashed #d0d0cd; }
}
`;
}

// ---------- Fuentes incrustadas (para que el PDF use exactamente las mismas) ----------
let interCSS: Promise<string> | null = null;
let katexCSS: Promise<string> | null = null;

async function toDataURL(url: string, type: string) {
  const blob = await (await fetch(url)).blob();
  return `data:${type};base64,${await blobToBase64(blob)}`;
}

async function embeddedFontsCSS(withMath: boolean): Promise<string> {
  if (!interCSS) {
    interCSS = (async () => {
      const [latin, ext] = await Promise.all([toDataURL(interLatin, 'font/woff2'), toDataURL(interLatinExt, 'font/woff2')]);
      const face = (src: string, range: string) =>
        `@font-face{font-family:'Inter Variable';font-style:normal;font-display:block;font-weight:100 900;src:url(${src}) format('woff2-variations');unicode-range:${range}}`;
      return face(ext, 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF')
        + face(latin, LATIN_RANGE);
    })();
  }
  let css = await interCSS;
  if (withMath) {
    if (!katexCSS) {
      katexCSS = (async () => {
        const raw = (await import('katex/dist/katex.min.css?raw')).default as string;
        const urls = await Promise.all(Object.entries(KATEX_FONTS).map(async ([path, load]) => {
          const name = path.split('/').pop()!.replace('.woff2', '');
          return [name, await toDataURL(await load() as string, 'font/woff2')] as const;
        }));
        const map = new Map(urls);
        return raw.replace(/src:url\(fonts\/([\w-]+)\.woff2\) format\("woff2"\)[^;}]*/g, (_m, name) => `src:url(${map.get(name)}) format("woff2")`);
      })();
    }
    css += await katexCSS;
  }
  return css;
}

/** Imprime con el diálogo del sistema (permite «Guardar como PDF»). */
export function printHTML(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    frame.srcdoc = html;
    frame.onload = async () => {
      const w = frame.contentWindow!;
      await Promise.all(Array.from(w.document.images).map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
      w.focus();
      w.print();
      setTimeout(() => { frame.remove(); resolve(); }, 1000);
    };
    document.body.append(frame);
  });
}

export async function toMarkdown(html: string): Promise<string> {
  const [{ default: TurndownService }, gfm] = await Promise.all([import('turndown'), import('turndown-plugin-gfm')]);
  // Ajustes previos para que el Markdown sea limpio (GFM): casillas, encabezados de tabla…
  const dom = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
  dom.querySelectorAll('li[data-type="taskItem"]').forEach((li) => {
    li.querySelector(':scope > label')?.remove();
  });
  dom.querySelectorAll('table').forEach((t) => {
    t.querySelectorAll('colgroup').forEach((c) => c.remove());
    t.removeAttribute('style');
    const first = t.querySelector('tr');
    if (first && !first.querySelector('th')) {
      first.querySelectorAll('td').forEach((td) => { const th = document.createElement('th'); th.innerHTML = td.innerHTML; td.replaceWith(th); });
    }
    t.querySelectorAll('th, td').forEach((c) => {
      const ps = Array.from(c.querySelectorAll('p'));
      if (ps.length) c.innerHTML = ps.map((p) => p.innerHTML).filter(Boolean).join('<br>') || '&nbsp;';
    });
  });
  dom.querySelectorAll('.callout-icon, .toggle-chevron, .pb-print, .pb-print-inline, tr.pb-print-row, .footnotes-rule').forEach((n) => n.remove());
  dom.querySelectorAll('.toggle-title').forEach((t) => { if (t.textContent) t.outerHTML = `<p><strong>${escapeHTML(t.textContent)}</strong></p>`; });
  dom.querySelectorAll('.callout-label').forEach((l) => { l.outerHTML = `<p><strong>${escapeHTML(l.textContent || '')}</strong></p>`; });
  const td = new TurndownService({
    headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*',
    // Turndown no aplica reglas a los nodos vacíos: las líneas de respuesta se tratan aquí.
    blankReplacement: (_c, node: any) => {
      if (node.classList?.contains('answer-lines')) {
        const n = Number(node.getAttribute('data-lines') || 4);
        return '\n\n' + Array.from({ length: n }, () => '_______________________________________').join('\n\n') + '\n\n';
      }
      if (node.classList?.contains('page-break')) return '\n\n---\n\n';
      return node.isBlock ? '\n\n' : '';
    },
  });
  td.use((gfm as any).gfm ?? (gfm as any).default?.gfm);
  td.addRule('math', {
    filter: (n) => n.nodeName === 'SPAN' && n.hasAttribute('data-math-inline') || n.nodeName === 'DIV' && n.hasAttribute('data-math-block'),
    replacement: (_c, n) => {
      const el = n as HTMLElement;
      const latex = el.getAttribute('data-latex') || '';
      return el.hasAttribute('data-math-block') ? `\n\n$$\n${latex}\n$$\n\n` : `$${latex}$`;
    },
  });
  td.addRule('taskItem', {
    filter: (n) => n.nodeName === 'LI' && (n as HTMLElement).getAttribute('data-type') === 'taskItem',
    replacement: (c, n) => `- [${(n as HTMLElement).getAttribute('data-checked') === 'true' ? 'x' : ' '}] ${c.trim().replace(/\n+/g, ' ')}\n`,
  });
  td.addRule('callout', {
    filter: (n) => n.nodeName === 'DIV' && (n as HTMLElement).classList.contains('callout'),
    replacement: (c) => '\n\n' + c.trim().split('\n').map((l) => `> ${l}`).join('\n') + '\n\n',
  });
  td.addRule('mathml', { filter: (n) => n.nodeName.toLowerCase() === 'math', replacement: () => '' });
  return td.turndown(dom.innerHTML).replace(/\n{3,}/g, '\n\n');
}

// ---------- Importación ----------

export interface Imported { content: JSONContent; text: string }

function bytesFromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function importToJSON(ext: string, b64: string, docId: string): Promise<JSONContent> {
  const bytes = bytesFromB64(b64);
  const text = () => new TextDecoder('utf-8').decode(bytes);
  let html = '';
  switch (ext) {
    case '.docx': {
      const mod: any = await import('mammoth/mammoth.browser.min.js');
      const mammoth = mod.default ?? mod;
      const res = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer }, {
        styleMap: [
          "p[style-name='Title'] => h1:fresh", "p[style-name='Título'] => h1:fresh",
          "p[style-name='Título 1'] => h1:fresh", "p[style-name='Título 2'] => h2:fresh", "p[style-name='Título 3'] => h3:fresh",
          "p[style-name='Quote'] => blockquote:fresh", "p[style-name='Cita'] => blockquote:fresh",
        ],
        convertImage: mammoth.images.imgElement(async (image: any) => {
          const data = await image.read('base64');
          const ext = (image.contentType?.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('x-emf', 'png');
          try {
            return { src: await api.SaveImage(docId, `imagen.${ext}`, data) };
          } catch {
            return { src: '' };
          }
        }),
      });
      html = res.value;
      break;
    }
    case '.md':
    case '.markdown': {
      const { marked } = await import('marked');
      const src = text()
        .replace(/\$\$([\s\S]+?)\$\$/g, (_m, l) => `<div data-math-block data-latex="${escapeHTML(l.trim())}"></div>`)
        .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_m, pre, l) => `${pre}<span data-math-inline data-latex="${escapeHTML(l)}"></span>`);
      html = await marked.parse(src, { gfm: true });
      break;
    }
    case '.html':
    case '.htm':
      html = text();
      break;
    default:
      html = text().split(/\r?\n/).map((l) => `<p>${escapeHTML(l)}</p>`).join('');
  }
  return generateJSON(html, schemaExtensions());
}
