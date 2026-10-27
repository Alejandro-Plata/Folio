// Pantalla «Buscar» del móvil: busca dentro de todos los documentos (sin
// distinguir tildes) y entre las acciones de Folio.
import type { App } from '../app';
import { api } from '../api';
import { debounce, h } from '../ui/dom';
import { docIcon, icon } from '../ui/icons';
import type { MobileShell } from './shell';

export class SearchScreen {
  el = h('section', { class: 'm-screen m-search-screen', 'aria-label': 'Buscar' });
  private input = h('input', { class: 'm-search', type: 'search', placeholder: 'Buscar en tus documentos y acciones', 'aria-label': 'Buscar', autocomplete: 'off' });
  private results = h('div', { class: 'm-list', 'aria-live': 'polite' });
  private seq = 0;

  constructor(private app: App, private shell: MobileShell) {
    this.el.append(h('div', { class: 'm-search-wrap' }, h('span', { html: icon('search', 18), 'aria-hidden': 'true' }), this.input), this.results);
    this.input.addEventListener('input', debounce(() => void this.run(), 150));
  }

  focus() { setTimeout(() => this.input.focus(), 50); }

  reset() { this.input.value = ''; this.results.replaceChildren(h('p', { class: 'm-empty' }, 'Busca en el texto de todos los documentos y entre las acciones.')); }

  private async run() {
    const q = this.input.value.trim();
    const seq = ++this.seq;
    if (!q) { this.reset(); return; }
    const [hits] = await Promise.all([api.Search(q).catch(() => [])]);
    if (seq !== this.seq) return;
    const cmds = this.app.palette.commandItems(q).slice(0, 8);
    const rows: HTMLElement[] = [];
    if (hits.length) {
      rows.push(h('div', { class: 'm-section' }, 'En tus documentos'));
      for (const hit of hits) {
        rows.push(h('button', { type: 'button', class: 'm-row m-row-btn', onclick: () => void this.shell.openDoc(hit.id) },
          h('span', { class: 'm-row-ic', html: docIcon(hit.icon, 22) }),
          h('span', { class: 'm-row-main' }, h('span', { class: 'm-row-title' }, hit.title || 'Sin título'), h('span', { class: 'm-row-sub' }, hit.snippet))));
      }
    }
    if (cmds.length) {
      rows.push(h('div', { class: 'm-section' }, 'Acciones'));
      for (const c of cmds) {
        rows.push(h('button', { type: 'button', class: 'm-row m-row-btn', onclick: () => c.run() },
          h('span', { class: 'm-row-ic', html: icon('sparkles', 20) }),
          h('span', { class: 'm-row-main' }, h('span', { class: 'm-row-title' }, c.title), c.sub ? h('span', { class: 'm-row-sub' }, c.sub) : null)));
      }
    }
    if (!rows.length) rows.push(h('p', { class: 'm-empty' }, 'No hay resultados.'));
    this.results.replaceChildren(...rows);
  }
}
