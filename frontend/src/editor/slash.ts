// Menú "/" al estilo Notion para insertar bloques escribiendo.
import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { filterBlocks, blockIconHTML, type BlockItem } from './blocks';

export const Slash = Extension.create({
  name: 'slash',
  addProseMirrorPlugins() {
    return [Suggestion<BlockItem>({
      editor: this.editor,
      pluginKey: new PluginKey('slash'),
      char: '/',
      allowSpaces: true,
      startOfLine: false,
      allow: ({ state, range }) => {
        const $from = state.doc.resolve(range.from);
        if ($from.parent.type.name === 'codeBlock') return false;
        // solo al principio de línea o tras un espacio, para no estorbar en "km/h"
        const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, undefined, ' ');
        return before === '' || before === ' ';
      },
      items: ({ query }) => (query.length > 24 ? [] : filterBlocks(query).slice(0, 40)),
      command: ({ editor, range, props }) => {
        editor.chain().focus().deleteRange(range).run();
        props.run(editor);
      },
      render: () => {
        let el: HTMLDivElement | null = null;
        let items: BlockItem[] = [];
        let index = 0;
        let pick: (item: BlockItem) => void = () => {};

        const draw = () => {
          if (!el) return;
          el.innerHTML = '';
          if (!items.length) {
            el.innerHTML = '<div class="menu-empty">Sin resultados</div>';
            return;
          }
          let group = '';
          items.forEach((it, i) => {
            if (it.group !== group) {
              group = it.group;
              const g = document.createElement('div');
              g.className = 'menu-group';
              g.textContent = group;
              el!.append(g);
            }
            const row = document.createElement('button');
            row.className = 'menu-item' + (i === index ? ' is-active' : '');
            row.innerHTML = `<span class="menu-icon"></span><span class="menu-text"><span class="menu-title"></span><span class="menu-hint"></span></span><kbd></kbd>`;
            row.querySelector('.menu-icon')!.innerHTML = blockIconHTML(it);
            row.querySelector('.menu-title')!.textContent = it.title;
            row.querySelector('.menu-hint')!.textContent = it.hint;
            row.querySelector('kbd')!.textContent = it.shortcut ?? '';
            row.addEventListener('mousedown', (e) => { e.preventDefault(); pick(it); });
            row.addEventListener('mousemove', () => { if (index !== i) { index = i; draw(); } });
            el!.append(row);
          });
          el.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
        };

        const place = (rect: DOMRect | null) => {
          if (!el || !rect) return;
          const h = Math.min(360, el.scrollHeight);
          const below = rect.bottom + 6 + h < window.innerHeight;
          el.style.left = `${Math.min(rect.left, window.innerWidth - 330)}px`;
          el.style.top = below ? `${rect.bottom + 6}px` : `${rect.top - h - 6}px`;
        };

        return {
          onStart: (props) => {
            el = document.createElement('div');
            el.className = 'popover slash-menu';
            document.body.append(el);
            items = props.items;
            index = 0;
            pick = (it) => props.command(it);
            draw();
            place(props.clientRect?.() ?? null);
          },
          onUpdate: (props) => {
            items = props.items;
            index = 0;
            pick = (it) => props.command(it);
            draw();
            place(props.clientRect?.() ?? null);
          },
          onKeyDown: ({ event }) => {
            if (event.key === 'ArrowDown') { index = (index + 1) % Math.max(1, items.length); draw(); return true; }
            if (event.key === 'ArrowUp') { index = (index - 1 + items.length) % Math.max(1, items.length); draw(); return true; }
            if (event.key === 'Enter' || event.key === 'Tab') {
              if (items[index]) { pick(items[index]); return true; }
              return false;
            }
            if (event.key === 'Escape') { el?.remove(); el = null; return true; }
            return false;
          },
          onExit: () => { el?.remove(); el = null; },
        };
      },
    })];
  },
});
