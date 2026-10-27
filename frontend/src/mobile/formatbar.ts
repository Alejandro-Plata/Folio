// Barra de formato del móvil: una fila con desplazamiento sobre el teclado con
// lo más usado, y dos hojas con el resto («Aa»: estilos, fuente, color,
// alineación; «+»: bloques para insertar). Llama a las mismas acciones que los
// atajos y la cinta del escritorio.
import type { App } from '../app';
import { emit } from '../bus';
import { filterBlocks, blockIconHTML } from '../editor/blocks';
import { findFont } from '../fonts';
import { FontPicker } from '../ui/fontpicker';
import { debounce, h } from '../ui/dom';
import { icon } from '../ui/icons';
import { sheet } from './sheet';

const COLORS = ['#000000', '#7f7f7f', '#c0392b', '#e67e22', '#d4ac0d', '#27ae60', '#16a085', '#2471a3', '#1f3a93', '#7d3c98', '#c2185b', '#6d4c41'];
const HIGHLIGHTS = ['#fff3a3', '#c8f7c5', '#c5eff7', '#ffd6e7', '#dcd3ff', '#ffe0b2', '#e5e5e5'];

interface Btn { id: string; ic?: string; glyph?: string; label: string; run: () => void; active?: () => boolean }

export class FormatBar {
  el = h('div', { class: 'm-formatbar', role: 'toolbar', 'aria-label': 'Formato del texto' });
  private buttons = new Map<string, HTMLButtonElement>();
  private defs: Btn[] = [];

  constructor(private app: App) {
    const ed = () => app.editor;
    const glyph = (t: string, cls = '') => `<span class="rb-glyph ${cls}">${t}</span>`;
    const es = app.keymap === 'es';
    this.defs = [
      { id: 'style', glyph: glyph('Aa', 'rb-case'), label: 'Estilos, fuente y color', run: () => this.formatSheet() },
      { id: 'insert', ic: 'plus', label: 'Insertar', run: () => this.insertSheet() },
      { id: 'bold', glyph: glyph(es ? 'N' : 'B', 'rb-b'), label: 'Negrita', run: () => app.run('bold'), active: () => ed().isActive('bold') },
      { id: 'italic', glyph: glyph(es ? 'K' : 'I', 'rb-i'), label: 'Cursiva', run: () => app.run('italic'), active: () => ed().isActive('italic') },
      { id: 'underline', glyph: glyph(es ? 'S' : 'U', 'rb-u'), label: 'Subrayado', run: () => app.run('underline'), active: () => ed().isActive('underline') },
      { id: 'bulletList', ic: 'listBullet', label: 'Viñetas', run: () => app.run('bulletList'), active: () => ed().isActive('bulletList') },
      { id: 'orderedList', ic: 'listOrdered', label: 'Numeración', run: () => app.run('orderedList'), active: () => ed().isActive('orderedList') },
      { id: 'taskList', ic: 'listTodo', label: 'Lista de tareas', run: () => void ed().chain().focus().toggleTaskList().run(), active: () => ed().isActive('taskList') },
      { id: 'outdent', ic: 'outdent', label: 'Reducir sangría', run: () => app.run('outdent') },
      { id: 'indent', ic: 'indent', label: 'Aumentar sangría', run: () => app.run('indent') },
      { id: 'equation', ic: 'sigma', label: 'Ecuación en línea', run: () => app.run('equation') },
      { id: 'image', ic: 'image', label: 'Imagen', run: () => emit('ui:insert-image') },
      { id: 'undo', ic: 'undo', label: 'Deshacer', run: () => app.run('undo') },
      { id: 'redo', ic: 'redo', label: 'Rehacer', run: () => app.run('redo') },
      { id: 'hide', ic: 'chevronDown', label: 'Ocultar el teclado', run: () => (document.activeElement as HTMLElement | null)?.blur() },
    ];
    for (const d of this.defs) {
      const b = h('button', {
        type: 'button', class: 'm-fb', title: d.label, 'aria-label': d.label, 'aria-pressed': d.active ? 'false' : undefined,
        html: d.glyph ?? icon(d.ic!, 20),
        // Sin quitar el foco al editor, para que el teclado no se cierre
        onmousedown: (e: MouseEvent) => e.preventDefault(), onclick: d.run,
      });
      this.buttons.set(d.id, b);
      this.el.append(b);
    }
    const update = debounce(() => this.update(), 40);
    app.editor.on('transaction', update);
    app.editor.on('selectionUpdate', update);
  }

  private update() {
    for (const d of this.defs) {
      if (!d.active) continue;
      const on = d.active();
      const b = this.buttons.get(d.id)!;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  // ---------- Hoja «Aa» ----------

  private formatSheet() {
    const app = this.app;
    const ed = () => app.editor.chain().focus();
    const tile = (label: string, cls: string, run: () => void, on: boolean) =>
      h('button', { type: 'button', class: `m-chip ${on ? 'on' : ''}`, onclick: () => { run(); refresh(); } }, h('span', { class: cls }, label));
    const body = h('div', { class: 'm-format' });
    const refresh = () => {
      const e = app.editor;
      const style = [1, 2, 3].map((l) => e.isActive('heading', { level: l })).indexOf(true) + 1;
      const styles = h('div', { class: 'm-chips' },
        tile('Normal', '', () => void ed().setParagraph().run(), !style && !e.isActive('blockquote') && !e.isActive('codeBlock')),
        tile('Título 1', 'st-h1', () => void ed().setHeading({ level: 1 }).run(), style === 1),
        tile('Título 2', 'st-h2', () => void ed().setHeading({ level: 2 }).run(), style === 2),
        tile('Título 3', 'st-h3', () => void ed().setHeading({ level: 3 }).run(), style === 3),
        tile('Cita', 'st-quote', () => void ed().toggleBlockquote().run(), e.isActive('blockquote')),
        tile('Código', 'st-code', () => void ed().toggleCodeBlock().run(), e.isActive('codeBlock')));

      const font = new FontPicker({
        title: 'Fuente', className: 'input m-fontpicker', allowDefault: true,
        onChange: (v) => { const f = findFont(v); if (f) void ed().setFontFamily(f.stack).run(); else void ed().unsetFontFamily().run(); },
      });
      font.value = (e.getAttributes('textStyle').fontFamily as string | undefined) ?? '';

      const size = h('div', { class: 'm-stepper' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Reducir tamaño', html: icon('minus', 18), onclick: () => { app.run('shrinkFont'); refresh(); } }),
        h('span', { class: 'm-stepper-v', 'aria-live': 'polite' }, `${String(app.currentFontSize()).replace('.', ',')} pt`),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Aumentar tamaño', html: icon('plus', 18), onclick: () => { app.run('growFont'); refresh(); } }));

      const swatches = (colors: string[], run: (c: string) => void, label: string) =>
        h('div', { class: 'm-swatches', role: 'group', 'aria-label': label },
          ...colors.map((c) => h('button', { type: 'button', class: 'm-swatch', style: { background: c }, 'aria-label': `${label} ${c}`, onclick: () => run(c) })));

      /** Fila de botones con icono (o texto) que se activan y desactivan. */
      const seg = (items: [string, string, () => void, boolean][]) =>
        h('div', { class: 'm-seg' }, ...items.map(([content, label, run, on]) =>
          h('button', { type: 'button', class: `icon-btn ${on ? 'on' : ''}`, title: label, 'aria-label': label, 'aria-pressed': String(on), html: content, onclick: () => { run(); refresh(); } })));
      const gly = (t: string, cls = '') => `<span class="rb-glyph ${cls}">${t}</span>`;
      const line = (e.getAttributes('paragraph').lineHeight ?? e.getAttributes('heading').lineHeight ?? null) as number | null;

      body.replaceChildren(
        h('div', { class: 'm-fgroup' }, h('span', { class: 'm-flabel' }, 'Estilo'), styles),
        h('div', { class: 'm-fgroup' }, h('span', { class: 'm-flabel' }, 'Fuente y tamaño'), h('div', { class: 'm-frow' }, font.el, size)),
        h('div', { class: 'm-fgroup' }, h('span', { class: 'm-flabel' }, 'Texto'),
          seg([
            [gly('abc', 'rb-s'), 'Tachado', () => app.run('strike'), e.isActive('strike')],
            [gly('x<sub>2</sub>'), 'Subíndice', () => app.run('subscript'), e.isActive('subscript')],
            [gly('x<sup>2</sup>'), 'Superíndice', () => app.run('superscript'), e.isActive('superscript')],
            [icon('eraser', 20), 'Borrar formato', () => app.run('clearMarks'), false],
          ])),
        h('div', { class: 'm-fgroup' }, h('span', { class: 'm-flabel' }, 'Color del texto'), swatches(COLORS, (c) => void ed().setColor(c).run(), 'Color')),
        h('div', { class: 'm-fgroup' }, h('span', { class: 'm-flabel' }, 'Resaltado'),
          swatches(HIGHLIGHTS, (c) => void ed().toggleHighlight({ color: c }).run(), 'Resaltado')),
        h('div', { class: 'm-fgroup' }, h('span', { class: 'm-flabel' }, 'Párrafo'),
          seg([
            [icon('alignLeft', 20), 'Izquierda', () => app.run('alignLeft'), e.isActive({ textAlign: 'left' })],
            [icon('alignCenter', 20), 'Centrar', () => app.run('alignCenter'), e.isActive({ textAlign: 'center' })],
            [icon('alignRight', 20), 'Derecha', () => app.run('alignRight'), e.isActive({ textAlign: 'right' })],
            [icon('alignJustify', 20), 'Justificar', () => app.run('alignJustify'), e.isActive({ textAlign: 'justify' })],
          ]),
          h('div', { class: 'm-chips' }, ...[null, 1, 1.15, 1.5, 2].map((v) =>
            h('button', { type: 'button', class: `m-chip ${line === v ? 'on' : ''}`, onclick: () => { void ed().setLineHeight(v).run(); refresh(); } }, v === null ? 'Interlineado: normal' : String(v).replace('.', ',')))))
      );
    };
    refresh();
    sheet('Formato', body, { tall: true });
  }

  // ---------- Hoja «+» ----------

  private insertSheet() {
    const app = this.app;
    const list = h('div', { class: 'm-actions' });
    const search = h('input', { class: 'm-search', type: 'search', placeholder: 'Buscar un bloque (tabla, cuadro, ecuación…)', 'aria-label': 'Buscar un bloque', autocomplete: 'off' });
    let handle: ReturnType<typeof sheet>;
    const draw = () => {
      const items = filterBlocks(search.value);
      let group = '';
      const rows: HTMLElement[] = [];
      for (const b of items) {
        if (b.group !== group) { group = b.group; rows.push(h('div', { class: 'm-section' }, group)); }
        rows.push(h('button', { type: 'button', class: 'm-action', onclick: () => { handle.close(); setTimeout(() => b.run(app.editor), 150); } },
          h('span', { class: 'm-action-ic', html: blockIconHTML(b, 20) }),
          h('span', { class: 'm-action-label' }, b.title, h('span', { class: 'm-action-sub' }, b.hint))));
      }
      if (!items.length) rows.push(h('p', { class: 'm-empty' }, 'Ningún bloque coincide.'));
      list.replaceChildren(...rows);
    };
    search.addEventListener('input', draw);
    draw();
    handle = sheet('Insertar', h('div', {}, h('div', { class: 'm-search-wrap' }, h('span', { html: icon('search', 18), 'aria-hidden': 'true' }), search), list), { tall: true });
  }
}
