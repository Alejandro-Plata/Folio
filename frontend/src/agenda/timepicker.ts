// Selectores de hora y de duración de la agenda. Se escribe como resulte más
// cómodo («9», «930», «9:30», «9 y media») y se normaliza al salir. Las flechas
// suben o bajan una hora (Mayús: 5 min, Ctrl: 15 min). Encima aparecen hasta
// tres sugerencias según las últimas acciones (Alt+1/2/3).
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import { duration, hhmm, minutesOf, timeLabel } from './dates';
import { parseDuration, parseTime } from './time';

interface FieldBase<T> {
  el: HTMLElement;
  input: HTMLInputElement;
  get value(): T;
  set value(v: T);
  setSuggestions(list: T[]): void;
}

let openList: { el: HTMLElement; close: () => void } | null = null;
function closeList() { openList?.close(); }

function dropdown(anchor: HTMLElement, content: HTMLElement) {
  closeList();
  const el = h('div', { class: 'popover tf-list' }, content);
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8))}px`;
  const below = r.bottom + 4 + el.offsetHeight < window.innerHeight;
  el.style.top = `${below ? r.bottom + 4 : Math.max(8, r.top - el.offsetHeight - 4)}px`;
  const onDown = (e: MouseEvent) => { if (!el.contains(e.target as Node) && !anchor.contains(e.target as Node)) close(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); anchor.querySelector('input')?.focus(); } };
  function close() {
    el.remove();
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    if (openList?.el === el) openList = null;
  }
  setTimeout(() => document.addEventListener('mousedown', onDown, true));
  document.addEventListener('keydown', onKey, true);
  openList = { el, close };
  return el;
}

function chips<T>(label: (v: T) => string, apply: (v: T) => void, fieldLabel: string) {
  const box = h('div', { class: 'tf-chips', role: 'group', 'aria-label': `Sugerencias para ${fieldLabel}` });
  const set = (list: T[]) => {
    box.replaceChildren(...list.slice(0, 3).map((v, i) =>
      h('button', { type: 'button', class: 'tf-chip', title: `Usar ${label(v)} (Alt+${i + 1})`, onclick: () => apply(v) }, label(v))));
    box.hidden = !list.length;
  };
  return { box, set };
}

/** Campo de hora «HH:MM» (vacío permitido si `allowEmpty`: tarea sin hora). */
export function timeField(opts: { label: string; value?: string; suggestions?: string[]; allowEmpty?: boolean; onChange?: (v: string) => void; compact?: boolean }): FieldBase<string> {
  let value = opts.value ?? '';
  const input = h('input', { class: 'input input-sm tf-input', 'aria-label': opts.label, placeholder: opts.allowEmpty ? 'Sin hora' : '9:30', autocomplete: 'off', spellcheck: 'false' });
  const hint = h('span', { class: 'tf-hint', 'aria-live': 'polite' });
  const show = () => { input.value = timeLabel(value); input.removeAttribute('aria-invalid'); hint.textContent = ''; };
  const set = (v: string, notify = true) => {
    value = v;
    show();
    if (notify) opts.onChange?.(value);
  };
  const commit = () => {
    const raw = input.value.trim();
    if (!raw) { if (opts.allowEmpty) set(''); else show(); return; }
    const t = parseTime(raw);
    if (t) set(t);
    else { input.setAttribute('aria-invalid', 'true'); hint.textContent = 'Escribe por ejemplo 9, 930 o 9:30'; }
  };
  const step = (delta: number) => {
    const cur = minutesOf(parseTime(input.value) ?? value);
    set(hhmm((cur < 0 ? 9 * 60 : cur) + delta));
  };
  const sugg = chips<string>((v) => timeLabel(v), (v) => { set(v); input.focus(); }, opts.label);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' ? 1 : -1;
      step(dir * (e.shiftKey ? 5 : e.ctrlKey ? 15 : 60));
    } else if (e.key === 'Enter') commit();
    else if (e.altKey && /^[1-3]$/.test(e.key)) {
      const chip = sugg.box.children[Number(e.key) - 1] as HTMLButtonElement | undefined;
      if (chip) { e.preventDefault(); e.stopPropagation(); chip.click(); }
    }
  });
  input.addEventListener('blur', commit);
  const openBtn = h('button', { type: 'button', class: 'icon-btn tf-open', title: 'Elegir hora', 'aria-label': `Elegir ${opts.label}`, html: icon('clock', 15) });
  openBtn.addEventListener('click', () => {
    const cur = minutesOf(value);
    const hours = h('div', { class: 'tf-hours', role: 'listbox', 'aria-label': 'Horas' });
    const mins = h('div', { class: 'tf-mins', role: 'listbox', 'aria-label': 'Minutos' });
    const drawMins = (hr: number) => {
      mins.replaceChildren(...[0, 15, 30, 45].map((m) =>
        h('button', { type: 'button', class: `tf-opt ${cur === hr * 60 + m ? 'on' : ''}`, onclick: () => { set(hhmm(hr * 60 + m)); closeList(); input.focus(); } }, `${hr}:${String(m).padStart(2, '0')}`)));
    };
    for (let hr = 6; hr < 30; hr++) {
      const hh = hr % 24;
      hours.append(h('button', {
        type: 'button', class: `tf-opt ${cur >= 0 && Math.floor(cur / 60) === hh ? 'on' : ''}`, title: `${hh}:00 (clic) · elige minutos debajo`,
        onclick: () => { set(hhmm(hh * 60)); drawMins(hh); },
        ondblclick: () => { closeList(); input.focus(); },
      }, String(hh)));
    }
    drawMins(cur >= 0 ? Math.floor(cur / 60) : 9);
    const list = dropdown(row, h('div', {},
      opts.allowEmpty ? h('button', { type: 'button', class: 'tf-opt tf-none', onclick: () => { set(''); closeList(); input.focus(); } }, 'Sin hora') : null,
      h('div', { class: 'tf-sub' }, 'Hora en punto'), hours, h('div', { class: 'tf-sub' }, 'Minutos'), mins));
    (list.querySelector('.tf-hours .on') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
  });
  const row = h('div', { class: 'tf-row' }, input, openBtn);
  const el = h('div', { class: `tf ${opts.compact ? 'tf-compact' : ''}` }, sugg.box, row, hint);
  sugg.set(opts.suggestions ?? []);
  show();
  return {
    el, input,
    get value() { commit(); return value; },
    set value(v: string) { set(v, false); },
    setSuggestions: (l) => sugg.set(l),
  };
}

/** Campo de duración en minutos: del 1 al 9 son horas, desde 10 son minutos. */
export function durationField(opts: { label: string; value?: number; suggestions?: number[]; onChange?: (v: number) => void; allowEmpty?: boolean }): FieldBase<number> {
  let value = opts.value ?? 0;
  const input = h('input', { class: 'input input-sm tf-input', 'aria-label': opts.label, placeholder: opts.allowEmpty ? 'Sin duración' : '50 min', autocomplete: 'off', spellcheck: 'false', title: 'Del 1 al 9 son horas (2 → 2 h); desde 10, minutos (45 → 45 min). También 1h30 o 1:30.' });
  const hint = h('span', { class: 'tf-hint', 'aria-live': 'polite' });
  const show = () => { input.value = value ? duration(value) : ''; input.removeAttribute('aria-invalid'); hint.textContent = ''; };
  const set = (v: number, notify = true) => { value = Math.max(0, Math.min(24 * 60, Math.round(v))); show(); if (notify) opts.onChange?.(value); };
  const commit = () => {
    const raw = input.value.trim();
    if (!raw) { if (opts.allowEmpty) set(0); else show(); return; }
    if (/^\+\s*\d+$/.test(raw)) { set(value + Number(raw.replace(/\D/g, ''))); return; }
    const n = parseDuration(raw);
    if (n) set(n);
    else { input.setAttribute('aria-invalid', 'true'); hint.textContent = 'Escribe por ejemplo 45, 2 o 1h30'; }
  };
  const sugg = chips<number>((v) => duration(v), (v) => { set(v); input.focus(); }, opts.label);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' ? 1 : -1;
      set(Math.max(5, (parseDuration(input.value) ?? value) + dir * (e.shiftKey ? 5 : 15)));
    } else if (e.key === 'Enter') commit();
    else if (e.altKey && /^[1-3]$/.test(e.key)) {
      const chip = sugg.box.children[Number(e.key) - 1] as HTMLButtonElement | undefined;
      if (chip) { e.preventDefault(); e.stopPropagation(); chip.click(); }
    }
  });
  input.addEventListener('blur', commit);
  const openBtn = h('button', { type: 'button', class: 'icon-btn tf-open', title: 'Elegir duración', 'aria-label': `Elegir ${opts.label}`, html: icon('chevronDown', 15) });
  openBtn.addEventListener('click', () => {
    const list = h('div', { class: 'tf-durs', role: 'listbox' }, ...[15, 25, 30, 45, 50, 60, 75, 90, 120, 150, 180, 240].map((m) =>
      h('button', { type: 'button', class: `tf-opt ${m === value ? 'on' : ''}`, onclick: () => { set(m); closeList(); input.focus(); } }, duration(m))));
    dropdown(row, list);
  });
  const row = h('div', { class: 'tf-row' }, input, openBtn);
  const el = h('div', { class: 'tf' }, sugg.box, row, hint);
  sugg.set(opts.suggestions ?? []);
  show();
  return {
    el, input,
    get value() { commit(); return value; },
    set value(v: number) { set(v, false); },
    setSuggestions: (l) => sugg.set(l),
  };
}
