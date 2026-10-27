// Las anclas deben coincidir con las de Word (internal/docx/anchors_test.go).
import { headingSlug } from '../src/editor/anchors';

const cases: Record<string, string> = {
  'Títulos y estilos': 'titulos-y-estilos',
  '¿Qué es la agenda?': 'que-es-la-agenda',
  'Año 2026 · versión': 'ano-2026-version',
  '  --  ': 'seccion',
  'Exportar: PDF, Word y HTML': 'exportar-pdf-word-y-html',
};
let bad = 0;
for (const [input, want] of Object.entries(cases)) {
  const got = headingSlug(input);
  if (got !== want) { bad++; console.error(`headingSlug(${JSON.stringify(input)}) = ${got}, esperado ${want}`); }
}
console.log(`headingSlug: ${Object.keys(cases).length - bad}/${Object.keys(cases).length} correctas`);
if (bad) process.exit(1);
