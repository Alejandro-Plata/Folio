// Plantillas pensadas para docentes. Se generan como JSON del editor.
import type { JSONContent } from '@tiptap/core';
import type { PageSetup } from './types';

const t = (text: string, marks?: string[]): JSONContent => ({ type: 'text', text, ...(marks ? { marks: marks.map((m) => ({ type: m })) } : {}) });
const p = (...c: (JSONContent | string)[]): JSONContent => ({ type: 'paragraph', content: c.length ? c.map((x) => (typeof x === 'string' ? t(x) : x)) : undefined });
const hd = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const ul = (...items: string[]): JSONContent => ({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) });
const ol = (...items: string[]): JSONContent => ({ type: 'orderedList', attrs: { start: 1 }, content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) });
const callout = (kind: string, ...c: JSONContent[]): JSONContent => ({ type: 'callout', attrs: { kind }, content: c });
const solution = (...c: JSONContent[]): JSONContent => ({ type: 'toggle', attrs: { title: 'Solución', solution: true, open: false }, content: c.length ? c : [p()] });
const lines = (n: number): JSONContent => ({ type: 'answerLines', attrs: { lines: n } });
const cell = (text: string, header = false, attrs: Record<string, unknown> = {}): JSONContent =>
  ({ type: header ? 'tableHeader' : 'tableCell', attrs: { colspan: 1, rowspan: 1, ...attrs }, content: [p(...(text ? [header ? t(text, ['bold']) : t(text)] : []))] });
const table = (rows: string[][], headerRow = true, widths?: number[]): JSONContent => ({
  type: 'table',
  content: rows.map((r, i) => ({ type: 'tableRow', content: r.map((c, j) => cell(c, headerRow && i === 0, widths ? { colwidth: [widths[j]] } : {})) })),
});
const question = (n: number, text: string, pts: string, nlines = 5): JSONContent[] => [
  p(t(`${n}. `, ['bold']), t(text), t(` (${pts})`, ['italic'])),
  lines(nlines),
  solution(),
];

export interface Template {
  id: string;
  title: string;
  icon: string;
  description: string;
  content: () => JSONContent;
  setup?: Partial<PageSetup>;
}

export const TEMPLATES: Template[] = [
  {
    id: 'blank', title: 'Documento en blanco', icon: 'file', description: 'Empieza desde cero.',
    content: () => ({ type: 'doc', content: [p()] }),
  },
  {
    id: 'notes', title: 'Apuntes de clase', icon: 'book', description: 'Tema con objetivos, índice, conceptos clave, ejemplos, resumen y actividades.',
    setup: { header: '{titulo}', footer: 'Asignatura · Curso' },
    content: () => ({
      type: 'doc', content: [
        callout('info', p(t('Objetivos de aprendizaje', ['bold'])), ul('Comprender…', 'Identificar…', 'Aplicar…')),
        { type: 'tableOfContents' },
        hd(1, '1. Introducción'),
        p('Presenta el tema y conéctalo con lo que el alumnado ya sabe.'),
        hd(1, '2. Conceptos clave'),
        callout('definition', p(t('Concepto: ', ['bold']), t('definición clara y breve.'))),
        hd(2, '2.1. Desarrollo'),
        p('Explicación del contenido con ejemplos y apoyos visuales.'),
        callout('example', p(t('Ejemplo: ', ['bold']), t('caso resuelto paso a paso.'))),
        callout('warning', p(t('Error frecuente: ', ['bold']), t('lo que suele confundirse.'))),
        hd(1, '3. Resumen'),
        ul('Idea principal 1', 'Idea principal 2', 'Idea principal 3'),
        hd(1, '4. Actividades'),
        callout('exercise', p(t('Actividad 1. ', ['bold']), t('Enunciado.'))),
        solution(p('Respuesta esperada.')),
      ],
    }),
  },
  {
    id: 'cornell', title: 'Apuntes Cornell', icon: 'clipboard', description: 'Método Cornell: preguntas clave, notas y resumen final.',
    content: () => ({
      type: 'doc', content: [
        p(t('Tema: ', ['bold']), t('    '), t('Fecha: ', ['bold']), t(new Date().toLocaleDateString('es-ES'))),
        table([['Ideas clave / preguntas', 'Notas'], ['', ''], ['', ''], ['', '']], true, [188, 412]),
        hd(2, 'Resumen'),
        lines(5),
      ],
    }),
  },
  {
    id: 'exam', title: 'Examen', icon: 'checkCircle', description: 'Cabecera del alumno, instrucciones, preguntas puntuadas con líneas y soluciones ocultables.',
    setup: { header: '{titulo}', footer: 'Departamento de …', pageNumbers: true },
    content: () => ({
      type: 'doc', content: [
        table([['Nombre y apellidos:', '', 'Curso:', ''], ['Fecha:', '', 'Calificación:', '']], false, [128, 236, 100, 136]),
        callout('important', p(t('Instrucciones. ', ['bold']), t('Lee con atención cada pregunta. Responde con letra clara. Duración: 50 minutos.'))),
        ...question(1, 'Define el siguiente concepto y pon un ejemplo.', '1,5 puntos'),
        ...question(2, 'Explica la relación entre … y …', '2 puntos', 7),
        p(t('3. ', ['bold']), t('Resuelve: '), { type: 'mathInline', attrs: { latex: '2x + 5 = 17' } }, t(' (1 punto)', ['italic'])),
        lines(4),
        solution(p({ type: 'mathInline', attrs: { latex: 'x = 6' } })),
        p(t('4. ', ['bold']), t('Verdadero o falso. Justifica las falsas. '), t('(2 puntos)', ['italic'])),
        { type: 'taskList', content: ['Afirmación a', 'Afirmación b', 'Afirmación c'].map((x) => ({ type: 'taskItem', attrs: { checked: false }, content: [p(x)] })) },
        solution(p('a) V · b) F, porque… · c) V')),
      ],
    }),
  },
  {
    id: 'worksheet', title: 'Ficha de ejercicios', icon: 'pencil', description: 'Ejercicios graduados con espacio de respuesta y soluciones.',
    setup: { header: '{titulo}' },
    content: () => ({
      type: 'doc', content: [
        p(t('Nombre: ', ['bold']), t('______________________________   '), t('Fecha: ', ['bold']), t('__________')),
        hd(2, 'Nivel básico'),
        callout('exercise', p('Ejercicio 1. Enunciado.')), lines(3), solution(),
        callout('exercise', p('Ejercicio 2. Enunciado.')), lines(3), solution(),
        hd(2, 'Nivel intermedio'),
        callout('exercise', p('Ejercicio 3. Enunciado.')), lines(5), solution(),
        hd(2, 'Reto'),
        callout('exercise', p('Ejercicio 4. Enunciado.')), lines(6), solution(),
      ],
    }),
  },
  {
    id: 'rubric', title: 'Rúbrica de evaluación', icon: 'barChart', description: 'Criterios por niveles de logro, lista para imprimir en horizontal.',
    setup: { orientation: 'landscape' },
    content: () => ({
      type: 'doc', content: [
        p('Tarea evaluada: …   ·   Criterios de evaluación: …'),
        table([
          ['Criterio', 'Insuficiente (1-4)', 'Suficiente (5-6)', 'Notable (7-8)', 'Sobresaliente (9-10)', 'Peso'],
          ['Contenido', '', '', '', '', '40 %'],
          ['Organización', '', '', '', '', '20 %'],
          ['Expresión', '', '', '', '', '20 %'],
          ['Presentación', '', '', '', '', '20 %'],
        ], true, [150, 170, 170, 170, 170, 70]),
        p(t('Observaciones:', ['bold'])), lines(3),
      ],
    }),
  },
  {
    id: 'lesson', title: 'Situación de aprendizaje', icon: 'target', description: 'Programación de aula (LOMLOE): competencias, criterios, saberes, secuencia y evaluación.',
    content: () => ({
      type: 'doc', content: [
        table([
          ['Etapa / curso', ''], ['Área / materia', ''], ['Temporalización', 'Sesiones: …  ·  Trimestre: …'],
          ['Competencias específicas', ''], ['Criterios de evaluación', ''], ['Saberes básicos', ''],
          ['Descriptores del perfil de salida', ''], ['ODS / vinculación', ''],
        ], false, [198, 402]),
        hd(1, 'Descripción y producto final'),
        p('Contexto, reto o pregunta guía y producto que elaborará el alumnado.'),
        hd(1, 'Secuencia de actividades'),
        table([['Sesión', 'Actividad', 'Agrupamiento', 'Recursos'], ['1', '', '', ''], ['2', '', '', ''], ['3', '', '', '']], true, [60, 300, 120, 120]),
        hd(1, 'Atención a las diferencias individuales (DUA)'),
        ul('Múltiples formas de representación…', 'Múltiples formas de acción y expresión…', 'Múltiples formas de implicación…'),
        hd(1, 'Evaluación'),
        p('Instrumentos: rúbrica, lista de cotejo, diario de aprendizaje…'),
      ],
    }),
  },
  {
    id: 'meeting', title: 'Acta de reunión / tutoría', icon: 'users', description: 'Asistentes, orden del día, acuerdos y tareas con seguimiento.',
    content: () => ({
      type: 'doc', content: [
        p(t('Fecha: ', ['bold']), t(new Date().toLocaleDateString('es-ES')), t('   ·   '), t('Lugar: ', ['bold']), t('…')),
        p(t('Asistentes: ', ['bold']), t('…')),
        hd(2, 'Orden del día'), ol('Lectura y aprobación del acta anterior', '…', 'Ruegos y preguntas'),
        hd(2, 'Desarrollo'), p(),
        hd(2, 'Acuerdos'),
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p('Acuerdo / tarea — responsable — fecha')] }] },
      ],
    }),
  },
];

/** Extrae texto plano de un JSON del editor (para búsqueda y recuento). */
export function jsonToText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? '';
  const inner = (node.content ?? []).map(jsonToText).join(node.type === 'doc' ? '\n' : '');
  return ['paragraph', 'heading', 'listItem', 'taskItem', 'tableCell', 'tableHeader'].includes(node.type ?? '') ? inner + '\n' : inner;
}

