import { emit } from '../bus';

// KaTeX se carga bajo demanda: solo los documentos con ecuaciones pagan su coste.
type Katex = typeof import('katex').default;
let loading: Promise<Katex> | null = null;

export function loadKatex(): Promise<Katex> {
  if (!loading) {
    loading = Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => m.default);
  }
  return loading;
}

export function renderMath(el: HTMLElement, latex: string, display: boolean) {
  if (!latex.trim()) {
    el.textContent = display ? 'Ecuación vacía — haz clic para editar' : '∅';
    el.classList.add('math-empty');
    return;
  }
  el.classList.remove('math-empty');
  el.textContent = latex;
  loadKatex().then((k) => {
    k.render(latex, el, { throwOnError: false, displayMode: display, strict: 'ignore' });
    emit('layout:changed');
  });
}

/** HTML de KaTeX para exportar: el mismo que se ve en pantalla. */
export async function renderMathHTML(latex: string, display: boolean): Promise<string> {
  if (!latex.trim()) return '';
  const k = await loadKatex();
  return k.renderToString(latex, { throwOnError: false, displayMode: display, strict: 'ignore' });
}
