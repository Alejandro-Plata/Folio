// Piezas comunes de la cuenta y los círculos.
import type { Profile } from '../types';
import { h } from '../ui/dom';

export const COLORS = ['#2f74c0', '#16a085', '#27ae60', '#d4ac0d', '#e67e22', '#c0392b', '#c2185b', '#7d3c98', '#1f3a93', '#6d4c41'];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function avatar(p: Pick<Profile, 'name' | 'email' | 'color'>, small = false): HTMLElement {
  const name = p.name || p.email || '?';
  return h('span', { class: `so-avatar ${small ? 'is-sm' : ''}`, style: { '--c': p.color || '#2f74c0' }, title: name, 'aria-hidden': 'true' }, initials(name));
}

/** Selector de color: devuelve el elemento y una función para leer el elegido. */
export function colorPicker(value: string, label: string): { el: HTMLElement; get: () => string } {
  let current = COLORS.includes(value) ? value : COLORS[0];
  const el = h('div', { class: 'so-colors', role: 'radiogroup', 'aria-label': label });
  const draw = () => el.replaceChildren(...COLORS.map((c) => h('button', {
    type: 'button', class: `so-color ${c === current ? 'on' : ''}`, style: { '--c': c }, role: 'radio', 'aria-checked': String(c === current), 'aria-label': `Color ${c}`,
    onclick: () => { current = c; draw(); },
  })));
  draw();
  return { el, get: () => current };
}

export const field = (label: string, input: HTMLElement, hint?: string) =>
  h('label', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, label), input, hint ? h('span', { class: 'muted small' }, hint) : null);

/** Logotipo de Google (colores oficiales, para el botón «Continuar con Google»). */
export const GOOGLE_LOGO = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.5 5.8c4.4-4 6.8-10 6.8-17.3z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';
