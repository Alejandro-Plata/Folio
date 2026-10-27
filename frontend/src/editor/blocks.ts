// Catálogo de bloques insertables. Lo usan el menú "/", la paleta de comandos
// y el menú Insertar de la barra de herramientas.
import type { Editor } from '@tiptap/core';
import { emit } from '../bus';
import { icon as svgIcon } from '../ui/icons';

export interface BlockItem {
  id: string;
  title: string;
  hint: string;
  /** Nombre de icono SVG, o «g:texto» para un glifo tipográfico (H1, x²…). */
  icon: string;
  keywords: string;
  group: 'Básico' | 'Listas' | 'Insertar' | 'Docente' | 'Cuadros';
  shortcut?: string;
  run: (e: Editor) => void;
}

const callout = (kind: string) => (e: Editor) => {
  if (e.isActive('callout')) e.chain().focus().setCalloutKind(kind).run();
  else e.chain().focus().setCallout(kind).run();
};

export const BLOCKS: BlockItem[] = [
  { id: 'p', group: 'Básico', icon: 'type', title: 'Texto', hint: 'Párrafo normal', keywords: 'parrafo normal texto', shortcut: 'Ctrl+Mayús+N', run: (e) => e.chain().focus().setParagraph().run() },
  { id: 'h1', group: 'Básico', icon: 'g:H1', title: 'Título 1', hint: 'Título de sección', keywords: 'titulo encabezado heading h1', shortcut: 'Ctrl+Alt+1', run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { id: 'h2', group: 'Básico', icon: 'g:H2', title: 'Título 2', hint: 'Subtítulo', keywords: 'titulo encabezado subtitulo h2', shortcut: 'Ctrl+Alt+2', run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { id: 'h3', group: 'Básico', icon: 'g:H3', title: 'Título 3', hint: 'Apartado', keywords: 'titulo encabezado apartado h3', shortcut: 'Ctrl+Alt+3', run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { id: 'h4', group: 'Básico', icon: 'g:H4', title: 'Título 4', hint: 'Subapartado', keywords: 'titulo h4', run: (e) => e.chain().focus().setHeading({ level: 4 }).run() },
  { id: 'quote', group: 'Básico', icon: 'quote', title: 'Cita', hint: 'Cita textual', keywords: 'cita quote blockquote', run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: 'code', group: 'Básico', icon: 'code', title: 'Código', hint: 'Bloque de código', keywords: 'codigo programacion code', run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { id: 'hr', group: 'Básico', icon: 'minus', title: 'Separador', hint: 'Línea horizontal', keywords: 'separador linea divisor hr', run: (e) => e.chain().focus().setHorizontalRule().run() },

  { id: 'ul', group: 'Listas', icon: 'listBullet', title: 'Lista con viñetas', hint: 'Lista simple', keywords: 'lista viñetas bullet', shortcut: 'Ctrl+Mayús+L', run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: 'ol', group: 'Listas', icon: 'listOrdered', title: 'Lista numerada', hint: 'Lista ordenada', keywords: 'lista numerada ordenada numeros', run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: 'todo', group: 'Listas', icon: 'listTodo', title: 'Lista de tareas', hint: 'Casillas para marcar', keywords: 'tareas checklist casillas todo', run: (e) => e.chain().focus().toggleTaskList().run() },

  { id: 'table', group: 'Insertar', icon: 'table', title: 'Tabla', hint: '3 × 3 con encabezado', keywords: 'tabla table cuadro', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: 'image', group: 'Insertar', icon: 'image', title: 'Imagen', hint: 'Desde un archivo', keywords: 'imagen foto figura picture', run: () => emit('ui:insert-image') },
  { id: 'math', group: 'Insertar', icon: 'sigma', title: 'Ecuación', hint: 'Fórmula LaTeX en bloque', keywords: 'ecuacion formula matematicas latex math', shortcut: 'Alt+=', run: (e) => { e.chain().focus().insertMathBlock('').run(); emit('math:edit-last-block'); } },
  { id: 'mathi', group: 'Insertar', icon: 'g:x²', title: 'Ecuación en línea', hint: 'Escribe $x^2$', keywords: 'ecuacion linea formula inline', run: () => emit('ui:math-inline') },
  { id: 'footnote', group: 'Insertar', icon: 'footnote', title: 'Nota al pie', hint: 'Referencia numerada', keywords: 'nota pie footnote referencia', shortcut: 'Ctrl+Alt+F', run: () => emit('ui:footnote') },
  { id: 'toc', group: 'Insertar', icon: 'outline', title: 'Índice', hint: 'Tabla de contenidos automática', keywords: 'indice contenido toc tabla de contenidos', run: (e) => e.chain().focus().insertToc().run() },
  { id: 'pagebreak', group: 'Insertar', icon: 'pageBreak', title: 'Salto de página', hint: 'Nueva página al imprimir', keywords: 'salto pagina page break', shortcut: 'Ctrl+Intro', run: (e) => e.chain().focus().setPageBreak().run() },
  { id: 'date', group: 'Insertar', icon: 'calendar', title: 'Fecha de hoy', hint: new Date().toLocaleDateString('es-ES'), keywords: 'fecha hoy dia date', shortcut: 'Alt+Mayús+D', run: (e) => e.chain().focus().insertContent(new Date().toLocaleDateString('es-ES')).run() },
  { id: 'comment', group: 'Insertar', icon: 'comment', title: 'Comentario', hint: 'Sobre el texto seleccionado', keywords: 'comentario nota revision', shortcut: 'Ctrl+Alt+M', run: () => emit('ui:comment') },

  { id: 'definition', group: 'Cuadros', icon: 'bookOpen', title: 'Definición', hint: 'Cuadro de definición', keywords: 'definicion concepto cuadro', run: callout('definition') },
  { id: 'example', group: 'Cuadros', icon: 'flask', title: 'Ejemplo', hint: 'Cuadro de ejemplo', keywords: 'ejemplo cuadro', run: callout('example') },
  { id: 'important', group: 'Cuadros', icon: 'alertCircle', title: 'Importante', hint: 'Cuadro destacado', keywords: 'importante destacado cuadro', run: callout('important') },
  { id: 'tip', group: 'Cuadros', icon: 'lightbulb', title: 'Consejo', hint: 'Truco o recordatorio', keywords: 'consejo truco tip recuerda', run: callout('tip') },
  { id: 'warning', group: 'Cuadros', icon: 'alert', title: 'Atención', hint: 'Error frecuente', keywords: 'atencion cuidado aviso warning', run: callout('warning') },
  { id: 'info', group: 'Cuadros', icon: 'info', title: 'Información', hint: 'Nota informativa', keywords: 'informacion nota info', run: callout('info') },
  { id: 'exercise', group: 'Cuadros', icon: 'pencil', title: 'Ejercicio', hint: 'Enunciado de ejercicio', keywords: 'ejercicio actividad tarea', run: callout('exercise') },

  { id: 'solution', group: 'Docente', icon: 'checkCircle', title: 'Solución', hint: 'Plegable; se oculta en la versión del alumnado', keywords: 'solucion respuesta plegable alumno', run: (e) => e.chain().focus().setToggle({ title: 'Solución', solution: true }).run() },
  { id: 'toggle', group: 'Docente', icon: 'toggleBlock', title: 'Plegable', hint: 'Contenido que se despliega', keywords: 'plegable desplegable toggle', run: (e) => e.chain().focus().setToggle({ title: '' }).run() },
  { id: 'lines', group: 'Docente', icon: 'lines', title: 'Líneas de respuesta', hint: 'Espacio para escribir a mano', keywords: 'lineas respuesta examen escribir pauta', run: (e) => e.chain().focus().insertAnswerLines(5).run() },
  { id: 'question', group: 'Docente', icon: 'question', title: 'Pregunta de examen', hint: 'Enunciado + puntos + líneas', keywords: 'pregunta examen enunciado puntos', run: (e) => e.chain().focus().insertContent([
    { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Pregunta. ' }, { type: 'text', text: 'Enunciado de la pregunta. ' }, { type: 'text', marks: [{ type: 'italic' }], text: '(1 punto)' }] },
    { type: 'answerLines', attrs: { lines: 5 } },
    { type: 'toggle', attrs: { title: 'Solución', solution: true, open: false }, content: [{ type: 'paragraph' }] },
    { type: 'paragraph' },
  ]).run() },
];

export function fold(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function filterBlocks(q: string): BlockItem[] {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return BLOCKS;
  return BLOCKS.filter((b) => {
    const hay = fold(`${b.title} ${b.keywords}`);
    return terms.every((t) => hay.includes(t));
  });
}


/** HTML del icono de un bloque. */
export function blockIconHTML(b: BlockItem, size = 18): string {
  if (b.icon.startsWith('g:')) return `<span class="glyph">${b.icon.slice(2)}</span>`;
  return svgIcon(b.icon, size);
}
