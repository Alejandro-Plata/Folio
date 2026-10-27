// Pantalla «Documentos» del móvil: lista con buscador, navegación por niveles
// (los documentos anidados se abren como carpetas) y acciones con pulsación larga.
import type { App } from '../app';
import { TEMPLATES } from '../templates';
import type { Meta } from '../types';
import { pushBack } from '../platform/back';
import { h, relTime } from '../ui/dom';
import { docIcon, icon } from '../ui/icons';
import { actionSheet, sheet } from './sheet';
import type { MobileShell } from './shell';

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export class DocList {
  el = h('section', { class: 'm-screen m-docs', 'aria-label': 'Documentos' });
  /** Documentos por los que se ha entrado (niveles). */
  path: string[] = [];
  private query = '';
  private search = h('input', { class: 'm-search', type: 'search', placeholder: 'Buscar en los títulos', 'aria-label': 'Buscar documentos por título', autocomplete: 'off' });
  private list = h('div', { class: 'm-list', role: 'list' });

  constructor(private app: App, private shell: MobileShell) {
    this.search.addEventListener('input', () => { this.query = this.search.value; this.render(); });
    this.el.append(h('div', { class: 'm-search-wrap' }, h('span', { html: icon('search', 18), 'aria-hidden': 'true' }), this.search), this.list);
  }

  /** Título de la barra superior. */
  get title(): string {
    const id = this.path[this.path.length - 1];
    return id ? (this.app.docs.find((d) => d.id === id)?.title || 'Sin título') : 'Documentos';
  }

  enter(id: string) {
    this.path.push(id);
    pushBack(() => this.up());
    this.render();
    this.shell.renderBar();
  }

  up() {
    if (!this.path.length) return;
    this.path.pop();
    this.render();
    this.shell.renderBar();
  }

  /** Vuelve a la raíz (al cambiar de sección). */
  reset() { this.path = []; this.query = ''; this.search.value = ''; this.render(); }

  render() {
    const docs = this.app.docs.filter((d) => !d.trashed);
    const rows: HTMLElement[] = [];
    const q = fold(this.query.trim());
    if (q) {
      const hits = docs.filter((d) => fold(d.title).includes(q));
      rows.push(...hits.map((d) => this.row(d, docs, true)));
      if (!hits.length) rows.push(h('p', { class: 'm-empty' }, 'Ningún título coincide.'));
    } else {
      const parent = this.path[this.path.length - 1] ?? '';
      const cur = parent ? docs.find((d) => d.id === parent) : null;
      if (cur) rows.push(this.openRow(cur));
      if (!parent) {
        const favs = docs.filter((d) => d.favorite).sort((a, b) => a.order - b.order);
        if (favs.length) rows.push(h('div', { class: 'm-section' }, 'Favoritos'), ...favs.map((d) => this.row(d, docs)));
        rows.push(h('div', { class: 'm-section' }, 'Documentos'));
      }
      const kids = docs.filter((d) => d.parentId === parent).sort((a, b) => a.order - b.order);
      rows.push(...kids.map((d) => this.row(d, docs)));
      if (!kids.length && !cur) rows.push(h('p', { class: 'm-empty' }, 'Sin documentos. Toca + para crear uno.'));
    }
    this.list.replaceChildren(...rows);
  }

  private openRow(d: Meta): HTMLElement {
    return h('button', { type: 'button', class: 'm-row m-row-open', role: 'listitem', onclick: () => void this.shell.openDoc(d.id) },
      h('span', { class: 'm-row-ic', html: icon('arrowRight', 20) }),
      h('span', { class: 'm-row-main' }, h('span', { class: 'm-row-title' }, `Abrir «${d.title || 'Sin título'}»`)));
  }

  private row(d: Meta, all: Meta[], flat = false): HTMLElement {
    const hasKids = all.some((x) => x.parentId === d.id);
    const parent = flat && d.parentId ? all.find((x) => x.id === d.parentId) : null;
    const row = h('div', { class: 'm-row', role: 'listitem' });
    const main = h('button', { type: 'button', class: 'm-row-btn', 'aria-label': `${d.title || 'Sin título'}${hasKids ? ', con páginas dentro' : ''}` },
      h('span', { class: 'm-row-ic', html: docIcon(d.icon, 22) }),
      h('span', { class: 'm-row-main' },
        h('span', { class: 'm-row-title' }, d.title || 'Sin título'),
        h('span', { class: 'm-row-sub' }, `${parent ? `En «${parent.title || 'Sin título'}» · ` : ''}${relTime(d.updated)}${d.words ? ` · ${d.words} palabras` : ''}`)),
      d.favorite ? h('span', { class: 'm-row-fav', html: icon('star', 14), 'aria-label': 'Favorito' }) : null,
      hasKids ? h('span', { class: 'm-row-chev', html: icon('chevronRight', 18), 'aria-hidden': 'true' }) : null);
    // Un toque abre; con páginas dentro, entra en ellas. Pulsación larga: acciones
    let timer: ReturnType<typeof setTimeout> | undefined;
    let long = false;
    const cancel = () => clearTimeout(timer);
    main.addEventListener('pointerdown', () => {
      long = false;
      timer = setTimeout(() => { long = true; navigator.vibrate?.(15); this.actions(d); }, 500);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'pointermove'] as const) main.addEventListener(ev, cancel);
    main.addEventListener('contextmenu', (e) => { e.preventDefault(); });
    main.addEventListener('click', () => {
      if (long) { long = false; return; }
      if (hasKids && !flat) this.enter(d.id); else void this.shell.openDoc(d.id);
    });
    row.append(main, h('button', { type: 'button', class: 'icon-btn m-row-more', title: 'Más acciones', 'aria-label': `Más acciones de ${d.title || 'Sin título'}`, html: icon('more', 20), onclick: () => this.actions(d) }));
    return row;
  }

  /** Acciones de un documento. */
  actions(d: Meta) {
    const app = this.app;
    actionSheet(d.title || 'Sin título', [
      { label: 'Abrir', icon: 'file', run: () => void this.shell.openDoc(d.id) },
      { label: d.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos', icon: 'star', run: () => void app.updateMeta(d.id, { favorite: !d.favorite }) },
      { label: 'Añadir una página dentro', icon: 'plus', run: async () => { await app.newDoc(d.id); this.shell.afterOpen(); } },
      { label: 'Mover a…', icon: 'folder', run: () => this.moveTo(d) },
      { label: 'Duplicar', icon: 'copy', run: () => void app.duplicate(d.id) },
      { label: 'Mover a la papelera', icon: 'trash', danger: true, run: () => void app.trash(d.id) },
    ]);
  }

  private moveTo(d: Meta) {
    const app = this.app;
    const targets = app.docs.filter((x) => !x.trashed && x.id !== d.id && !app.isDescendant(x.id, d.id));
    const body = h('div', { class: 'm-actions' },
      d.parentId ? this.moveBtn('Al principio (sin carpeta)', 'home', d, '') : null,
      ...targets.map((t) => this.moveBtn(t.title || 'Sin título', t.icon, d, t.id)));
    const s = sheet(`Mover «${d.title || 'Sin título'}» a…`, body, { tall: true });
    body.addEventListener('click', () => s.close());
  }

  private moveBtn(label: string, ic: string, d: Meta, parentId: string) {
    return h('button', { type: 'button', class: 'm-action', onclick: () => void this.app.updateMeta(d.id, { parentId }) },
      h('span', { class: 'm-action-ic', html: docIcon(ic, 20) }), h('span', { class: 'm-action-label' }, label));
  }

  /** Hoja del botón +: documento en blanco o plantilla. */
  newDocSheet() {
    const app = this.app;
    const parent = this.path[this.path.length - 1] ?? '';
    actionSheet('Nuevo documento', TEMPLATES.map((t) => ({
      label: t.id === 'blank' ? 'Documento en blanco' : t.title, icon: t.icon, hint: t.id === 'blank' ? '' : undefined,
      run: async () => { await app.newDoc(parent, t); this.shell.afterOpen(); },
    })));
  }
}
