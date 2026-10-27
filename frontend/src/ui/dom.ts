// Utilidades de interfaz sin dependencias: creación de nodos, diálogos,
// menús emergentes y avisos.
import { pushBack } from '../platform/back';
import { icon } from './icons';

type Attrs = Record<string, any>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') {
      // Las variables CSS (--c) solo se pueden poner con setProperty
      for (const [prop, val] of Object.entries(v as Record<string, string>)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, val); else (el.style as any)[prop] = val;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else if (k in el && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function iconButton(name: string, title: string, onClick: (e: MouseEvent) => void, extra: Attrs = {}) {
  return h('button', {
    class: 'icon-btn ' + (extra.class ?? ''), title, 'aria-label': title, html: icon(name),
    onmousedown: (e: MouseEvent) => e.preventDefault(), onclick: onClick, ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'class')),
  });
}

// ---------- Avisos ----------
let toastHost: HTMLElement | null = null;
export function toast(msg: string, opts: { kind?: 'ok' | 'error' | 'info'; action?: { label: string; run: () => void }; ms?: number } = {}) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const t = h('div', { class: `toast toast-${opts.kind ?? 'info'}` }, h('span', {}, msg));
  if (opts.action) {
    const a = opts.action;
    t.append(h('button', { class: 'toast-action', onclick: () => { a.run(); t.remove(); } }, a.label));
  }
  toastHost.append(t);
  setTimeout(() => t.classList.add('out'), opts.ms ?? 3200);
  setTimeout(() => t.remove(), (opts.ms ?? 3200) + 300);
}

// ---------- Diálogos ----------
export interface ModalButton { label: string; kind?: 'primary' | 'danger' | 'ghost'; value: any; disabled?: boolean }

const openModals: HTMLElement[] = [];
export function hasOpenModal() { return openModals.length > 0; }

export function modal<T = any>(title: string, body: Node, buttons: ModalButton[] = [{ label: 'Cerrar', value: null }], opts: { wide?: boolean; className?: string; onOpen?: (close: (v: T) => void) => void } = {}): Promise<T | null> {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const backdrop = h('div', { class: 'modal-backdrop' });
    // Confirmaciones y preguntas cortas: en el móvil son una hoja baja, no pantalla completa
    const small = body instanceof HTMLElement && body.matches('p.modal-text, label.field');
    const box = h('div', { class: `modal ${opts.wide ? 'modal-wide' : ''} ${small ? 'is-small' : ''} ${opts.className ?? ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    const unback = pushBack(() => close(null)); // el botón «atrás» de Android lo cierra
    const close = (v: any) => {
      unback();
      backdrop.remove();
      openModals.splice(openModals.indexOf(backdrop), 1);
      document.removeEventListener('keydown', onKey, true);
      prevFocus?.focus?.();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (openModals[openModals.length - 1] !== backdrop) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !e.shiftKey) {
        const primary = buttons.find((b) => b.kind === 'primary');
        if (primary && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); close(primary.value); }
      }
    };
    const head = h('div', { class: 'modal-head' }, h('h2', {}, title), iconButton('x', 'Cerrar (Esc)', () => close(null)));
    const foot = h('div', { class: 'modal-foot' }, ...buttons.map((b) =>
      h('button', { class: `btn ${b.kind ? 'btn-' + b.kind : ''}`, disabled: b.disabled, onclick: () => close(b.value) }, b.label)));
    box.append(head, h('div', { class: 'modal-body' }, body), ...(buttons.length ? [foot] : []));
    backdrop.append(box);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(null); });
    document.body.append(backdrop);
    openModals.push(backdrop);
    document.addEventListener('keydown', onKey, true);
    opts.onOpen?.(close);
    requestAnimationFrame(() => {
      const f = box.querySelector<HTMLElement>('[autofocus], input, textarea, select') ?? box.querySelector<HTMLElement>('.btn-primary');
      f?.focus();
      if (f instanceof HTMLInputElement) f.select();
    });
  });
}

export async function promptText(title: string, label: string, value = '', opts: { multiline?: boolean; placeholder?: string; ok?: string } = {}): Promise<string | null> {
  const input = opts.multiline
    ? h('textarea', { class: 'input', rows: 4, placeholder: opts.placeholder ?? '' })
    : h('input', { class: 'input', type: 'text', placeholder: opts.placeholder ?? '' });
  input.value = value;
  if (opts.multiline) {
    input.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' && (ke.ctrlKey || ke.metaKey)) (input.closest('.modal')?.querySelector('.btn-primary') as HTMLElement)?.click();
    });
  }
  const body = h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input);
  const ok = await modal<boolean>(title, body, [{ label: 'Cancelar', value: false, kind: 'ghost' }, { label: opts.ok ?? 'Aceptar', value: true, kind: 'primary' }]);
  return ok ? input.value : null;
}

export async function confirmDialog(title: string, message: string, ok = 'Aceptar', danger = false): Promise<boolean> {
  const r = await modal<boolean>(title, h('p', { class: 'modal-text' }, message), [
    { label: 'Cancelar', value: false, kind: 'ghost' },
    { label: ok, value: true, kind: danger ? 'danger' : 'primary' },
  ]);
  return !!r;
}

// ---------- Menús emergentes ----------
export interface MenuItem {
  label?: string;
  /** Nombre de un icono SVG. */
  icon?: string;
  /** HTML ya preparado para el icono (glifos como «H1»). */
  iconHTML?: string;
  hint?: string;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  heading?: string;
  html?: string;
  run?: () => void;
}

let openMenu: { el: HTMLElement; close: () => void } | null = null;

export function closeMenu() { openMenu?.close(); }

export function popupMenu(anchor: HTMLElement | DOMRect, items: MenuItem[], opts: { className?: string; align?: 'left' | 'right'; onClose?: () => void } = {}) {
  closeMenu();
  const el = h('div', { class: `popover menu ${opts.className ?? ''}`, role: 'menu' });
  for (const it of items) {
    if (it.separator) { el.append(h('div', { class: 'menu-sep' })); continue; }
    if (it.heading) { el.append(h('div', { class: 'menu-group' }, it.heading)); continue; }
    const b = h('button', {
      class: `menu-item ${it.danger ? 'danger' : ''} ${it.checked ? 'is-checked' : ''}`, role: 'menuitem', disabled: it.disabled,
      onmousedown: (e: MouseEvent) => e.preventDefault(),
      onclick: () => { close(); it.run?.(); },
    });
    if (it.html) b.innerHTML = it.html;
    else {
      b.append(
        h('span', { class: 'menu-icon', html: it.iconHTML ?? (it.icon ? icon(it.icon) : it.checked ? icon('check') : '') }),
        h('span', { class: 'menu-text' }, h('span', { class: 'menu-title' }, it.label ?? '')),
        ...(it.hint ? [h('kbd', {}, it.hint)] : []),
      );
    }
    el.append(b);
  }
  document.body.append(el);
  const unback = pushBack(close);
  const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
  const w = el.offsetWidth, hgt = el.offsetHeight;
  let left = opts.align === 'right' ? r.right - w : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  let top = r.bottom + 4;
  if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 4);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  const onDown = (e: MouseEvent) => { if (!el.contains(e.target as Node)) close(); };
  const onKey = (e: KeyboardEvent) => {
    const btns = Array.from(el.querySelectorAll<HTMLButtonElement>('.menu-item:not([disabled])'));
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
  };
  function close() {
    unback();
    el.remove();
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    if (openMenu?.el === el) openMenu = null;
    opts.onClose?.();
  }
  setTimeout(() => document.addEventListener('mousedown', onDown, true));
  document.addEventListener('keydown', onKey, true);
  openMenu = { el, close };
  return el;
}

/** Popover con contenido libre anclado a un elemento. */
export function popover(anchor: HTMLElement | DOMRect, content: HTMLElement, opts: { className?: string; onClose?: () => void } = {}) {
  closeMenu();
  const el = h('div', { class: `popover ${opts.className ?? ''}` }, content);
  document.body.append(el);
  const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
  const w = el.offsetWidth, hgt = el.offsetHeight;
  el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  let top = r.bottom + 6;
  if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 6);
  el.style.top = `${top}px`;
  const onDown = (e: MouseEvent) => { if (!el.contains(e.target as Node)) close(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  function close() {
    if (!el.isConnected) return;
    el.remove();
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    if (openMenu?.el === el) openMenu = null;
    opts.onClose?.();
  }
  setTimeout(() => document.addEventListener('mousedown', onDown, true));
  document.addEventListener('keydown', onKey, true);
  openMenu = { el, close };
  return { el, close };
}

export function debounce<A extends any[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...a: A) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function relTime(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 45) return 'hace un momento';
  if (diff < 3600) return `hace ${Math.round(diff / 60)} min`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const time = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  if (d >= today) return `hoy, ${time}`;
  const yest = new Date(today); yest.setDate(yest.getDate() - 1);
  if (d >= yest) return `ayer, ${time}`;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' }) + `, ${time}`;
}

export function escapeHTML(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
