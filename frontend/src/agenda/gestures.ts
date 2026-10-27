// Gestos táctiles de la agenda: deslizar a los lados cambia de periodo.
// (Tocar un hueco de la rejilla crea una tarea y tocar una tarea la abre: eso
// ya lo hacen las propias vistas.)
import type { AgendaView } from './view';

const MIN_DX = 64;     // px recorridos mínimos
const MAX_DY = 48;     // más inclinado que esto es un desplazamiento vertical
const MAX_MS = 700;

export function attachSwipe(view: AgendaView) {
  const el = view.root;
  let x = 0, y = 0, t = 0, active = false;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || (e.target as HTMLElement).closest('.ag-selbar, .ag-head, .ag-banner, input, textarea')) { active = false; return; }
    // En la lista (que solo se desplaza hacia abajo) no se desliza
    if (view.view === 'list') { active = false; return; }
    const p = e.touches[0];
    x = p.clientX; y = p.clientY; t = Date.now(); active = true;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (!active) return;
    active = false;
    const p = e.changedTouches[0];
    const dx = p.clientX - x, dy = p.clientY - y;
    if (Math.abs(dx) < MIN_DX || Math.abs(dy) > MAX_DY || Date.now() - t > MAX_MS || Math.abs(dx) < Math.abs(dy) * 2) return;
    // Hacia la izquierda: lo siguiente; hacia la derecha: lo anterior
    view.step(dx < 0 ? 1 : -1);
    view.announce(dx < 0 ? 'Periodo siguiente' : 'Periodo anterior');
  }, { passive: true });
}
