package docx

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"strings"
	"testing"

	"folio/internal/store"
)

// sample cubre todos los tipos de nodo que produce el editor.
const sample = `{"type":"doc","content":[
 {"type":"tableOfContents"},
 {"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Tema 3: La célula"}]},
 {"type":"paragraph","attrs":{"textAlign":"justify","lineHeight":1.5,"indent":1},"content":[
   {"type":"text","text":"Negrita ","marks":[{"type":"bold"}]},
   {"type":"text","text":"cursiva","marks":[{"type":"italic"},{"type":"textStyle","attrs":{"color":"#c0392b","fontSize":"14pt","fontFamily":"Georgia, serif"}}]},
   {"type":"text","text":" H"},{"type":"text","text":"2","marks":[{"type":"subscript"}]},{"type":"text","text":"O & <x>"},
   {"type":"footnote","attrs":{"text":"Fuente: libro de texto, p. 42"}},
   {"type":"text","text":" enlace","marks":[{"type":"link","attrs":{"href":"https://es.wikipedia.org/wiki/Célula"}}]},
   {"type":"text","text":" comentado","marks":[{"type":"comment","attrs":{"id":"c1","text":"Revisar esta definición","author":"Profe"}},{"type":"highlight","attrs":{"color":"#fff3a3"}}]},
   {"type":"hardBreak"},
   {"type":"mathInline","attrs":{"latex":"E = mc^2 + \\frac{a+b}{2} \\leq \\sqrt{x}"}}
 ]},
 {"type":"orderedList","attrs":{"start":3},"content":[
   {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Uno"}]},
     {"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Anidado"}]}]}]}]}
 ]},
 {"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"Hecho"}]}]}]},
 {"type":"callout","attrs":{"kind":"definition"},"content":[{"type":"paragraph","content":[{"type":"text","text":"La célula es la unidad básica de la vida."}]}]},
 {"type":"toggle","attrs":{"title":"Solución ejercicio 1","solution":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"SECRETO"}]}]},
 {"type":"answerLines","attrs":{"lines":3}},
 {"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"Cita"}]}]},
 {"type":"codeBlock","content":[{"type":"text","text":"print('hola')\nx = 1"}]},
 {"type":"horizontalRule"},
 {"type":"mathBlock","attrs":{"latex":"\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}"}},
 {"type":"image","attrs":{"src":"/files/abc/img.png","alt":"Diagrama","width":300}},
 {"type":"pageBreak"},
 {"type":"table","content":[
   {"type":"tableRow","content":[
     {"type":"tableHeader","attrs":{"colspan":1,"rowspan":1},"content":[{"type":"paragraph","content":[{"type":"text","text":"A"}]}]},
     {"type":"tableHeader","attrs":{"colspan":2,"rowspan":1},"content":[{"type":"paragraph","content":[{"type":"text","text":"B+C"}]}]}]},
   {"type":"tableRow","content":[
     {"type":"tableCell","attrs":{"colspan":1,"rowspan":2},"content":[{"type":"paragraph","content":[{"type":"text","text":"Alta"}]}]},
     {"type":"tableCell","attrs":{"colspan":1,"rowspan":1},"content":[{"type":"paragraph"}]},
     {"type":"tableCell","attrs":{"colspan":1,"rowspan":1},"content":[{"type":"paragraph"}]}]},
   {"type":"tableRow","content":[
     {"type":"tableCell","attrs":{"colspan":1,"rowspan":1},"content":[{"type":"paragraph"}]},
     {"type":"tableCell","attrs":{"colspan":1,"rowspan":1,"background":"#eef"},"content":[{"type":"paragraph"}]}]}
 ]}
]}`

func testPNG() []byte {
	img := image.NewRGBA(image.Rect(0, 0, 40, 20))
	img.Set(1, 1, color.Black)
	var b bytes.Buffer
	png.Encode(&b, img)
	return b.Bytes()
}

func build(t *testing.T, student bool) map[string]string {
	t.Helper()
	setup := store.DefaultSetup()
	setup.Header = "{titulo}"
	setup.Footer = "Biología 1º ESO"
	var buf bytes.Buffer
	err := Write(&buf, []byte(sample), Options{
		Title: "La célula", Setup: setup, StudentVersion: student, IncludeTitle: true,
		ResolveImage: func(string) ([]byte, error) { return testPNG(), nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	if dir := os.Getenv("DOCX_OUT"); dir != "" {
		os.WriteFile(dir+"/sample.docx", buf.Bytes(), 0o644)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatal(err)
	}
	parts := map[string]string{}
	for _, f := range zr.File {
		rc, _ := f.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		parts[f.Name] = string(b)
		if strings.HasSuffix(f.Name, ".xml") || strings.HasSuffix(f.Name, ".rels") {
			dec := xml.NewDecoder(bytes.NewReader(b))
			for {
				if _, err := dec.Token(); err == io.EOF {
					break
				} else if err != nil {
					t.Fatalf("%s no es XML válido: %v", f.Name, err)
				}
			}
		}
	}
	return parts
}

func TestDocxWellFormed(t *testing.T) {
	p := build(t, false)
	doc := p["word/document.xml"]
	for _, want := range []string{"Heading1", "SECRETO", "footnoteReference", "commentRangeStart", "w:hyperlink",
		`w:vMerge w:val="restart"`, `w:gridSpan w:val="2"`, "E = mc²", " TOC ", "Definición", `w:br w:type="page"`, "&amp; &lt;x&gt;"} {
		if !strings.Contains(doc, want) {
			t.Errorf("falta %q en document.xml", want)
		}
	}
	if !strings.Contains(p["word/footnotes.xml"], "libro de texto") {
		t.Error("falta la nota al pie")
	}
	if !strings.Contains(p["word/comments.xml"], "Revisar esta definición") {
		t.Error("falta el comentario")
	}
	if !strings.Contains(p["word/header1.xml"], "La célula") {
		t.Error("no se expandió {titulo} en el encabezado")
	}
	if _, ok := p["word/media/image1.png"]; !ok {
		t.Error("falta la imagen")
	}
}

func TestDocxStudentVersion(t *testing.T) {
	if strings.Contains(build(t, true)["word/document.xml"], "SECRETO") {
		t.Fatal("la versión del alumno no debe incluir soluciones")
	}
}

func TestLatexToText(t *testing.T) {
	cases := map[string]string{
		`x^2 + y^{10}`:      "x² + y¹⁰",
		`\frac{1}{2}`:       "1/2",
		`\alpha \leq \beta`: "α ≤ β",
		`\sqrt{a+b}`:        "√(a+b)",
		`H_2O`:              "H₂O",
		`\mathbb{R}`:        "ℝ",
		`\sin x`:            "sin x",
		`\sum_{i=1}^{n} i`:  "∑ᵢ₌₁ⁿ i",
	}
	for in, want := range cases {
		if got := LatexToText(in); got != want {
			t.Errorf("LatexToText(%q) = %q, se esperaba %q", in, got, want)
		}
	}
}
