// Paleta rápida: abrir documentos (Ctrl+A / Ctrl+O), buscar comandos como el
// cuadro «Dígame» de Word (Alt+Q) e ir a un título (Ctrl+I / Ctrl+G).
import type { App } from '../app';
import { h, debounce, escapeHTML, relTime } from './dom';
import { api } from '../api';
import { SHORTCUTS } from '../shortcuts';
import { BLOCKS, fold, blockIconHTML } from '../editor/blocks';
import { icon as svg, docIcon } from './icons';
import { collectHeadings } from '../editor/extensions';
import { TEMPLATES } from '../templates';

type Mode = 'docs' | 'commands' | 'headings';
/** `icon` es HTML (SVG o glifo). */
interface Item { title: string; sub?: string; icon?: string; hint?: string; run: () => void }

export class Palette {
  private backdrop: HTMLElement | null = null;
  private input!: HTMLInputElement;
  private list!: HTMLElement;
  private items: Item[] = [];
  private index = 0;
  private mode: Mode = 'docs';
  private seq = 0;

  constructor(private app: App) {}

  open(mode: Mode) {
    this.close();
    this.mode = mode;
    const placeholder = {
      docs: 'Buscar en todos los documentos… (escribe «>» para comandos)',
      commands: 'Dígame qué quiere hacer… (p. ej. «interlineado», «tabla», «exportar»)',
      headings: 'Ir a un título del documento…',
    }[mode];
    this.input = h('input', { class: 'palette-input', placeholder, 'aria-label': placeholder, spellcheck: 'false' });
    this.list = h('div', { class: 'palette-list', role: 'listbox' });
    const box = h('div', { class: 'palette', role: 'dialog' }, this.input, this.list);
    this.backdrop = h('div', { class: 'modal-backdrop palette-backdrop', onmousedown: (e: MouseEvent) => { if (e.target === this.backdrop) this.close(); } }, box);
    document.body.append(this.backdrop);
    this.input.addEventListener('input', () => this.query());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.focus();
    void this.query();
  }

  close() {
    this.backdrop?.remove();
    this.backdrop = null;
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); this.app.editor.commands.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); this.index = Math.min(this.items.length - 1, this.index + 1); this.draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.index = Math.max(0, this.index - 1); this.draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); this.pick(this.items[this.index]); }
    e.stopPropagation();
  }

  private pick(it?: Item) {
    if (!it) return;
    this.close();
    it.run();
  }

  private query = debounce(async () => {
    const raw = this.input.value;
    const seq = ++this.seq;
    let mode = this.mode;
    let q = raw;
    if (mode === 'docs' && raw.startsWith('>')) { mode = 'commands'; q = raw.slice(1); }
    let items: Item[] = [];
    if (mode === 'commands') items = this.commandItems(q);
    else if (mode === 'headings') items = this.headingItems(q);
    else items = await this.docItems(q);
    if (seq !== this.seq || !this.backdrop) return;
    this.items = items;
    this.index = 0;
    this.draw();
  }, 60);

  private async docItems(q: string): Promise<Item[]> {
    const app = this.app;
    if (!q.trim()) {
      const recent = app.docs.filter((d) => !d.trashed).sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 12);
      return [
        ...recent.map((d) => ({ title: d.title || 'Sin título', icon: docIcon(d.icon, 16), sub: `Editado ${relTime(d.updated)}`, run: () => app.open(d.id) })),
        { title: 'Nuevo documento…', icon: svg('plus', 16), run: () => app.run('new') },
      ];
    }
    const hits = await api.Search(q);
    const items: Item[] = hits.map((hit) => ({ title: hit.title || 'Sin título', icon: docIcon(hit.icon, 16), sub: hit.snippet, run: () => app.open(hit.id) }));
    items.push({ title: `Crear «${q}»`, icon: svg('plus', 16), run: async () => {
      const m = await app.createFromJSON(q, '', TEMPLATES[0].content());
      await app.refreshDocs();
      await app.open(m.id);
    } });
    return items;
  }

  commandItems(q: string): Item[] {
    const terms = fold(q).split(/\s+/).filter(Boolean);
    const map = this.app.keymap;
    const all: (Item & { hay: string })[] = [
      ...SHORTCUTS.map((s) => ({ title: s.label, sub: s.group, hint: s[map][0], hay: fold(`${s.label} ${s.group}`), run: () => this.app.run(s.action) })),
      ...BLOCKS.map((b) => ({ title: `Insertar: ${b.title}`, sub: b.hint, icon: blockIconHTML(b, 16), hint: b.shortcut, hay: fold(`insertar ${b.title} ${b.keywords}`), run: () => b.run(this.app.editor) })),
      { title: 'Configurar página (márgenes, papel, encabezado)', sub: 'Diseño', hay: 'configurar pagina margenes papel orientacion encabezado pie numeros diseño', run: () => import('./dialogs').then((d) => d.pageSetupDialog(this.app)) },
      { title: 'Tutorial guiado de Folio', sub: 'Ayuda', hay: 'tutorial ayuda guia aprender primeros pasos recorrido', run: () => void this.app.startTour() },
      { title: 'Ajustes', sub: 'Aplicación', hay: 'ajustes preferencias configuracion tema oscuro atajos', run: () => import('./dialogs').then((d) => d.settingsDialog(this.app)) },
      { title: 'Sincronización en la nube', sub: 'Aplicación', hay: 'sincronizar sincronizacion nube nextcloud webdav google drive vincular dispositivos movil', run: () => import('../sync/syncsettings').then((m) => m.syncDialog(this.app)) },
      { title: 'Abrir la agenda', sub: 'Agenda', hay: 'agenda calendario tareas horario planificar estudio oposiciones', run: () => void this.app.setMode('agenda') },
      { title: 'Nueva tarea en la agenda', sub: 'Agenda', hay: 'nueva tarea agenda evento cita recordatorio', run: async () => { await this.app.setMode('agenda'); this.app.agenda.newTask(this.app.agenda.cursor); } },
      { title: 'Planificar estudio y repasos', sub: 'Agenda', hay: 'planificar plan repasos repeticion espaciada estudio oposiciones', run: async () => { await this.app.setMode('agenda'); await this.app.agenda.state.plan(); } },
      { title: 'Temario', sub: 'Agenda', hay: 'temario temas oposicion importar', run: async () => { await this.app.setMode('agenda'); const m = await import('../agenda/topics'); await m.topicsDialog(this.app.agenda, this.app); } },
      { title: 'Progreso del estudio', sub: 'Agenda', hay: 'progreso estadisticas horas racha seguimiento', run: async () => { await this.app.setMode('agenda'); const m = await import('../agenda/stats'); await m.statsDialog(this.app.agenda, this.app); } },
      { title: 'Tutorial de la agenda', sub: 'Ayuda', hay: 'tutorial agenda calendario aprender repaso', run: () => void this.app.startTour('agenda') },
      { title: 'Unir PDF', sub: 'Archivo', hay: 'unir juntar combinar fusionar pdf archivos', run: () => import('./pdfmerge').then((m) => m.pdfMergeDialog(this.app)) },
      { title: 'Importar documento (.docx, .md, .html)', sub: 'Archivo', hay: 'importar abrir word docx markdown', run: () => import('./dialogs').then((d) => d.importDialog(this.app)) },
      { title: 'Tema oscuro / claro', sub: 'Vista', hay: 'tema oscuro claro modo noche', run: () => this.app.setSetting('theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') },
    ];
    return (terms.length ? all.filter((i) => terms.every((t) => i.hay.includes(t))) : all).slice(0, 60);
  }

  private headingItems(q: string): Item[] {
    const t = fold(q);
    return collectHeadings(this.app.editor.state.doc)
      .filter((hd) => !t || fold(hd.text).includes(t))
      .map((hd) => ({ title: `${' '.repeat(hd.level - 1)}${hd.text}`, sub: `Título ${hd.level}`, run: () => this.app.scrollToPos(hd.pos) }));
  }

  private draw() {
    this.list.innerHTML = '';
    if (!this.items.length) {
      this.list.append(h('div', { class: 'palette-empty' }, 'Sin resultados'));
      return;
    }
    this.items.forEach((it, i) => {
      const row = h('button', { class: `palette-item ${i === this.index ? 'on' : ''}`, role: 'option', onmousedown: (e: MouseEvent) => e.preventDefault(), onclick: () => this.pick(it) },
        h('span', { class: 'palette-icon', html: it.icon ?? svg('chevronRight', 16) }),
        h('span', { class: 'palette-text' }, h('span', { class: 'palette-title', html: escapeHTML(it.title) }), it.sub ? h('span', { class: 'palette-sub' }, it.sub) : null),
        it.hint ? h('kbd', {}, it.hint) : null,
      );
      row.addEventListener('mousemove', () => { if (this.index !== i) { this.index = i; this.list.querySelectorAll('.palette-item').forEach((el, j) => el.classList.toggle('on', j === i)); } });
      this.list.append(row);
    });
    this.list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }
}
