// Atajos de teclado de Microsoft Word. Hay dos mapas porque Word en español y
// Word en inglés usan combinaciones distintas (Ctrl+N es negrita en español y
// "nuevo" en inglés, por ejemplo). Las teclas se comparan por carácter para
// las letras y por posición física para los números, igual que Word, y se
// ignora AltGr para no robar caracteres como @, # o €.

export type KeymapId = 'es' | 'en';

export interface ShortcutDef {
  action: string;
  label: string;
  group: string;
  es: string[];
  en: string[];
  /** 'editor' solo actúa con el foco en el documento; 'app' actúa siempre. */
  scope: 'editor' | 'app';
}

const S = (action: string, label: string, group: string, es: string | string[], en: string | string[] = es, scope: 'editor' | 'app' = 'editor'): ShortcutDef =>
  ({ action, label, group, es: ([] as string[]).concat(es), en: ([] as string[]).concat(en), scope });

export const SHORTCUTS: ShortcutDef[] = [
  // Archivo
  S('new', 'Nuevo documento', 'Archivo', 'Ctrl+U', 'Ctrl+N', 'app'),
  S('open', 'Abrir / buscar documento', 'Archivo', 'Ctrl+A', 'Ctrl+O', 'app'),
  S('save', 'Guardar (y crear versión)', 'Archivo', 'Ctrl+G', 'Ctrl+S', 'app'),
  S('saveVersion', 'Guardar versión con nombre', 'Archivo', 'F12', 'F12', 'app'),
  S('print', 'Imprimir / exportar PDF', 'Archivo', 'Ctrl+P', 'Ctrl+P', 'app'),
  S('export', 'Exportar a Word (.docx)', 'Archivo', 'Ctrl+Mayús+E', 'Ctrl+Mayús+E', 'app'),
  S('versions', 'Historial de versiones', 'Archivo', 'Ctrl+Alt+H', 'Ctrl+Alt+H', 'app'),
  S('modeDocs', 'Ir a Documentos', 'Espacios', 'Ctrl+Mayús+1', 'Ctrl+Mayús+1', 'app'),
  S('modeAgenda', 'Ir a la Agenda', 'Espacios', 'Ctrl+Mayús+2', 'Ctrl+Mayús+2', 'app'),
  // Edición
  S('undo', 'Deshacer', 'Edición', 'Ctrl+Z'),
  S('redo', 'Rehacer', 'Edición', ['Ctrl+Y', 'Ctrl+Mayús+Z']),
  S('selectAll', 'Seleccionar todo', 'Edición', 'Ctrl+E', 'Ctrl+A'),
  S('find', 'Buscar', 'Edición', 'Ctrl+B', 'Ctrl+F', 'app'),
  S('replace', 'Reemplazar', 'Edición', 'Ctrl+L', 'Ctrl+H', 'app'),
  S('goto', 'Ir a (títulos del documento)', 'Edición', 'Ctrl+I', 'Ctrl+G', 'app'),
  S('copyFormat', 'Copiar formato', 'Edición', ['Ctrl+Mayús+C', 'Ctrl+Alt+C']),
  S('pasteFormat', 'Pegar formato', 'Edición', ['Ctrl+Mayús+V', 'Ctrl+Alt+V']),
  S('moveUp', 'Mover párrafo arriba', 'Edición', 'Alt+Mayús+ArrowUp'),
  S('moveDown', 'Mover párrafo abajo', 'Edición', 'Alt+Mayús+ArrowDown'),
  // Fuente
  S('bold', 'Negrita', 'Fuente', 'Ctrl+N', 'Ctrl+B'),
  S('italic', 'Cursiva', 'Fuente', 'Ctrl+K', 'Ctrl+I'),
  S('underline', 'Subrayado', 'Fuente', 'Ctrl+S', 'Ctrl+U'),
  S('strike', 'Tachado', 'Fuente', 'Ctrl+Mayús+X'),
  S('subscript', 'Subíndice', 'Fuente', ['Ctrl+=', 'Ctrl+Mayús+-']),
  S('superscript', 'Superíndice', 'Fuente', 'Ctrl++'),
  S('growFont', 'Aumentar tamaño de fuente', 'Fuente', ['Ctrl+>', 'Ctrl+]']),
  S('shrinkFont', 'Reducir tamaño de fuente', 'Fuente', ['Ctrl+<', 'Ctrl+[']),
  S('font', 'Elegir fuente', 'Fuente', ['Ctrl+M', 'Ctrl+Mayús+F'], ['Ctrl+D', 'Ctrl+Mayús+F']),
  S('fontSize', 'Elegir tamaño de fuente', 'Fuente', 'Ctrl+Mayús+P'),
  S('highlight', 'Resaltar', 'Fuente', 'Ctrl+Alt+R', 'Ctrl+Alt+H'),
  S('clearMarks', 'Quitar formato de carácter', 'Fuente', 'Ctrl+Espacio'),
  S('upper', 'TODO MAYÚSCULAS', 'Fuente', 'Ctrl+Mayús+A'),
  S('changeCase', 'Cambiar mayúsculas/minúsculas', 'Fuente', 'Mayús+F3'),
  S('link', 'Hipervínculo', 'Fuente', 'Ctrl+Alt+K', 'Ctrl+K'),
  // Párrafo
  S('alignLeft', 'Alinear a la izquierda', 'Párrafo', 'Ctrl+Q', 'Ctrl+L'),
  S('alignCenter', 'Centrar', 'Párrafo', 'Ctrl+T', 'Ctrl+E'),
  S('alignRight', 'Alinear a la derecha', 'Párrafo', 'Ctrl+D', 'Ctrl+R'),
  S('alignJustify', 'Justificar', 'Párrafo', 'Ctrl+J'),
  S('indent', 'Aumentar sangría', 'Párrafo', 'Alt+Mayús+ArrowRight', ['Ctrl+M', 'Alt+Mayús+ArrowRight']),
  S('outdent', 'Reducir sangría', 'Párrafo', 'Alt+Mayús+ArrowLeft', ['Ctrl+Mayús+M', 'Alt+Mayús+ArrowLeft']),
  S('line1', 'Interlineado sencillo', 'Párrafo', 'Ctrl+1'),
  S('line15', 'Interlineado 1,5', 'Párrafo', 'Ctrl+5'),
  S('line2', 'Interlineado doble', 'Párrafo', 'Ctrl+2'),
  S('resetParagraph', 'Quitar formato de párrafo', 'Párrafo', 'Ctrl+Mayús+Q', 'Ctrl+Q'),
  S('showMarks', 'Mostrar marcas de formato ¶', 'Párrafo', 'Ctrl+Mayús+8', 'Ctrl+Mayús+8', 'app'),
  // Estilos
  S('normal', 'Estilo Normal', 'Estilos', 'Ctrl+Mayús+N'),
  S('h1', 'Título 1', 'Estilos', 'Ctrl+Alt+1'),
  S('h2', 'Título 2', 'Estilos', 'Ctrl+Alt+2'),
  S('h3', 'Título 3', 'Estilos', 'Ctrl+Alt+3'),
  S('bulletList', 'Lista con viñetas', 'Estilos', 'Ctrl+Mayús+L'),
  S('orderedList', 'Lista numerada', 'Estilos', 'Ctrl+Mayús+O'),
  S('styles', 'Aplicar estilo', 'Estilos', 'Ctrl+Mayús+S', 'Ctrl+Mayús+S', 'app'),
  // Insertar
  S('pageBreak', 'Salto de página', 'Insertar', 'Ctrl+Intro'),
  S('footnote', 'Nota al pie', 'Insertar', 'Ctrl+Alt+F'),
  S('comment', 'Comentario', 'Insertar', 'Ctrl+Alt+M'),
  S('equation', 'Ecuación', 'Insertar', 'Alt+='),
  S('date', 'Fecha actual', 'Insertar', ['Alt+Mayús+D', 'Alt+Mayús+F']),
  S('time', 'Hora actual', 'Insertar', 'Alt+Mayús+T'),
  S('nbsp', 'Espacio de no separación', 'Insertar', 'Ctrl+Mayús+Espacio'),
  // Vista
  S('ribbon', 'Mostrar / ocultar la cinta', 'Vista', 'Ctrl+F1', 'Ctrl+F1', 'app'),
  S('sidebar', 'Mostrar / ocultar el panel lateral', 'Vista', 'Ctrl+\\', 'Ctrl+\\', 'app'),
  S('focus', 'Modo concentración', 'Vista', 'Ctrl+Mayús+F11', 'Ctrl+Mayús+F11', 'app'),
  S('zoomIn', 'Acercar', 'Vista', 'Ctrl+Alt+=', 'Ctrl+Alt+=', 'app'),
  S('zoomOut', 'Alejar', 'Vista', 'Ctrl+Alt+-', 'Ctrl+Alt+-', 'app'),
  S('zoomReset', 'Zoom: ajustar al ancho', 'Vista', 'Ctrl+Alt+0', 'Ctrl+Alt+0', 'app'),
  S('wordCount', 'Contar palabras', 'Vista', 'Ctrl+Mayús+G', 'Ctrl+Mayús+G', 'app'),
  S('palette', 'Buscar acciones', 'Vista', 'Alt+Q', 'Alt+Q', 'app'),
  S('help', 'Atajos de teclado', 'Vista', 'F1', 'F1', 'app'),
];

interface Combo { ctrl: boolean; alt: boolean; shift: boolean; key: string }

const KEY_ALIASES: Record<string, string> = { Espacio: ' ', Intro: 'Enter', Space: ' ' };

function parse(spec: string): Combo {
  // "Ctrl++" → ['Ctrl', '+']
  const parts = spec.replace(/\+\+$/, '+PLUS').split('+');
  const key = parts.pop()!.replace('PLUS', '+');
  return {
    ctrl: parts.includes('Ctrl'),
    alt: parts.includes('Alt'),
    shift: parts.includes('Mayús') || parts.includes('Shift'),
    key: KEY_ALIASES[key] ?? key,
  };
}

const parsed = new Map<string, Combo>();

function isLetter(k: string) {
  return /^[a-z]$/i.test(k);
}

export function matches(e: KeyboardEvent, spec: string): boolean {
  let c = parsed.get(spec);
  if (!c) { c = parse(spec); parsed.set(spec, c); }
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl !== c.ctrl || e.altKey !== c.alt) return false;
  if ((c.ctrl || c.alt) && e.getModifierState?.('AltGraph')) return false;
  const k = c.key;
  if (isLetter(k)) {
    if (e.shiftKey !== c.shift) return false;
    const ek = e.key.length === 1 ? e.key.toLowerCase() : '';
    // Con Alt algunas distribuciones cambian e.key; entonces se usa la tecla física.
    return ek === k.toLowerCase() || (!/^[a-z]$/.test(ek) && e.code === `Key${k.toUpperCase()}`);
  }
  if (/^[0-9]$/.test(k)) {
    if (e.shiftKey !== c.shift) return false;
    return e.code === `Digit${k}` || e.code === `Numpad${k}`;
  }
  if (k.length === 1 && k !== ' ') {
    // Símbolos (= + < > [ ] - \ 8): la tecla Mayús depende de la distribución.
    if (k === '8') return e.code === 'Digit8';
    if (e.key === k) return true;
    if (k === '-' && (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.code === 'Slash')) return c.shift === e.shiftKey || !c.shift;
    if (k === '=' && e.code === 'Equal' && !e.shiftKey) return true;
    return false;
  }
  if (e.shiftKey !== c.shift) return false;
  return e.key === k || (k === ' ' && e.code === 'Space');
}

export function findShortcut(e: KeyboardEvent, map: KeymapId): ShortcutDef | undefined {
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !/^F\d+$/.test(e.key)) return undefined;
  for (const s of SHORTCUTS) {
    for (const spec of s[map]) if (matches(e, spec)) return s;
  }
  return undefined;
}

/** Combinaciones con Ctrl/Alt que el editor debe seguir gestionando por sí mismo. */
export function isNativeEditingCombo(e: KeyboardEvent): boolean {
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl && !e.altKey) return true;
  if (e.getModifierState?.('AltGraph')) return true;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Backspace', 'Delete', 'PageUp', 'PageDown', 'Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return true;
  if (ctrl && !e.altKey && ['c', 'x', 'v', 'insert'].includes(e.key.toLowerCase())) return true;
  return false;
}

export function shortcutLabel(action: string, map: KeymapId): string {
  return SHORTCUTS.find((s) => s.action === action)?.[map][0] ?? '';
}
