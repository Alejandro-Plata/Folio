// Package docx convierte un documento del editor (JSON de ProseMirror) en un
// archivo .docx de Word: estilos de título navegables, listas numeradas reales,
// tablas, imágenes, notas al pie, comentarios, índice, encabezado/pie con
// número de página y configuración de página.
package docx

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"math"
	"strconv"
	"strings"
	"time"

	"folio/internal/store"
)

type Node struct {
	Type    string         `json:"type"`
	Attrs   map[string]any `json:"attrs"`
	Content []Node         `json:"content"`
	Marks   []Mark         `json:"marks"`
	Text    string         `json:"text"`
}

type Mark struct {
	Type  string         `json:"type"`
	Attrs map[string]any `json:"attrs"`
}

type Options struct {
	Title          string
	Author         string
	Setup          store.PageSetup
	StudentVersion bool // omite los bloques marcados como solución
	IncludeTitle   bool
	// ResolveImage devuelve los bytes de una imagen a partir de su src.
	ResolveImage func(src string) ([]byte, error)
	Now          time.Time
}

type rel struct{ id, typ, target, mode string }

type media struct {
	name string
	data []byte
}

type comment struct {
	id     int
	text   string
	author string
	date   string
}

type builder struct {
	opt        Options
	rels       []rel
	media      []media
	mediaByKey map[string]string // src -> rId
	nums       []numInst
	footnotes  []string
	comments   []comment
	commentIDs map[string]int
	usedCmt    map[string]bool
	drawingID  int
	headings   []heading
	contentW   int            // ancho útil en twips
	anchors    map[string]int // anclas de títulos ya usadas (enlaces internos)
	bookmarkID int
}

type numInst struct {
	ordered bool
	start   int
}

type heading struct {
	level int
	text  string
}

const (
	relImage     = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
	relHyperlink = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
)

// Write genera el .docx en w.
func Write(w io.Writer, content []byte, opt Options) error {
	var root Node
	if err := json.Unmarshal(content, &root); err != nil {
		return fmt.Errorf("contenido no válido: %w", err)
	}
	if opt.Now.IsZero() {
		opt.Now = time.Now()
	}
	if opt.Author == "" {
		opt.Author = "Folio"
	}
	b := &builder{
		opt: opt, mediaByKey: map[string]string{},
		commentIDs: map[string]int{}, usedCmt: map[string]bool{},
	}
	pw, ph := pageSize(opt.Setup)
	b.contentW = pw - mmToTwip(opt.Setup.MarginLeft) - mmToTwip(opt.Setup.MarginRight)
	_ = ph
	b.collectHeadings(root)

	var body strings.Builder
	if opt.IncludeTitle && strings.TrimSpace(opt.Title) != "" {
		body.WriteString(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>` + run(opt.Title, runProps{}) + `</w:p>`)
	}
	b.blocks(&body, root.Content, ctx{})
	body.WriteString(b.sectPr())

	doc := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<w:document ` + nsAll + `><w:body>` + body.String() + `</w:body></w:document>`

	zw := zip.NewWriter(w)
	files := []struct{ name, data string }{
		{"[Content_Types].xml", b.contentTypes()},
		{"_rels/.rels", rootRels},
		{"docProps/core.xml", b.coreXML()},
		{"docProps/app.xml", appXML},
		{"word/document.xml", doc},
		{"word/styles.xml", stylesXML(opt.Setup)},
		{"word/numbering.xml", b.numberingXML()},
		{"word/settings.xml", settingsXML},
		{"word/footnotes.xml", b.footnotesXML()},
		{"word/comments.xml", b.commentsXML()},
		{"word/header1.xml", b.headerXML()},
		{"word/footer1.xml", b.footerXML()},
		{"word/_rels/document.xml.rels", b.docRels()},
	}
	for _, f := range files {
		fw, err := zw.Create(f.name)
		if err != nil {
			return err
		}
		if _, err := io.WriteString(fw, f.data); err != nil {
			return err
		}
	}
	for _, m := range b.media {
		fw, err := zw.Create("word/media/" + m.name)
		if err != nil {
			return err
		}
		if _, err := fw.Write(m.data); err != nil {
			return err
		}
	}
	return zw.Close()
}

// ---------- bloques ----------

type ctx struct {
	listDepth int
	numID     int // 0 = sin lista
	indent    int // sangría extra en twips
	quote     bool
	bold      bool
	inCell    bool
}

type paraProps struct {
	style   string
	align   string
	indent  int
	firstLn int
	numID   int
	ilvl    int
	line    float64
	before  int
	after   int
	border  string // "bottom", "left"
	shade   string
	keepNx  bool
	exact   int
}

func (p paraProps) xml() string {
	var s strings.Builder
	s.WriteString("<w:pPr>")
	if p.style != "" {
		s.WriteString(`<w:pStyle w:val="` + p.style + `"/>`)
	}
	if p.keepNx {
		s.WriteString(`<w:keepNext/>`)
	}
	if p.numID > 0 {
		fmt.Fprintf(&s, `<w:numPr><w:ilvl w:val="%d"/><w:numId w:val="%d"/></w:numPr>`, p.ilvl, p.numID)
	}
	switch p.border {
	case "bottom":
		s.WriteString(`<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr>`)
	case "left":
		s.WriteString(`<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="D0D0D0"/></w:pBdr>`)
	}
	if p.shade != "" {
		s.WriteString(`<w:shd w:val="clear" w:color="auto" w:fill="` + p.shade + `"/>`)
	}
	if p.line > 0 || p.before >= 0 || p.after >= 0 || p.exact > 0 {
		s.WriteString(`<w:spacing`)
		if p.before > 0 {
			fmt.Fprintf(&s, ` w:before="%d"`, p.before)
		}
		if p.after >= 0 {
			fmt.Fprintf(&s, ` w:after="%d"`, p.after)
		}
		if p.exact > 0 {
			fmt.Fprintf(&s, ` w:line="%d" w:lineRule="exact"`, p.exact)
		} else if p.line > 0 {
			fmt.Fprintf(&s, ` w:line="%d" w:lineRule="auto"`, int(p.line*240))
		}
		s.WriteString(`/>`)
	}
	if p.indent > 0 || p.firstLn != 0 {
		fmt.Fprintf(&s, `<w:ind w:left="%d"`, p.indent)
		if p.firstLn > 0 {
			fmt.Fprintf(&s, ` w:firstLine="%d"`, p.firstLn)
		} else if p.firstLn < 0 {
			fmt.Fprintf(&s, ` w:hanging="%d"`, -p.firstLn)
		}
		s.WriteString(`/>`)
	}
	if p.align != "" {
		s.WriteString(`<w:jc w:val="` + p.align + `"/>`)
	}
	s.WriteString("</w:pPr>")
	return s.String()
}

func newPara() paraProps { return paraProps{before: -1, after: -1} }

func (b *builder) blocks(out *strings.Builder, nodes []Node, c ctx) {
	for _, n := range nodes {
		b.block(out, n, c)
	}
}

func (b *builder) block(out *strings.Builder, n Node, c ctx) {
	switch n.Type {
	case "paragraph", "heading":
		p := newPara()
		p.indent = c.indent + int(num(n.Attrs, "indent"))*720
		p.align = alignment(str(n.Attrs, "textAlign"))
		if lh := num(n.Attrs, "lineHeight"); lh > 0 {
			p.line = lh
		}
		if n.Type == "heading" {
			lvl := int(num(n.Attrs, "level"))
			p.style = "Heading" + strconv.Itoa(clamp(lvl, 1, 4))
		} else if c.quote {
			p.style = "Quote"
		}
		if c.quote {
			p.border = "left"
		}
		rp := runProps{bold: c.bold}
		body := b.inlines(n.Content, rp)
		// Cada título lleva un marcador: destino de los enlaces «#ancla» del documento
		if n.Type == "heading" {
			if t := strings.TrimSpace(plainText(n)); t != "" {
				b.bookmarkID++
				id := strconv.Itoa(b.bookmarkID)
				body = `<w:bookmarkStart w:id="` + id + `" w:name="` + esc(b.anchorFor(t)) + `"/>` + body + `<w:bookmarkEnd w:id="` + id + `"/>`
			}
		}
		out.WriteString("<w:p>" + p.xml() + body + "</w:p>")

	case "bulletList", "orderedList", "taskList":
		b.list(out, n, c)

	case "blockquote":
		c.quote = true
		c.indent += 360
		b.blocks(out, n.Content, c)

	case "codeBlock":
		for _, line := range strings.Split(plainText(n), "\n") {
			p := newPara()
			p.style = "Code"
			p.indent = c.indent
			out.WriteString("<w:p>" + p.xml() + run(line, runProps{}) + "</w:p>")
		}

	case "horizontalRule":
		p := newPara()
		p.border = "bottom"
		out.WriteString("<w:p>" + p.xml() + "</w:p>")

	case "pageBreak":
		out.WriteString(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`)

	case "image":
		out.WriteString(b.imagePara(n, c))

	case "table":
		b.table(out, n, c)

	case "callout":
		b.callout(out, n, c)

	case "toggle":
		solution := boolean(n.Attrs, "solution")
		if solution && b.opt.StudentVersion {
			return
		}
		title := str(n.Attrs, "title")
		if title == "" && solution {
			title = "Solución"
		}
		p := newPara()
		p.indent = c.indent
		p.keepNx = true
		rp := runProps{bold: true}
		if solution {
			rp.color = "2E7D32"
		}
		out.WriteString("<w:p>" + p.xml() + run("▾ "+title, rp) + "</w:p>")
		c.indent += 360
		b.blocks(out, n.Content, c)

	case "answerLines":
		lines := clamp(int(num(n.Attrs, "lines")), 1, 60)
		for i := 0; i < lines; i++ {
			p := newPara()
			p.border = "bottom"
			p.exact = 440
			p.after = 0
			p.indent = c.indent
			out.WriteString("<w:p>" + p.xml() + "</w:p>")
		}

	case "mathBlock":
		p := newPara()
		p.align = "center"
		out.WriteString("<w:p>" + p.xml() + run(LatexToText(str(n.Attrs, "latex")), runProps{italic: true, font: "Cambria Math"}) + "</w:p>")

	case "tableOfContents":
		b.toc(out)

	default:
		// Nodos desconocidos: se exporta su contenido para no perder texto.
		if len(n.Content) > 0 {
			b.blocks(out, n.Content, c)
		}
	}
}

func (b *builder) list(out *strings.Builder, n Node, c ctx) {
	ordered := n.Type == "orderedList"
	task := n.Type == "taskList"
	numID := 0
	if !task {
		start := int(num(n.Attrs, "start"))
		if start < 1 {
			start = 1
		}
		b.nums = append(b.nums, numInst{ordered: ordered, start: start})
		numID = len(b.nums)
	}
	for _, item := range n.Content {
		for i, child := range item.Content {
			if i == 0 && (child.Type == "paragraph" || child.Type == "heading") {
				p := newPara()
				p.style = "ListParagraph"
				rp := runProps{bold: c.bold}
				prefix := ""
				if task {
					p.indent = c.indent + 360
					p.firstLn = -360
					box := rp
					box.font = "Segoe UI Symbol" // casilla tipográfica, nunca emoji de color
					if boolean(item.Attrs, "checked") {
						prefix = run("☑", box) + run("\t", rp)
					} else {
						prefix = run("☐", box) + run("\t", rp)
					}
				} else {
					p.numID = numID
					p.ilvl = clamp(c.listDepth, 0, 8)
					if c.indent > 0 {
						p.indent = c.indent + 720*(p.ilvl+1)
						p.firstLn = -360
					}
				}
				p.align = alignment(str(child.Attrs, "textAlign"))
				out.WriteString("<w:p>" + p.xml() + prefix + b.inlines(child.Content, rp) + "</w:p>")
				continue
			}
			cc := c
			if child.Type == "bulletList" || child.Type == "orderedList" || child.Type == "taskList" {
				cc.listDepth++
				if task {
					cc.indent += 360
				}
			} else {
				cc.indent += 720 * (c.listDepth + 1)
			}
			b.block(out, child, cc)
		}
	}
}

var calloutStyle = map[string]struct{ label, fill, border string }{
	"info":       {"Información", "EEF4FB", "4A90D9"},
	"tip":        {"Consejo", "EEF8F0", "3BA55D"},
	"warning":    {"Atención", "FFF6E5", "E0A100"},
	"important":  {"Importante", "FDECEC", "D64545"},
	"definition": {"Definición", "F3EEFB", "8A63D2"},
	"example":    {"Ejemplo", "EAF6F6", "2B9A9A"},
	"exercise":   {"Ejercicio", "F5F5F4", "78716C"},
}

func (b *builder) callout(out *strings.Builder, n Node, c ctx) {
	st, ok := calloutStyle[str(n.Attrs, "kind")]
	if !ok {
		st = calloutStyle["info"]
	}
	w := b.contentW - c.indent
	fmt.Fprintf(out, `<w:tbl><w:tblPr><w:tblW w:w="%d" w:type="dxa"/><w:tblInd w:w="%d" w:type="dxa"/>`+
		`<w:tblBorders><w:left w:val="single" w:sz="24" w:space="0" w:color="%s"/></w:tblBorders>`+
		`<w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="180" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="180" w:type="dxa"/></w:tblCellMar>`+
		`</w:tblPr><w:tblGrid><w:gridCol w:w="%d"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/>`+
		`<w:shd w:val="clear" w:color="auto" w:fill="%s"/></w:tcPr>`, w, c.indent, st.border, w, w, st.fill)
	p := newPara()
	p.keepNx = true
	p.after = 60
	out.WriteString("<w:p>" + p.xml() + run(st.label, runProps{bold: true, color: st.border}) + "</w:p>")
	cc := ctx{inCell: true}
	b.blocks(out, n.Content, cc)
	out.WriteString(`</w:tc></w:tr></w:tbl><w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>`)
}

// ---------- tablas ----------

type cellLayout struct {
	node         *Node
	col, span    int
	rowspan      int
	continuation bool // celda fusionada verticalmente con la de arriba
}

func (b *builder) table(out *strings.Builder, n Node, c ctx) {
	// Calcula la rejilla teniendo en cuenta colspan y rowspan.
	rows := n.Content
	occ := make([]map[int]int, len(rows)+1)
	for i := range occ {
		occ[i] = map[int]int{}
	}
	layout := make([][]cellLayout, len(rows))
	ncols := 0
	var widths []float64
	for r := range rows {
		col := 0
		flush := func(limit int) {
			for {
				span, ok := occ[r][col]
				if !ok || (limit >= 0 && col >= limit) {
					return
				}
				layout[r] = append(layout[r], cellLayout{col: col, span: span, continuation: true})
				col += span
			}
		}
		for ci := range rows[r].Content {
			cell := &rows[r].Content[ci]
			flush(-1)
			span := max(1, int(num(cell.Attrs, "colspan")))
			rs := max(1, int(num(cell.Attrs, "rowspan")))
			for k := 1; k < rs && r+k < len(rows); k++ {
				occ[r+k][col] = span
			}
			layout[r] = append(layout[r], cellLayout{node: cell, col: col, span: span, rowspan: rs})
			if cw, ok := cell.Attrs["colwidth"].([]any); ok {
				for k, v := range cw {
					for len(widths) <= col+k {
						widths = append(widths, 0)
					}
					if f, ok := v.(float64); ok {
						widths[col+k] = f
					}
				}
			}
			col += span
		}
		flush(-1)
		ncols = max(ncols, col)
	}
	if ncols == 0 {
		return
	}
	total := b.contentW - c.indent
	grid := make([]int, ncols)
	known, unknown := 0.0, 0
	for i := 0; i < ncols; i++ {
		if i < len(widths) && widths[i] > 0 {
			known += widths[i]
		} else {
			unknown++
		}
	}
	for i := range grid {
		if unknown == 0 && known > 0 {
			grid[i] = int(float64(total) * widths[i] / known)
		} else {
			grid[i] = total / ncols
		}
	}

	fmt.Fprintf(out, `<w:tbl><w:tblPr><w:tblW w:w="%d" w:type="dxa"/><w:tblInd w:w="%d" w:type="dxa"/>`+
		`<w:tblBorders><w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/>`+
		`<w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/>`+
		`<w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/></w:tblBorders>`+
		`<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>`+
		`</w:tblPr><w:tblGrid>`, total, c.indent)
	for _, g := range grid {
		fmt.Fprintf(out, `<w:gridCol w:w="%d"/>`, g)
	}
	out.WriteString(`</w:tblGrid>`)
	for r, row := range layout {
		out.WriteString("<w:tr>")
		allHeader := len(rows[r].Content) > 0
		for _, cell := range rows[r].Content {
			if cell.Type != "tableHeader" {
				allHeader = false
			}
		}
		if allHeader && r == 0 {
			out.WriteString(`<w:trPr><w:tblHeader/></w:trPr>`)
		}
		for _, cl := range row {
			w := 0
			for k := cl.col; k < cl.col+cl.span && k < ncols; k++ {
				w += grid[k]
			}
			fmt.Fprintf(out, `<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/>`, w)
			if cl.span > 1 {
				fmt.Fprintf(out, `<w:gridSpan w:val="%d"/>`, cl.span)
			}
			if cl.continuation {
				out.WriteString(`<w:vMerge/></w:tcPr><w:p/></w:tc>`)
				continue
			}
			if cl.rowspan > 1 {
				out.WriteString(`<w:vMerge w:val="restart"/>`)
			}
			header := cl.node.Type == "tableHeader"
			if bg := hexColor(str(cl.node.Attrs, "background")); bg != "" {
				out.WriteString(`<w:shd w:val="clear" w:color="auto" w:fill="` + bg + `"/>`)
			} else if header {
				out.WriteString(`<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>`)
			}
			out.WriteString(`</w:tcPr>`)
			var inner strings.Builder
			b.blocks(&inner, cl.node.Content, ctx{inCell: true, bold: header})
			if !strings.HasSuffix(inner.String(), "</w:p>") {
				inner.WriteString("<w:p/>")
			}
			out.WriteString(inner.String() + "</w:tc>")
		}
		out.WriteString("</w:tr>")
	}
	out.WriteString(`</w:tbl><w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>`)
}

// ---------- índice ----------

func (b *builder) collectHeadings(n Node) {
	if n.Type == "heading" {
		if t := strings.TrimSpace(plainText(n)); t != "" {
			b.headings = append(b.headings, heading{level: int(num(n.Attrs, "level")), text: t})
		}
	}
	if n.Type == "toggle" && boolean(n.Attrs, "solution") && b.opt.StudentVersion {
		return
	}
	for _, c := range n.Content {
		b.collectHeadings(c)
	}
}

func (b *builder) toc(out *strings.Builder) {
	p := newPara()
	p.style = "TOCHeading"
	out.WriteString("<w:p>" + p.xml() + run("Índice", runProps{}) + "</w:p>")
	out.WriteString(`<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>` +
		`<w:r><w:instrText xml:space="preserve"> TOC \o "1-3" \h \z \u </w:instrText></w:r>` +
		`<w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>`)
	for _, h := range b.headings {
		if h.level > 3 {
			continue
		}
		p := newPara()
		p.style = "TOC" + strconv.Itoa(clamp(h.level, 1, 3))
		out.WriteString("<w:p>" + p.xml() + run(h.text, runProps{}) + "</w:p>")
	}
	out.WriteString(`<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`)
}

// ---------- texto en línea ----------

type runProps struct {
	bold, italic, underline, strike, code bool
	vert                                  string
	color, highlight, font                string
	size                                  float64
	style                                 string
}

func (r runProps) xml() string {
	var s strings.Builder
	if r.style != "" {
		s.WriteString(`<w:rStyle w:val="` + r.style + `"/>`)
	}
	font := r.font
	if r.code {
		font = "Consolas"
	}
	if font != "" {
		f := esc(font)
		s.WriteString(`<w:rFonts w:ascii="` + f + `" w:hAnsi="` + f + `" w:cs="` + f + `"/>`)
	}
	if r.bold {
		s.WriteString(`<w:b/><w:bCs/>`)
	}
	if r.italic {
		s.WriteString(`<w:i/><w:iCs/>`)
	}
	if r.strike {
		s.WriteString(`<w:strike/>`)
	}
	if r.color != "" {
		s.WriteString(`<w:color w:val="` + r.color + `"/>`)
	}
	if r.size > 0 {
		fmt.Fprintf(&s, `<w:sz w:val="%d"/><w:szCs w:val="%d"/>`, int(r.size*2), int(r.size*2))
	}
	if r.underline {
		s.WriteString(`<w:u w:val="single"/>`)
	}
	if r.highlight != "" {
		s.WriteString(`<w:shd w:val="clear" w:color="auto" w:fill="` + r.highlight + `"/>`)
	} else if r.code {
		s.WriteString(`<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>`)
	}
	if r.vert != "" {
		s.WriteString(`<w:vertAlign w:val="` + r.vert + `"/>`)
	}
	if s.Len() == 0 {
		return ""
	}
	return "<w:rPr>" + s.String() + "</w:rPr>"
}

func run(text string, rp runProps) string {
	if text == "" {
		return ""
	}
	var s strings.Builder
	parts := strings.Split(text, "\t")
	s.WriteString("<w:r>" + rp.xml())
	for i, p := range parts {
		if i > 0 {
			s.WriteString("<w:tab/>")
		}
		if p != "" {
			s.WriteString(`<w:t xml:space="preserve">` + esc(p) + `</w:t>`)
		}
	}
	s.WriteString("</w:r>")
	return s.String()
}

func applyMarks(rp runProps, marks []Mark) (runProps, string) {
	href := ""
	for _, m := range marks {
		switch m.Type {
		case "bold":
			rp.bold = true
		case "italic":
			rp.italic = true
		case "underline":
			rp.underline = true
		case "strike":
			rp.strike = true
		case "code":
			rp.code = true
		case "subscript":
			rp.vert = "subscript"
		case "superscript":
			rp.vert = "superscript"
		case "highlight":
			rp.highlight = hexColor(str(m.Attrs, "color"))
			if rp.highlight == "" {
				rp.highlight = "FFF3A3"
			}
		case "textStyle":
			if c := hexColor(str(m.Attrs, "color")); c != "" {
				rp.color = c
			}
			if f := str(m.Attrs, "fontFamily"); f != "" {
				// «'Inter Variable', …» → «Inter»: Word usa el nombre de la familia.
				rp.font = strings.TrimSuffix(strings.Trim(strings.Split(f, ",")[0], `"' `), " Variable")
			}
			if sz := parseSize(str(m.Attrs, "fontSize")); sz > 0 {
				rp.size = sz
			}
		case "link":
			href = str(m.Attrs, "href")
		}
	}
	return rp, href
}

func (b *builder) inlines(nodes []Node, base runProps) string {
	var out strings.Builder
	var open []string
	closeCmt := func(id string) {
		cid := b.commentIDs[id]
		fmt.Fprintf(&out, `<w:commentRangeEnd w:id="%d"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="%d"/></w:r>`, cid, cid)
	}
	for _, n := range nodes {
		ids := map[string]Mark{}
		for _, m := range n.Marks {
			if m.Type == "comment" {
				ids[str(m.Attrs, "id")] = m
			}
		}
		kept := open[:0]
		for _, id := range open {
			if _, ok := ids[id]; ok {
				kept = append(kept, id)
			} else {
				closeCmt(id)
			}
		}
		open = kept
		for id, m := range ids {
			if b.usedCmt[id] || id == "" {
				continue
			}
			b.usedCmt[id] = true
			cid := len(b.comments)
			b.commentIDs[id] = cid
			date := str(m.Attrs, "created")
			if date == "" {
				date = b.opt.Now.UTC().Format(time.RFC3339)
			}
			author := str(m.Attrs, "author")
			if author == "" {
				author = b.opt.Author
			}
			b.comments = append(b.comments, comment{id: cid, text: str(m.Attrs, "text"), author: author, date: date})
			fmt.Fprintf(&out, `<w:commentRangeStart w:id="%d"/>`, cid)
			open = append(open, id)
		}
		out.WriteString(b.inline(n, base))
	}
	for _, id := range open {
		closeCmt(id)
	}
	return out.String()
}

func (b *builder) inline(n Node, base runProps) string {
	rp, href := applyMarks(base, n.Marks)
	switch n.Type {
	case "text":
		if strings.HasPrefix(href, "#") && len(href) > 1 {
			rp.style = "Hyperlink"
			return `<w:hyperlink w:anchor="` + esc(bookmarkName(strings.TrimPrefix(href, "#"))) + `" w:history="1">` + run(n.Text, rp) + `</w:hyperlink>`
		}
		if href != "" && (strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://") || strings.HasPrefix(href, "mailto:")) {
			id := b.addRel(relHyperlink, href, "External")
			rp.style = "Hyperlink"
			return `<w:hyperlink r:id="` + id + `" w:history="1">` + run(n.Text, rp) + `</w:hyperlink>`
		}
		return run(n.Text, rp)
	case "hardBreak":
		return `<w:r><w:br/></w:r>`
	case "mathInline":
		rp.italic = true
		rp.font = "Cambria Math"
		return run(LatexToText(str(n.Attrs, "latex")), rp)
	case "footnote":
		b.footnotes = append(b.footnotes, str(n.Attrs, "text"))
		return fmt.Sprintf(`<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="%d"/></w:r>`, len(b.footnotes))
	case "image":
		return b.imageRun(n)
	}
	return ""
}

// ---------- imágenes ----------

func (b *builder) imagePara(n Node, c ctx) string {
	p := newPara()
	p.align = alignment(str(n.Attrs, "align"))
	if p.align == "" {
		p.align = "center"
	}
	p.indent = c.indent
	r := b.imageRun(n)
	if r == "" {
		return ""
	}
	return "<w:p>" + p.xml() + r + "</w:p>"
}

func (b *builder) imageRun(n Node) string {
	src := str(n.Attrs, "src")
	if src == "" || b.opt.ResolveImage == nil {
		return ""
	}
	data, err := b.opt.ResolveImage(src)
	if err != nil {
		return run("[imagen no disponible]", runProps{italic: true, color: "888888"})
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return run("[formato de imagen no compatible]", runProps{italic: true, color: "888888"})
	}
	rid, ok := b.mediaByKey[src]
	if !ok {
		ext := map[string]string{"jpeg": "jpg"}[format]
		if ext == "" {
			ext = format
		}
		name := fmt.Sprintf("image%d.%s", len(b.media)+1, ext)
		b.media = append(b.media, media{name: name, data: data})
		rid = b.addRel(relImage, "media/"+name, "")
		b.mediaByKey[src] = rid
	}
	// 96 ppp: 1 px = 9525 EMU; 1 twip = 635 EMU.
	wpx := float64(cfg.Width)
	if w := num(n.Attrs, "width"); w > 0 {
		wpx = w
	}
	ratio := float64(cfg.Height) / math.Max(1, float64(cfg.Width))
	maxEMU := float64(b.contentW) * 635
	cx := math.Min(wpx*9525, maxEMU)
	cy := cx * ratio
	b.drawingID++
	alt := esc(str(n.Attrs, "alt"))
	return fmt.Sprintf(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">`+
		`<wp:extent cx="%d" cy="%d"/><wp:docPr id="%d" name="Imagen %d" descr="%s"/>`+
		`<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>`+
		`<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`+
		`<pic:pic><pic:nvPicPr><pic:cNvPr id="%d" name="Imagen %d"/><pic:cNvPicPr/></pic:nvPicPr>`+
		`<pic:blipFill><a:blip r:embed="%s"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`+
		`<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`+
		`</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`,
		int(cx), int(cy), b.drawingID, b.drawingID, alt, b.drawingID, b.drawingID, rid, int(cx), int(cy))
}

func (b *builder) addRel(typ, target, mode string) string {
	id := fmt.Sprintf("rId%d", len(b.rels)+10)
	b.rels = append(b.rels, rel{id: id, typ: typ, target: target, mode: mode})
	return id
}

// ---------- utilidades ----------

func plainText(n Node) string {
	if n.Type == "text" {
		return n.Text
	}
	if n.Type == "hardBreak" {
		return "\n"
	}
	var s strings.Builder
	for _, c := range n.Content {
		s.WriteString(plainText(c))
	}
	return s.String()
}

func str(m map[string]any, k string) string {
	if v, ok := m[k].(string); ok {
		return v
	}
	return ""
}

func num(m map[string]any, k string) float64 {
	switch v := m[k].(type) {
	case float64:
		return v
	case string:
		f, _ := strconv.ParseFloat(v, 64)
		return f
	}
	return 0
}

func boolean(m map[string]any, k string) bool {
	v, _ := m[k].(bool)
	return v
}

func clamp(v, lo, hi int) int { return max(lo, min(hi, v)) }

func alignment(a string) string {
	switch a {
	case "center":
		return "center"
	case "right":
		return "right"
	case "justify":
		return "both"
	}
	return ""
}

func parseSize(s string) float64 {
	s = strings.TrimSpace(s)
	switch {
	case strings.HasSuffix(s, "pt"):
		f, _ := strconv.ParseFloat(strings.TrimSuffix(s, "pt"), 64)
		return f
	case strings.HasSuffix(s, "px"):
		f, _ := strconv.ParseFloat(strings.TrimSuffix(s, "px"), 64)
		return f * 0.75
	}
	f, _ := strconv.ParseFloat(s, 64)
	return f
}

// hexColor normaliza "#abc", "#aabbcc" o "rgb(r, g, b)" a "AABBCC".
func hexColor(c string) string {
	c = strings.TrimSpace(c)
	if strings.HasPrefix(c, "rgb") {
		inner := c[strings.Index(c, "(")+1 : max(strings.Index(c, "("), strings.LastIndex(c, ")"))]
		parts := strings.Split(inner, ",")
		if len(parts) < 3 {
			return ""
		}
		var out string
		for _, p := range parts[:3] {
			v, err := strconv.Atoi(strings.TrimSpace(p))
			if err != nil {
				return ""
			}
			out += fmt.Sprintf("%02X", clamp(v, 0, 255))
		}
		return out
	}
	c = strings.TrimPrefix(c, "#")
	if len(c) == 3 {
		c = string([]byte{c[0], c[0], c[1], c[1], c[2], c[2]})
	}
	if len(c) != 6 {
		return ""
	}
	if _, err := strconv.ParseUint(c, 16, 32); err != nil {
		return ""
	}
	return strings.ToUpper(c)
}

func esc(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == '&':
			b.WriteString("&amp;")
		case r == '<':
			b.WriteString("&lt;")
		case r == '>':
			b.WriteString("&gt;")
		case r == '"':
			b.WriteString("&quot;")
		case r == '\t' || r == '\n' || r == '\r':
			b.WriteRune(' ')
		case r < 0x20 || r == 0xFFFE || r == 0xFFFF:
			// caracteres no permitidos en XML
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func mmToTwip(mm float64) int { return int(mm * 56.6929) }

func pageSize(s store.PageSetup) (int, int) {
	w, h := 11906, 16838 // A4
	switch s.Paper {
	case "Letter":
		w, h = 12240, 15840
	case "A5":
		w, h = 8391, 11906
	case "Legal":
		w, h = 12240, 20160
	}
	if s.Orientation == "landscape" {
		w, h = h, w
	}
	return w, h
}

// ExpandPlaceholders sustituye {titulo}, {fecha} y {autor} en encabezados y pies.
func ExpandPlaceholders(s, title, author string, now time.Time) string {
	return strings.NewReplacer("{titulo}", title, "{título}", title, "{fecha}", now.Format("02/01/2006"), "{autor}", author).Replace(s)
}
