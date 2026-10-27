// Selector de fuente con cada nombre escrito en su propia letra, agrupado como
// en Word. Sustituye a <select>, cuyas listas nativas (WebKitGTK, WebView2)
// ignoran la fuente de cada opción.
import { FONT_GROUPS, FONTS, findFont, primaryFamily } from '../fonts';
import { escapeHTML, h, popupMenu, type MenuItem } from './dom';
import { icon } from './icons';

export class FontPicker {
  readonly el: HTMLButtonElement;
  private label: HTMLElement;
  private current = '';

  constructor(private o: { title: string; className?: string; allowDefault?: boolean; onChange?: (name: string) => void }) {
    this.label = h('span', { class: 'fp-label' });
    this.el = h('button', {
      type: 'button', class: `fp-button ${o.className ?? ''}`, title: o.title, 'aria-label': o.title, 'aria-haspopup': 'menu',
      onmousedown: (e: MouseEvent) => e.preventDefault(), onclick: () => this.open(),
    }, this.label, h('span', { class: 'fp-caret', html: icon('chevronDown', 12) }));
    this.value = '';
  }

  /** Nombre de la fuente (vacío: predeterminada). Acepta también un font-family. */
  get value() { return this.current; }
  set value(v: string) {
    const f = findFont(v);
    this.current = f?.name ?? v;
    this.label.textContent = f?.name ?? (v ? primaryFamily(v) : 'Predeterminada');
    this.label.style.fontFamily = f?.stack ?? '';
  }

  open() {
    const item = (label: string, stack: string, checked: boolean, run: () => void): MenuItem => ({
      checked, run,
      html: `<span class="menu-icon">${checked ? icon('check') : ''}</span><span class="menu-title" style="font-family:${escapeHTML(stack)}">${escapeHTML(label)}</span>`,
    });
    const items: MenuItem[] = [];
    if (this.o.allowDefault) items.push(item('Predeterminada', '', !this.current, () => this.pick('')));
    for (const g of FONT_GROUPS) {
      items.push({ heading: g });
      for (const f of FONTS.filter((x) => x.group === g)) items.push(item(f.name, f.stack, f.name === this.current, () => this.pick(f.name)));
    }
    const menu = popupMenu(this.el, items, { className: 'menu-tall font-menu' });
    const sel = menu.querySelector<HTMLElement>('.is-checked');
    if (sel) {
      sel.scrollIntoView({ block: 'center' });
      sel.focus({ preventScroll: true });
    }
  }

  private pick(name: string) {
    this.value = name;
    this.o.onChange?.(name);
  }
}
