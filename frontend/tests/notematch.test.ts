// Número de tema a partir del nombre del archivo de apuntes.
import { topicNumberOf } from '../src/agenda/notematch';

const cases: [string, number | undefined][] = [
  ['Tema 3.pdf', 3], ['tema03 - Constitución.docx', 3], ['T12 Derechos.pdf', 12], ['t_7.pdf', 7],
  ['03_derechos fundamentales.pdf', 3], ['12. La Corona.odt', 12], ['Unidad 5.pptx', 5], ['UD 08 resumen.pdf', 8],
  ['Lección 2.docx', 2], ['Capítulo 14.pdf', 14], ['Resumen tema 21 (v2).pdf', 21],
  ['Constitución.pdf', undefined], ['Apuntes 2026.pdf', undefined], ['Esquemas.docx', undefined],
];
let fails = 0;
for (const [name, want] of cases) {
  const got = topicNumberOf(name);
  if (got !== want) { fails++; console.log(`✗ ${name}: ${got} (esperado ${want})`); }
}
console.log(fails ? `${fails} fallos` : `topicNumberOf: ${cases.length}/${cases.length} correctas`);
if (fails) process.exit(1);
