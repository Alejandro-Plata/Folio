// Número de tema a partir del nombre de un archivo de apuntes: «Tema 3.pdf»,
// «T03 - Constitución.docx», «03_derechos.pdf», «Unidad 12.odt»…

const WORD = /(?:^|[^a-záéíóúñ])(?:tema|temas|t|unidad|ud|u|lecci[oó]n|cap[ií]tulo|cap)[\s._-]*0*(\d{1,3})(?!\d)/i;
const LEADING = /^\s*0*(\d{1,3})(?!\d)/;

export function topicNumberOf(fileName: string): number | undefined {
  const base = fileName.replace(/\.[a-z0-9]{1,5}$/i, '');
  const m = WORD.exec(base) ?? LEADING.exec(base);
  const n = m ? Number(m[1]) : NaN;
  return n > 0 ? n : undefined;
}
