// Hojas inferiores del móvil: un panel que sube desde abajo con asa, título y
// contenido. Se cierra tocando fuera, con «atrás» o deslizándolo hacia abajo.
import { pushBack } from '../platform/back';
import { h } from '../ui/dom';
import { icon } from '../ui/icons';

export interface SheetHandle { close(): void; el: HTMLElement }

export function sheet(title: string, body: Node, opts: { onClose?: () => void; tall?: boolean } = {}): SheetHandle {
  const backdrop = h('div', { class: 'm-sheet-backdrop' });
  const closeBtn = h('button', { type: 'button', class: 'icon-btn', title: 'Cerrar', 'aria-label': 'Cerrar', html: icon('x', 18) });
  const el = h('div', { class: `m-sheet ${opts.tall ? 'is-tall' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'm-sheet-grip', 'aria-hidden': 'true' }),
    h('div', { class: 'm-sheet-head' }, h('h2', {}, title), closeBtn),
    h('div', { class: 'm-sheet-body' }, body));
  backdrop.append(el);
  let closed = false;
  const unback = pushBack(() => close());
  function close() {
    if (closed) return;
    closed = true;
    unback();
    backdrop.classList.add('is-closing');
    setTimeout(() => backdrop.remove(), 160);
    opts.onClose?.();
  }
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  // Deslizar la cabecera hacia abajo para cerrar
  let startY = 0, dy = 0, dragging = false;
  const head = el.querySelector('.m-sheet-grip, .m-sheet-head') as HTMLElement;
  for (const handle of [el.querySelector('.m-sheet-grip')!, el.querySelector('.m-sheet-head')!]) {
    handle.addEventListener('pointerdown', (e) => { dragging = true; startY = (e as PointerEvent).clientY; dy = 0; (handle as HTMLElement).setPointerCapture((e as PointerEvent).pointerId); });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dy = Math.max(0, (e as PointerEvent).clientY - startY);
      el.style.transform = `translateY(${dy}px)`;
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      if (dy > 90) close(); else el.style.transform = '';
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }
  void head;
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('is-open'));
  return { close, el };
}

export interface ActionItem { label: string; icon?: string; hint?: string; danger?: boolean; checked?: boolean; run: () => void }

/** Lista de acciones en una hoja (el equivalente móvil de un menú contextual). */
export function actionSheet(title: string, items: (ActionItem | null)[]): SheetHandle {
  let handle: SheetHandle;
  const list = h('div', { class: 'm-actions', role: 'menu' }, ...items.filter((x): x is ActionItem => !!x).map((it) =>
    h('button', {
      type: 'button', role: 'menuitem', class: `m-action ${it.danger ? 'is-danger' : ''} ${it.checked ? 'is-checked' : ''}`,
      onclick: () => { handle.close(); setTimeout(it.run, 120); },
    },
    h('span', { class: 'm-action-ic', html: it.icon ? icon(it.icon, 20) : '' }),
    h('span', { class: 'm-action-label' }, it.label),
    it.hint ? h('span', { class: 'm-action-hint' }, it.hint) : it.checked ? h('span', { html: icon('check', 18) }) : null)));
  handle = sheet(title, list);
  return handle;
}
