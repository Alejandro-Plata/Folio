// Estilos del contenido del documento, compartidos por el editor y por la
// exportación (PDF, impresión y HTML). Deben ser idénticos para que lo que se
// ve en cada página del editor coincida con el PDF.
//
// Regla de maquetación: ningún bloque usa margin-top. El espacio superior se
// da con padding-top y la separación entre bloques con margin-bottom. Así no
// hay colapso de márgenes que dependa del contexto y la paginación puede
// calcular las posiciones sumando alturas.

export function contentCSS(s = '.doc-body'): string {
  return `
${s} {
  font-family: var(--doc-font); font-size: var(--doc-size); line-height: var(--doc-lh); color: var(--text);
  white-space: pre-wrap; white-space: break-spaces; word-wrap: break-word; overflow-wrap: break-word; tab-size: 4;
  font-variant-ligatures: none; font-feature-settings: "liga" 0; counter-reset: footnote;
}
${s} p { margin: 0 0 0.55em; }
${s} h1, ${s} h2, ${s} h3, ${s} h4 { color: var(--text-strong); line-height: 1.25; margin: 0 0 0.35em; padding-top: 1.15em; font-weight: 700; letter-spacing: -0.005em; }
${s} > h1:first-child, ${s} > h2:first-child, ${s} > h3:first-child, ${s} > h4:first-child { padding-top: 0; }
${s} h1 { font-size: 1.75em; }
${s} h2 { font-size: 1.4em; }
${s} h3 { font-size: 1.18em; }
${s} h4 { font-size: 1.05em; }
${s} a { color: var(--accent); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent); text-underline-offset: 2px; }
${s} ul, ${s} ol { margin: 0 0 0.6em; padding: 0 0 0 1.6em; }
${s} li > p { margin: 0 0 0.15em; }
${s} li > ul, ${s} li > ol { margin-bottom: 0.15em; }
${s} li::marker { color: var(--text-muted); }
${s} ul ul { list-style-type: circle; }
${s} ul ul ul { list-style-type: square; }
${s} ol ol { list-style-type: lower-alpha; }
${s} ol ol ol { list-style-type: lower-roman; }
${s} ul[data-type='taskList'] { list-style: none; padding-left: 0.15em; }
${s} ul[data-type='taskList'] li { display: flex; gap: 0.5em; align-items: flex-start; }
${s} ul[data-type='taskList'] li > label { flex: none; margin-top: 0.22em; user-select: none; }
${s} ul[data-type='taskList'] li > label input { width: 1.05em; height: 1.05em; accent-color: var(--accent); margin: 0; }
${s} ul[data-type='taskList'] li > div { flex: 1; min-width: 0; }
${s} ul[data-type='taskList'] li[data-checked='true'] > div { color: var(--text-faint); text-decoration: line-through; }
${s} blockquote { margin: 0 0 0.8em; padding: 0.05em 0 0.05em 1em; border-left: 3px solid var(--text-strong); }
${s} pre { background: var(--bg-code); border-radius: 6px; padding: 0.9em 1.1em; font: 0.86em/1.55 var(--font-mono); margin: 0 0 0.8em; white-space: pre-wrap; }
${s} code { background: var(--bg-code); border-radius: 4px; padding: 0.12em 0.32em; font: 0.86em var(--font-mono); color: #c7413b; }
${s} pre code { background: none; padding: 0; color: inherit; font-size: 1em; }
${s} hr { border: 0; box-sizing: content-box; height: 1px; padding-top: 0.7em; margin: 0 0 0.7em; background: linear-gradient(var(--border-strong), var(--border-strong)) bottom / 100% 1px no-repeat; }
${s} mark { border-radius: 3px; padding: 0 0.08em; color: inherit; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
${s} > :last-child, ${s} li > :last-child, ${s} blockquote > :last-child, ${s} td > :last-child, ${s} th > :last-child,
${s} .callout-content > :last-child, ${s} .toggle-content > :last-child { margin-bottom: 0; }

/* Tablas */
${s} .tableWrapper { margin: 0 0 0.8em; overflow-x: auto; }
${s} table { border-collapse: collapse; table-layout: fixed; width: 100%; margin: 0; }
${s} td, ${s} th { border: 1px solid var(--border-strong); padding: 0.35em 0.55em; vertical-align: top; min-width: 40px; }
${s} th { background: var(--bg-code); font-weight: 600; text-align: left; }

/* Imágenes: nunca más altas que el área útil de la página */
${s} .image-block { margin: 0 0 0.6em; display: flex; }
${s} .image-block[data-align='center'] { justify-content: center; }
${s} .image-block[data-align='right'] { justify-content: flex-end; }
${s} .image-frame { position: relative; max-width: 100%; line-height: 0; }
${s} .image-frame img { max-width: 100%; max-height: var(--content-h, none); width: auto; height: auto; border-radius: 4px; display: block; }

/* Cuadros destacados */
${s} .callout { display: grid; grid-template-columns: auto 1fr; column-gap: 0.6em; border-radius: 6px; padding: 0.75em 1em 0.6em 0.8em; margin: 0 0 0.7em; background: var(--bg-c); border-left: 3px solid var(--c); }
${s} .callout[data-callout='info'] { --c: var(--c-info); --bg-c: var(--bg-info); }
${s} .callout[data-callout='tip'] { --c: var(--c-tip); --bg-c: var(--bg-tip); }
${s} .callout[data-callout='warning'] { --c: var(--c-warning); --bg-c: var(--bg-warning); }
${s} .callout[data-callout='important'] { --c: var(--c-important); --bg-c: var(--bg-important); }
${s} .callout[data-callout='definition'] { --c: var(--c-definition); --bg-c: var(--bg-definition); }
${s} .callout[data-callout='example'] { --c: var(--c-example); --bg-c: var(--bg-example); }
${s} .callout[data-callout='exercise'] { --c: var(--c-exercise); --bg-c: var(--bg-exercise); }
${s} .callout-icon { grid-row: 1 / span 2; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 5px; color: var(--c); margin-top: -2px; padding: 0; border: 0; background: none; }
${s} .callout-label { font-size: 0.78em; font-weight: 700; color: var(--c); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.15em; user-select: none; line-height: 1.4; }

/* Plegables y soluciones (cabecera de alto fijo para que mida lo mismo en todas partes) */
${s} .toggle { margin: 0 0 0.5em; }
${s} .toggle-head { position: relative; display: flex; align-items: center; gap: 4px; margin-left: -1.6em; height: 1.9em; }
${s} .toggle-chevron { width: 1.5em; height: 1.5em; display: grid; place-items: center; border-radius: 4px; color: var(--text-muted); flex: none; padding: 0; border: 0; background: none; }
${s} .toggle-title { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: 600 1em/1.4 var(--doc-font); color: var(--text-strong); padding: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${s} .toggle-badge { position: absolute; right: 0; top: 50%; transform: translateY(-50%); font: 600 11px/1.6 var(--font-ui); padding: 0 8px; border-radius: 10px; }
${s} .toggle.is-solution .toggle-title { color: var(--c-tip); }
${s} .toggle-content { border-left: 2px solid var(--border); margin-left: -0.85em; padding-left: 0.85em; }
${s} .toggle.is-solution > .toggle-content { border-left-color: color-mix(in srgb, var(--c-tip) 50%, transparent); }

/* Líneas de respuesta */
${s} .answer-lines {
  --lh: 2.1em; position: relative; height: calc(var(--lines, 4) * var(--lh)); margin: 0 0 0.8em;
  background: repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--lh) - 1px), var(--border-strong) calc(var(--lh) - 1px), var(--border-strong) var(--lh));
}

/* Ecuaciones */
${s} .math-block { text-align: center; padding: 0.4em 0; margin: 0 0 0.5em; overflow-x: auto; border-radius: 6px; }
${s} .katex { font-size: 1.08em; }

/* Notas al pie */
${s} .footnote-ref { counter-increment: footnote; color: var(--accent); font-weight: 600; font-size: 0.72em; padding: 0 1px; }
${s} .footnote-ref::after { content: counter(footnote); }

/* Índice */
${s} .toc { border: 1px solid var(--border); border-radius: 6px; padding: 0.8em 1em; margin: 0 0 1.2em; user-select: none; }
${s} .toc-title { font-weight: 700; margin-bottom: 0.3em; color: var(--text-strong); }
${s} .toc-item { display: block; color: var(--text-muted); text-decoration: underline; text-decoration-color: var(--border-strong); text-underline-offset: 3px; padding: 0.12em 0; }
${s} .toc-l2 { padding-left: 1.2em; }
${s} .toc-l3 { padding-left: 2.4em; font-size: 0.95em; }
${s} .toc-empty { color: var(--text-faint); font-size: 0.9em; }

/* Salto de página manual: no ocupa espacio; el corte lo dibuja la paginación */
${s} .page-break { height: 0; margin: 0; }
`;
}

/** Título del documento y notas al pie: fuera del cuerpo pero dentro de la página. */
export const PAGE_EXTRAS_CSS = `
.doc-title {
  display: block; width: 100%; border: 0; outline: 0; resize: none; background: transparent; overflow: hidden;
  font: 700 var(--title-size, calc(var(--doc-size) * 2.45))/1.2 var(--doc-font); letter-spacing: -0.01em; color: var(--text-strong);
  padding: 0; margin: 0 0 calc(var(--doc-size) * 1.1); white-space: pre-wrap; overflow-wrap: break-word; font-variant-ligatures: none; font-feature-settings: "liga" 0;
}
.footnotes-area { padding-top: 2.2em; font-family: var(--doc-font); font-size: calc(var(--doc-size) * 0.85); line-height: var(--doc-lh); }
.footnotes-area .footnotes-rule { width: 40%; min-width: 200px; border-top: 1px solid var(--border-strong); padding-top: 0.6em; }
.footnotes-title { font: 600 11px/1.5 var(--font-ui); color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
.footnotes-area ol { padding: 0 0 0 1.4em; margin: 0; }
.footnotes-area li { color: var(--text-muted); padding: 1px 0; }
`;

/** Paleta clara usada al imprimir y exportar. */
export const PRINT_TOKENS = `
:root {
  --font-ui: 'Inter Variable', Inter, 'Segoe UI', Roboto, Cantarell, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Cascadia Code', Consolas, 'Liberation Mono', monospace;
  --text: #37352f; --text-strong: #1f1e1b; --text-muted: rgba(55, 53, 47, 0.62); --text-faint: rgba(55, 53, 47, 0.42);
  --border: rgba(55, 53, 47, 0.12); --border-strong: rgba(55, 53, 47, 0.22); --accent: #2463c5; --bg-code: #f3f3f1;
  --c-info: #2f74c0; --bg-info: #eef4fb; --c-tip: #2e8b4e; --bg-tip: #eef8f0; --c-warning: #a87700; --bg-warning: #fff6e5;
  --c-important: #c33b3b; --bg-important: #fdecec; --c-definition: #7552c4; --bg-definition: #f3eefb;
  --c-example: #23807f; --bg-example: #eaf6f6; --c-exercise: #6b6560; --bg-exercise: #f5f5f4;
}
`;
