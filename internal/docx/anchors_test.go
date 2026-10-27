package docx

import (
	"strings"
	"testing"
)

func TestHeadingSlug(t *testing.T) {
	for in, want := range map[string]string{
		"Títulos y estilos":          "titulos-y-estilos",
		"¿Qué es la agenda?":         "que-es-la-agenda",
		"Año 2026 · versión":         "ano-2026-version",
		"  --  ":                     "seccion",
		"Exportar: PDF, Word y HTML": "exportar-pdf-word-y-html",
	} {
		if got := HeadingSlug(in); got != want {
			t.Errorf("HeadingSlug(%q) = %q, quiero %q", in, got, want)
		}
	}
}

// Un enlace «#ancla» se convierte en un hipervínculo interno al marcador del título.
func TestInternalLinks(t *testing.T) {
	doc := Node{Type: "doc", Content: []Node{
		{Type: "paragraph", Content: []Node{{Type: "text", Text: "Ir a la sección", Marks: []Mark{{Type: "link", Attrs: map[string]any{"href": "#exportar-pdf"}}}}}},
		{Type: "heading", Attrs: map[string]any{"level": 2.0}, Content: []Node{{Type: "text", Text: "Exportar PDF"}}},
		{Type: "heading", Attrs: map[string]any{"level": 2.0}, Content: []Node{{Type: "text", Text: "Exportar PDF"}}},
	}}
	b := &builder{}
	var out strings.Builder
	b.blocks(&out, doc.Content, ctx{})
	x := out.String()
	for _, want := range []string{`w:anchor="h_exportar_pdf"`, `w:name="h_exportar_pdf"`, `w:name="h_exportar_pdf_2"`} {
		if !strings.Contains(x, want) {
			t.Errorf("falta %s en\n%s", want, x)
		}
	}
}
