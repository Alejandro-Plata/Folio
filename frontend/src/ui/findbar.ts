import type { App } from '../app';
import { h, iconButton, toast } from './dom';
import { clearFind, findNext, findPrev, getFind, replaceAll, replaceCurrent, setFind } from '../editor/find';

export class FindBar {
  private el = document.getElementById('findbar')!;
  private q = h('input', { class: 'input input-sm', placeholder: 'Buscar en el documento', 'aria-label': 'Buscar' });
  private r = h('input', { class: 'input input-sm', placeholder: 'Reemplazar con', 'aria-label': 'Reemplazar con' });
  private count = h('span', { class: 'find-count' });
  private caseBox = h('input', { type: 'checkbox' });
  private wordBox = h('input', { type: 'checkbox' });
  private replaceRow: HTMLElement;
  private stepped = false;

  constructor(private app: App) {
    this.el.className = 'findbar';
    this.el.hidden = true;
    const row1 = h('div', { class: 'find-row' }, this.q, this.count,
      iconButton('chevronDown', 'Anterior (Mayús+Intro)', () => this.go(-1), { class: 'flip' }),
      iconButton('chevronDown', 'Siguiente (Intro)', () => this.go(1)),
      iconButton('x', 'Cerrar (Esc)', () => this.close()));
    this.replaceRow = h('div', { class: 'find-row' }, this.r,
      h('button', { class: 'btn btn-sm', onclick: () => this.replaceOne() }, 'Reemplazar'),
      h('button', { class: 'btn btn-sm', onclick: () => this.replaceAll() }, 'Todo'));
    const opts = h('div', { class: 'find-opts' },
      h('label', {}, this.caseBox, 'Mayúsculas/minúsculas'),
      h('label', {}, this.wordBox, 'Palabras completas'));
    this.el.append(row1, this.replaceRow, opts);

    const update = () => {
      this.stepped = false;
      setFind(app.editor, { query: this.q.value, caseSensitive: this.caseBox.checked, wholeWord: this.wordBox.checked });
      this.updateCount();
    };
    this.q.addEventListener('input', update);
    this.caseBox.addEventListener('change', update);
    this.wordBox.addEventListener('change', update);
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'Enter' && e.target === this.q) { e.preventDefault(); this.go(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Enter' && e.target === this.r) { e.preventDefault(); if (e.ctrlKey) this.replaceAll(); else this.replaceOne(); }
    };
    this.q.addEventListener('keydown', keys);
    this.r.addEventListener('keydown', keys);
    app.editor.on('transaction', () => { if (!this.el.hidden) this.updateCount(); });
  }

  open(withReplace: boolean) {
    this.el.hidden = false;
    this.replaceRow.hidden = !withReplace;
    const { from, to } = this.app.editor.state.selection;
    const sel = this.app.editor.state.doc.textBetween(from, to, ' ');
    if (sel && sel.length < 80 && !sel.includes('\n')) this.q.value = sel;
    this.q.focus();
    this.q.select();
    setFind(this.app.editor, { query: this.q.value, caseSensitive: this.caseBox.checked, wholeWord: this.wordBox.checked });
    this.updateCount();
  }

  close() {
    if (this.el.hidden) return;
    this.el.hidden = true;
    clearFind(this.app.editor);
    this.app.editor.view.focus();
  }

  private go(dir: 1 | -1) {
    const st = getFind(this.app.editor);
    if (!st.results.length) return;
    // La primera vez se selecciona la coincidencia resaltada, sin saltar.
    if (!this.stepped) {
      this.stepped = true;
      if (dir > 0) { findPrev(this.app.editor); findNext(this.app.editor); }
      else findPrev(this.app.editor);
    } else if (dir > 0) findNext(this.app.editor); else findPrev(this.app.editor);
    this.updateCount();
  }

  private replaceOne() {
    if (!getFind(this.app.editor).results.length) return;
    replaceCurrent(this.app.editor, this.r.value);
    this.updateCount();
  }

  private replaceAll() {
    const n = replaceAll(this.app.editor, this.r.value);
    toast(n ? `Se han reemplazado ${n} coincidencias` : 'No hay coincidencias', { kind: n ? 'ok' : 'info' });
    this.updateCount();
  }

  private updateCount() {
    const st = getFind(this.app.editor);
    this.count.textContent = st.query ? (st.results.length ? `${st.index + 1} de ${st.results.length}` : 'Sin resultados') : '';
  }
}
