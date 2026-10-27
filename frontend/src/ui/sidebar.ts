import type { App } from '../app';
import type { Meta } from '../types';
import { h, iconButton, popupMenu, promptText, confirmDialog, relTime, modal } from './dom';
import { icon, docIcon } from './icons';
import { openBackstage } from './backstage';
import { api } from '../api';
import * as dialogs from './dialogs';

const EXPANDED_KEY = 'folio-expanded';

export class Sidebar {
  private el = document.getElementById('sidebar')!;
  private tree = h('div', { class: 'tree', role: 'tree' });
  private favs = h('div', { class: 'tree' });
  private favSection = h('div', { class: 'sb-section' });
  private expanded: Set<string>;
  private dragId: string | null = null;

  constructor(private app: App) {
    let saved: string[] = [];
    try { saved = JSON.parse(localStorage.getItem(EXPANDED_KEY) || '[]'); } catch { /* */ }
    this.expanded = new Set(saved);
    this.build();
    this.bindResizer();
  }

  private build() {
    const app = this.app;
    const k = app.keymap;
    const head = h('div', { class: 'sb-head' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, 'F'), h('span', {}, 'Folio')),
    );
    const nav = h('div', { class: 'sb-nav' },
      this.navItem('search', 'Buscar', k === 'es' ? 'Ctrl+A' : 'Ctrl+O', () => app.palette.open('docs')),
      this.navItem('template', 'Plantillas', '', () => openBackstage(app, 'new')),
      this.navItem('upload', 'Importar', '', () => dialogs.importDialog(app)),
      this.navItem('settings', 'Ajustes', '', () => dialogs.settingsDialog(app)),
    );
    this.favSection.replaceChildren(h('div', { class: 'sb-title' }, 'Favoritos'), this.favs);
    const docsTitle = h('div', { class: 'sb-title' }, h('span', {}, 'Documentos'),
      iconButton('plus', 'Nuevo documento', () => app.newDoc(), { class: 'sb-title-btn' }));
    // soltar en el título = mover a la raíz
    docsTitle.addEventListener('dragover', (e) => { if (this.dragId) { e.preventDefault(); docsTitle.classList.add('drop-inside'); } });
    docsTitle.addEventListener('dragleave', () => docsTitle.classList.remove('drop-inside'));
    docsTitle.addEventListener('drop', (e) => {
      e.preventDefault();
      docsTitle.classList.remove('drop-inside');
      if (this.dragId) void app.updateMeta(this.dragId, { parentId: '' });
    });
    const docsSection = h('div', { class: 'sb-section sb-grow' }, docsTitle, this.tree);
    const foot = h('div', { class: 'sb-foot' },
      this.navItem('plus', 'Nuevo documento', k === 'es' ? 'Ctrl+U' : 'Ctrl+N', () => app.run('new')),
      this.navItem('trash', 'Papelera', '', () => this.trashDialog()),
    );
    this.docsPart = h('div', { class: 'sb-part' }, nav, h('div', { class: 'sb-scroll' }, this.favSection, docsSection), foot);
    this.agendaPart = h('div', { class: 'sb-part sb-agenda', hidden: true });
    const modeBtn = (m: 'docs' | 'agenda', ic: string, label: string, key: string) => h('button', {
      type: 'button', role: 'tab', class: 'sb-mode', 'data-mode': m, title: `${label} (${key})`, onclick: () => app.setMode(m),
    }, h('span', { html: icon(ic, 15) }), label);
    this.modes = h('div', { class: 'sb-modes', role: 'tablist', 'aria-label': 'Espacio' },
      modeBtn('docs', 'docs', 'Documentos', 'Ctrl+Mayús+1'), modeBtn('agenda', 'calendar', 'Agenda', 'Ctrl+Mayús+2'));
    this.el.append(head, this.modes, this.docsPart, this.agendaPart);
    this.setMode(this.mode, this.agendaEl);
  }

  private docsPart!: HTMLElement;
  private agendaPart!: HTMLElement;
  private modes!: HTMLElement;
  private mode: 'docs' | 'agenda' = 'docs';
  private agendaEl?: HTMLElement;

  /** Muestra la parte del panel de Documentos o de la Agenda. */
  setMode(mode: 'docs' | 'agenda', agendaEl?: HTMLElement) {
    this.mode = mode;
    this.agendaEl = agendaEl ?? this.agendaEl;
    agendaEl = this.agendaEl;
    this.docsPart.hidden = mode !== 'docs';
    this.agendaPart.hidden = mode !== 'agenda';
    if (agendaEl && agendaEl.parentElement !== this.agendaPart) this.agendaPart.append(agendaEl);
    this.modes.querySelectorAll<HTMLElement>('.sb-mode').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
  }

  private navItem(ic: string, label: string, hint: string, run: () => void) {
    return h('button', { class: 'sb-item', onclick: run }, h('span', { class: 'sb-ic', html: icon(ic) }), h('span', { class: 'sb-label' }, label), hint ? h('kbd', {}, hint) : null);
  }

  /** Reconstruye el panel (por ejemplo al cambiar el mapa de atajos). */
  rebuild() {
    this.el.innerHTML = '';
    this.build();
    this.render();
  }

  expand(id: string) {
    this.expanded.add(id);
    this.persist();
  }

  private persist() {
    try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...this.expanded])); } catch { /* */ }
  }

  render() {
    this.app.mobile?.docList.render();
    const docs = this.app.docs.filter((d) => !d.trashed);
    const byParent = new Map<string, Meta[]>();
    for (const d of docs) {
      const pid = docs.some((x) => x.id === d.parentId) ? d.parentId : '';
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid)!.push(d);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.order - b.order || a.created.localeCompare(b.created));
    // asegura que el documento abierto es visible
    const cur = this.app.doc?.meta;
    if (cur) {
      let p = docs.find((x) => x.id === cur.parentId);
      while (p) { this.expanded.add(p.id); const pid = p.parentId; p = docs.find((x) => x.id === pid); }
    }
    this.tree.innerHTML = '';
    const walk = (pid: string, depth: number, into: HTMLElement) => {
      for (const d of byParent.get(pid) ?? []) {
        const kids = byParent.get(d.id) ?? [];
        into.append(this.row(d, depth, kids.length > 0));
        if (kids.length && this.expanded.has(d.id)) walk(d.id, depth + 1, into);
      }
    };
    walk('', 0, this.tree);
    if (!docs.length) this.tree.append(h('div', { class: 'sb-empty' }, 'Aún no hay documentos'));

    const favs = docs.filter((d) => d.favorite);
    this.favSection.hidden = !favs.length;
    this.favs.innerHTML = '';
    for (const f of favs) this.favs.append(this.row(f, 0, false, true));
  }

  private row(d: Meta, depth: number, hasKids: boolean, isFav = false) {
    const app = this.app;
    const open = this.expanded.has(d.id);
    const active = app.doc?.meta.id === d.id;
    const chevron = h('button', {
      class: `tree-chevron ${open ? 'open' : ''} ${hasKids ? '' : 'leaf'}`, html: icon('chevronRight', 14), tabindex: -1,
      title: open ? 'Contraer' : 'Expandir',
      onclick: (e: MouseEvent) => {
        e.stopPropagation();
        if (open) this.expanded.delete(d.id); else this.expanded.add(d.id);
        this.persist();
        this.render();
      },
    });
    const row = h('div', {
      class: `tree-row ${active ? 'active' : ''}`, role: 'treeitem', tabindex: 0, draggable: !isFav,
      style: { paddingLeft: `${8 + depth * 14}px` }, title: `${d.title || 'Sin título'}\nEditado ${relTime(d.updated)} · ${d.words} palabras`,
      onclick: () => app.open(d.id),
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') app.open(d.id); },
      oncontextmenu: (e: MouseEvent) => { e.preventDefault(); this.menu(d, new DOMRect(e.clientX, e.clientY, 0, 0)); },
    },
      isFav ? h('span', { class: 'tree-chevron leaf' }) : chevron,
      h('span', { class: 'tree-icon', html: docIcon(d.icon, 15) }),
      h('span', { class: 'tree-title' }, d.title || 'Sin título'),
      h('span', { class: 'tree-actions' },
        iconButton('more', 'Opciones', (e) => { e.stopPropagation(); this.menu(d, e.currentTarget as HTMLElement); }),
        isFav ? null : iconButton('plus', 'Añadir subpágina', (e) => { e.stopPropagation(); void app.newDoc(d.id); }),
      ),
    );
    if (!isFav) this.bindDrag(row, d);
    return row;
  }

  private bindDrag(row: HTMLElement, d: Meta) {
    row.addEventListener('dragstart', (e) => {
      this.dragId = d.id;
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData('text/plain', d.title);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => { this.dragId = null; row.classList.remove('dragging'); });
    const zone = (e: DragEvent) => {
      const r = row.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
    };
    const clear = () => row.classList.remove('drop-before', 'drop-after', 'drop-inside');
    row.addEventListener('dragover', (e) => {
      if (!this.dragId || this.dragId === d.id || this.app.isDescendant(d.id, this.dragId)) return;
      e.preventDefault();
      clear();
      row.classList.add(`drop-${zone(e)}`);
    });
    row.addEventListener('dragleave', clear);
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      clear();
      const id = this.dragId;
      if (!id || id === d.id || this.app.isDescendant(d.id, id)) return;
      const z = zone(e);
      if (z === 'inside') {
        this.expand(d.id);
        await this.app.updateMeta(id, { parentId: d.id });
        return;
      }
      const siblings = this.app.docs.filter((x) => !x.trashed && x.parentId === d.parentId && x.id !== id).sort((a, b) => a.order - b.order);
      const i = siblings.findIndex((x) => x.id === d.id);
      const neighbor = z === 'before' ? siblings[i - 1] : siblings[i + 1];
      const order = neighbor ? (d.order + neighbor.order) / 2 : d.order + (z === 'before' ? -1 : 1);
      await this.app.updateMeta(id, { parentId: d.parentId, order });
    });
  }

  private menu(d: Meta, anchor: HTMLElement | DOMRect) {
    const app = this.app;
    popupMenu(anchor, [
      { label: 'Abrir', icon: 'file', run: () => app.open(d.id) },
      { label: 'Añadir subpágina', icon: 'plus', run: () => app.newDoc(d.id) },
      { label: d.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos', icon: 'star', run: () => app.updateMeta(d.id, { favorite: !d.favorite }) },
      { label: 'Cambiar icono…', icon: 'art', run: () => dialogs.iconPicker(app, d.id, anchor instanceof HTMLElement ? anchor : this.el) },
      { label: 'Renombrar…', icon: 'outline', run: async () => {
        const t = await promptText('Renombrar', 'Título', d.title);
        if (t !== null) {
          await app.updateMeta(d.id, { title: t });
          if (app.doc?.meta.id === d.id) app.view.showDoc(app.doc);
        }
      } },
      { label: 'Duplicar', icon: 'copy', run: () => app.duplicate(d.id) },
      { label: 'Mover a la raíz', icon: 'folder', disabled: !d.parentId, run: () => app.updateMeta(d.id, { parentId: '' }) },
      { separator: true },
      { label: 'Mover a la papelera', icon: 'trash', danger: true, run: () => app.trash(d.id) },
    ]);
  }

  async trashDialog() {
    const app = this.app;
    const list = h('div', { class: 'trash-list' });
    const draw = async () => {
      await app.refreshDocs();
      const items = app.docs.filter((d) => d.trashed && !app.docs.find((p) => p.id === d.parentId && p.trashed));
      list.innerHTML = '';
      if (!items.length) { list.append(h('p', { class: 'muted' }, 'La papelera está vacía.')); return; }
      for (const d of items) {
        list.append(h('div', { class: 'trash-row' },
          h('span', { class: 'tree-icon', html: docIcon(d.icon, 15) }),
          h('span', { class: 'trash-title' }, d.title || 'Sin título', h('small', {}, ` · editado ${relTime(d.updated)}`)),
          h('button', { class: 'btn btn-sm', onclick: async () => { await api.RestoreDoc(d.id); await draw(); } }, 'Restaurar'),
          h('button', { class: 'btn btn-sm btn-danger-ghost', onclick: async () => {
            if (await confirmDialog('Eliminar definitivamente', `«${d.title || 'Sin título'}», sus subpáginas y todo su historial se borrarán para siempre.`, 'Eliminar', true)) {
              await api.DeleteDoc(d.id); await draw();
            }
          } }, 'Eliminar'),
        ));
      }
    };
    await draw();
    const r = await modal('Papelera', list, [
      { label: 'Vaciar papelera', kind: 'danger', value: 'empty' },
      { label: 'Cerrar', kind: 'primary', value: null },
    ]);
    if (r === 'empty' && await confirmDialog('Vaciar papelera', 'Se eliminarán definitivamente todos los documentos de la papelera.', 'Vaciar', true)) {
      await api.EmptyTrash();
      await app.refreshDocs();
    }
  }

  private bindResizer() {
    const handle = document.getElementById('sidebar-resizer')!;
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const move = (ev: PointerEvent) => {
        const w = Math.max(200, Math.min(480, ev.clientX));
        document.documentElement.style.setProperty('--sidebar-w', `${w}px`);
        this.app.settings.sidebarWidth = w;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.classList.remove('resizing');
        this.app.persistSettings();
      };
      document.body.classList.add('resizing');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    handle.addEventListener('dblclick', () => this.app.run('sidebar'));
  }
}
