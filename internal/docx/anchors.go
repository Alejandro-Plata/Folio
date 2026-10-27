package docx

import (
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// HeadingSlug es el ancla de un título para los enlaces internos («#mi-titulo»):
// minúsculas, sin tildes y con guiones. Es la misma regla que headingSlug en
// frontend/src/editor/extensions.ts, así que los enlaces del editor apuntan
// al mismo título en Word.
func HeadingSlug(text string) string {
	var b strings.Builder
	dash := false
	for _, r := range norm.NFD.String(strings.ToLower(text)) {
		switch {
		case unicode.Is(unicode.Mn, r):
			continue
		case r >= 'a' && r <= 'z' || r >= '0' && r <= '9':
			if dash && b.Len() > 0 {
				b.WriteByte('-')
			}
			dash = false
			b.WriteRune(r)
		default:
			dash = true
		}
	}
	if b.Len() == 0 {
		return "seccion"
	}
	return b.String()
}

// bookmarkName convierte un ancla en un nombre de marcador válido para Word
// (letras, números y guiones bajos, 40 caracteres como mucho).
func bookmarkName(slug string) string {
	n := "h_" + strings.ReplaceAll(slug, "-", "_")
	if len(n) > 40 {
		n = n[:40]
	}
	return n
}

// anchorFor devuelve el marcador del siguiente título con ese texto; los
// repetidos llevan sufijo («-2», «-3»), igual que en la exportación HTML.
func (b *builder) anchorFor(text string) string {
	if b.anchors == nil {
		b.anchors = map[string]int{}
	}
	base := HeadingSlug(text)
	b.anchors[base]++
	if n := b.anchors[base]; n > 1 {
		base += "-" + strconv.Itoa(n)
	}
	return bookmarkName(base)
}
