import type { App } from '../app';
import type { Version } from '../types';
import { h, iconButton, relTime, modal, promptText, confirmDialog, toast, debounce, escapeHTML, popupMenu } from './dom';
import { icon } from './icons';
import { api } from '../api';
import { collectHeadings } from '../editor/extensions';
import { generateHTML } from '@tiptap/core';
import { schemaExtensions } from '../editor/editor';
import { TextSelection } from '@tiptap/pm/state';

type PanelId = 'outline' | 'comments' | 'versions';

const KIND_LABEL: Record<Version['kind'], string> = {
  created: 'Creación del documento', auto: 'Guardado automático', manual: 'Versión guardada', backup: 'Copia de seguridad',
};

interface CommentInfo { id: string; text: string; author: string; created: string; quote: string; from: number; to: number }

export class Panels {
  private el = document.getElementById('panel')!;
  private current: PanelId | null = null;
  private body = h('div', { class: 'panel-body' });
  private tabs = new Map<PanelId, HTMLButtonElement>();

  constructor(private app: App) {
    const tabs = h('div', { class: 'panel-tabs', role: 'tablist' });
    for (const [id, label] of [['outline', 'Esquema'], ['comments', 'Comentarios'], ['versions', 'Versiones']] as [PanelId, string][]) {
      const b = h('button', { class: 'panel-tab', role: 'tab', onclick: () => this.show(id) }, label);
      this.tabs.set(id, b);
      tabs.append(b);
    }
    this.el.append(h('div', { class: 'panel-head' }, tabs, iconButton('x', 'Cerrar panel', () => this.close())), this.body);
  }

  /** Panel abierto, o null. */
  get active() { return this.current; }

  toggle(id: PanelId) {
    if (this.current === id) this.close(); else this.show(id);
  }

  show(id: PanelId) {
    this.current = id;
    document.body.classList.add('panel-open');
    this.tabs.forEach((b, k) => b.classList.toggle('on', k === id));
    this.refresh();
  }

  close() {
    this.current = null;
    document.body.classList.remove('panel-open');
  }

  refresh() {
    if (!this.current) return;
    if (this.current === 'outline') this.renderOutline();
    if (this.current === 'comments') this.renderComments();
    if (this.current === 'versions') void this.renderVersions();
  }

  refreshVersions() { if (this.current === 'versions') void this.renderVersions(); }

  onDocChange = debounce(() => {
    if (this.current === 'outline') this.renderOutline();
    if (this.current === 'comments') this.renderComments();
  }, 300);

  onSelection() {
    if (this.current !== 'outline') return;
    const pos = this.app.editor.state.selection.from;
    let active: HTMLElement | null = null;
    this.body.querySelectorAll<HTMLElement>('.outline-item').forEach((el) => {
      el.classList.remove('on');
      if (Number(el.dataset.pos) <= pos) active = el;
    });
    (active as HTMLElement | null)?.classList.add('on');
  }

  // ---------- Esquema ----------
  private renderOutline() {
    const hs = collectHeadings(this.app.editor.state.doc);
    this.body.innerHTML = '';
    if (!hs.length) {
      this.body.append(h('p', { class: 'panel-empty' }, 'Sin títulos. Ctrl+Alt+1, 2 o 3, o «# » al principio de una línea.'));
      return;
    }
    for (const hd of hs) {
      this.body.append(h('button', {
        class: `outline-item ol-l${hd.level}`, dataset: { pos: String(hd.pos) },
        onclick: () => this.app.scrollToPos(hd.pos),
      }, hd.text));
    }
    this.onSelection();
  }

  // ---------- Comentarios ----------
  collectComments(): CommentInfo[] {
    const map = new Map<string, CommentInfo>();
    const { doc } = this.app.editor.state;
    doc.descendants((n, pos) => {
      if (!n.isText) return true;
      for (const m of n.marks) {
        if (m.type.name !== 'comment') continue;
        const id = m.attrs.id as string;
        const c = map.get(id);
        if (c) { c.to = pos + n.nodeSize; c.quote += n.text; }
        else map.set(id, { id, text: m.attrs.text, author: m.attrs.author, created: m.attrs.created, quote: n.text ?? '', from: pos, to: pos + n.nodeSize });
      }
      return true;
    });
    return [...map.values()];
  }

  private renderComments() {
    const list = this.collectComments();
    this.body.innerHTML = '';
    this.body.append(h('button', { class: 'btn btn-sm btn-block', onclick: () => this.app.run('comment') }, h('span', { html: icon('plus') }), 'Nuevo comentario sobre la selección'));
    if (!list.length) {
      this.body.append(h('p', { class: 'panel-empty' }, 'Sin comentarios. Selecciona texto y pulsa Ctrl+Alt+M.'));
      return;
    }
    for (const c of list) {
      const card = h('div', { class: 'comment-card' },
        h('button', { class: 'comment-quote', title: 'Ir al texto', onclick: () => this.select(c) }, `«${c.quote.slice(0, 80)}${c.quote.length > 80 ? '…' : ''}»`),
        h('div', { class: 'comment-text' }, c.text),
        h('div', { class: 'comment-meta' }, `${c.author || 'Yo'} · ${c.created ? relTime(c.created) : ''}`),
        h('div', { class: 'comment-actions' },
          h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => {
            const t = await promptText('Editar comentario', 'Comentario', c.text, { multiline: true });
            if (t === null) return;
            const { state } = this.app.editor;
            const tr = state.tr;
            state.doc.descendants((n, pos) => {
              for (const m of n.marks) {
                if (m.type.name === 'comment' && m.attrs.id === c.id) {
                  tr.removeMark(pos, pos + n.nodeSize, m).addMark(pos, pos + n.nodeSize, m.type.create({ ...m.attrs, text: t }));
                }
              }
            });
            this.app.editor.view.dispatch(tr);
          } }, 'Editar'),
          h('button', { class: 'btn btn-sm', onclick: () => this.app.editor.chain().removeComment(c.id).run() }, h('span', { html: icon('check', 14) }), 'Resolver'),
        ),
      );
      this.body.append(card);
    }
  }

  private select(c: CommentInfo) {
    const ed = this.app.editor;
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, c.from, c.to)).scrollIntoView());
    ed.commands.focus();
  }

  // ---------- Versiones ----------
  private async renderVersions() {
    const d = this.app.doc;
    if (!d) return;
    const body = this.body;
    let versions: Version[] = [];
    try { versions = await api.ListVersions(d.meta.id); } catch (e) { toast(String(e), { kind: 'error' }); }
    if (this.current !== 'versions') return;
    body.innerHTML = '';
    body.append(
      h('div', { class: 'versions-intro' },
        h('button', { class: 'btn btn-sm btn-primary btn-block', onclick: () => this.app.namedVersion() }, h('span', { html: icon('plus') }), 'Guardar versión ahora'),
        h('p', { class: 'muted small' }, `Se guarda una versión automática cada ${this.app.settings.autoVersionMinutes} minutos de edición y al cerrar. Las versiones con nombre nunca se borran.`)),
    );
    let day = '';
    for (const v of versions) {
      const dd = new Date(v.created).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
      if (dd !== day) { day = dd; body.append(h('div', { class: 'version-day' }, dd)); }
      const named = v.kind !== 'auto' && v.label;
      body.append(h('div', { class: `version-row kind-${v.kind}` },
        h('button', { class: 'version-main', onclick: () => this.preview(v) },
          h('span', { class: 'version-dot' }),
          h('span', { class: 'version-text' },
            h('span', { class: 'version-title' }, named ? v.label : (v.label || KIND_LABEL[v.kind])),
            h('span', { class: 'version-sub' }, `${new Date(v.created).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} · ${v.words} palabras${named ? ' · ' + KIND_LABEL[v.kind].toLowerCase() : ''}`)),
        ),
        iconButton('more', 'Opciones', (e) => this.versionMenu(v, e.currentTarget as HTMLElement)),
      ));
    }
  }

  private versionMenu(v: Version, anchor: HTMLElement) {
    const d = this.app.doc!;
    popupMenu(anchor, [
      { label: 'Ver y comparar', icon: 'search', run: () => this.preview(v) },
      { label: 'Restaurar esta versión', icon: 'restore', run: () => this.app.restoreVersion(v.id) },
      { label: 'Copiar como documento nuevo', icon: 'copy', run: async () => {
        const vd = await api.GetVersion(d.meta.id, v.id);
        const when = new Date(v.created).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
        const m = await this.app.createFromJSON(`${vd.title || d.meta.title} (versión ${when})`, d.meta.icon, vd.content, d.meta.parentId, vd.setup);
        await this.app.refreshDocs();
        await this.app.open(m.id);
      } },
      { label: v.label ? 'Renombrar…' : 'Poner nombre…', icon: 'outline', run: async () => {
        const t = await promptText('Nombre de la versión', 'Nombre', v.label);
        if (t !== null) { await api.RenameVersion(d.meta.id, v.id, t.trim()); this.refreshVersions(); }
      } },
      { separator: true },
      { label: 'Eliminar versión', icon: 'trash', danger: true, run: async () => {
        if (await confirmDialog('Eliminar versión', 'Esta versión se borrará del historial.', 'Eliminar', true)) {
          await api.DeleteVersion(d.meta.id, v.id);
          this.refreshVersions();
        }
      } },
    ], { align: 'right' });
  }

  private async preview(v: Version) {
    const d = this.app.doc;
    if (!d) return;
    await this.app.flush();
    const vd = await api.GetVersion(d.meta.id, v.id);
    const view = h('div', { class: 'version-preview doc-body prose-preview' });
    const render = () => { view.innerHTML = generateHTML(vd.content, schemaExtensions()); };
    const renderDiff = async () => {
      const { diffWordsWithSpace } = await import('diff');
      const now = this.app.editor.getText({ blockSeparator: '\n' });
      const parts = diffWordsWithSpace(vd.text, now);
      let added = 0, removed = 0;
      view.innerHTML = '<div class="diff">' + parts.map((p) => {
        const t = escapeHTML(p.value);
        if (p.added) { added += p.value.trim() ? p.value.trim().split(/\s+/).length : 0; return `<ins>${t}</ins>`; }
        if (p.removed) { removed += p.value.trim() ? p.value.trim().split(/\s+/).length : 0; return `<del>${t}</del>`; }
        return t;
      }).join('') + '</div>';
      stats.textContent = `Desde esta versión: +${added} palabras añadidas, −${removed} eliminadas`;
    };
    const stats = h('span', { class: 'muted small' });
    const toggle = h('div', { class: 'seg' },
      h('button', { class: 'seg-btn on', onclick: (e: MouseEvent) => { setSeg(e); render(); stats.textContent = ''; } }, 'Contenido'),
      h('button', { class: 'seg-btn', onclick: (e: MouseEvent) => { setSeg(e); void renderDiff(); } }, 'Cambios respecto a la actual'),
    );
    const setSeg = (e: MouseEvent) => {
      toggle.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('on'));
      (e.currentTarget as HTMLElement).classList.add('on');
    };
    render();
    const title = `${v.label || KIND_LABEL[v.kind]} · ${new Date(v.created).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}`;
    const r = await modal(title, h('div', { class: 'version-modal' }, h('div', { class: 'version-toolbar' }, toggle, stats), view), [
      { label: 'Cerrar', value: null, kind: 'ghost' },
      { label: 'Restaurar esta versión', value: 'restore', kind: 'primary' },
    ], { wide: true });
    if (r === 'restore') await this.app.restoreVersion(v.id);
  }
}
