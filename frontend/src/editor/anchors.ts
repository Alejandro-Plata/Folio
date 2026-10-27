// Anclas de los títulos para los enlaces internos («#mi-titulo»). Sin
// dependencias: lo usan el editor, la exportación y las pruebas.
// internal/docx/anchors.go aplica la misma regla en Word.

/** Minúsculas, sin tildes y con guiones; «seccion» si no queda nada. */
export function headingSlug(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'seccion';
}
