// Pila de «atrás»: el botón o gesto atrás de Android cierra lo último que se
// abrió (menú, hoja, diálogo, pantalla); con la pila vacía, sale de la app.
// En el navegador, Escape hace lo mismo (para probar la interfaz móvil).
import { App as CapApp } from '@capacitor/app';
import { isAndroid } from './platform';

const stack: (() => void)[] = [];

/** Registra algo que «atrás» debe cerrar. Devuelve la función para quitarlo cuando se cierra por otro camino. */
export function pushBack(close: () => void): () => void {
  stack.push(close);
  return () => { const i = stack.lastIndexOf(close); if (i >= 0) stack.splice(i, 1); };
}

/** Ejecuta «atrás». Devuelve false si no había nada que cerrar. */
export function goBack(): boolean {
  const close = stack.pop();
  if (!close) return false;
  close();
  return true;
}

export function initBack(onExit: () => Promise<void> | void) {
  if (isAndroid) {
    void CapApp.addListener('backButton', async () => {
      if (goBack()) return;
      await onExit();
      void CapApp.exitApp();
    });
  } else {
    // En fase de captura y antes que el resto: Escape cierra lo último que se abrió
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && goBack()) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  }
}
