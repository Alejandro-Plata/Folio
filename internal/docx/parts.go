package docx

import (
	"fmt"
	"strings"

	"folio/internal/store"
)

const nsAll = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
	`xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
	`xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
	`xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
	`xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`

const xmlHeader = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`

const rootRels = xmlHeader + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
	`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
	`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
	`<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
	`</Relationships>`

const appXML = xmlHeader + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Folio</Application></Properties>`

const settingsXML = xmlHeader + `<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
	`<w:updateFields w:val="true"/><w:defaultTabStop w:val="708"/><w:characterSpacingControl w:val="doNotCompress"/>` +
	`<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>` +
	`<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>` +
	`</w:settings>`

func (b *builder) contentTypes() string {
	var s strings.Builder
	s.WriteString(xmlHeader + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
		`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
		`<Default Extension="xml" ContentType="application/xml"/>` +
		`<Default Extension="png" ContentType="image/png"/>` +
		`<Default Extension="jpg" ContentType="image/jpeg"/>` +
		`<Default Extension="gif" ContentType="image/gif"/>`)
	for _, o := range []struct{ part, typ string }{
		{"/word/document.xml", "wordprocessingml.document.main"},
		{"/word/styles.xml", "wordprocessingml.styles"},
		{"/word/numbering.xml", "wordprocessingml.numbering"},
		{"/word/settings.xml", "wordprocessingml.settings"},
		{"/word/footnotes.xml", "wordprocessingml.footnotes"},
		{"/word/comments.xml", "wordprocessingml.comments"},
		{"/word/header1.xml", "wordprocessingml.header"},
		{"/word/footer1.xml", "wordprocessingml.footer"},
	} {
		s.WriteString(`<Override PartName="` + o.part + `" ContentType="application/vnd.openxmlformats-officedocument.` + o.typ + `+xml"/>`)
	}
	s.WriteString(`<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
		`<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
		`</Types>`)
	return s.String()
}

func (b *builder) docRels() string {
	var s strings.Builder
	s.WriteString(xmlHeader + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`)
	base := "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
	for i, p := range []struct{ typ, target string }{
		{"styles", "styles.xml"}, {"numbering", "numbering.xml"}, {"settings", "settings.xml"},
		{"footnotes", "footnotes.xml"}, {"comments", "comments.xml"}, {"header", "header1.xml"}, {"footer", "footer1.xml"},
	} {
		fmt.Fprintf(&s, `<Relationship Id="rId%d" Type="%s%s" Target="%s"/>`, i+1, base, p.typ, p.target)
	}
	for _, r := range b.rels {
		mode := ""
		if r.mode != "" {
			mode = ` TargetMode="` + r.mode + `"`
		}
		fmt.Fprintf(&s, `<Relationship Id="%s" Type="%s" Target="%s"%s/>`, r.id, r.typ, esc(r.target), mode)
	}
	s.WriteString(`</Relationships>`)
	return s.String()
}

func (b *builder) sectPr() string {
	st := b.opt.Setup
	w, h := pageSize(st)
	orient := ""
	if st.Orientation == "landscape" {
		orient = ` w:orient="landscape"`
	}
	return fmt.Sprintf(`<w:sectPr><w:headerReference w:type="default" r:id="rId6"/><w:footerReference w:type="default" r:id="rId7"/>`+
		`<w:pgSz w:w="%d" w:h="%d"%s/><w:pgMar w:top="%d" w:right="%d" w:bottom="%d" w:left="%d" w:header="567" w:footer="567" w:gutter="0"/>`+
		`<w:cols w:space="708"/></w:sectPr>`,
		w, h, orient, mmToTwip(st.MarginTop), mmToTwip(st.MarginRight), mmToTwip(st.MarginBottom), mmToTwip(st.MarginLeft))
}

func (b *builder) coreXML() string {
	now := b.opt.Now.UTC().Format("2006-01-02T15:04:05Z")
	return xmlHeader + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
		`xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ` +
		`xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
		`<dc:title>` + esc(b.opt.Title) + `</dc:title><dc:creator>` + esc(b.opt.Author) + `</dc:creator>` +
		`<dcterms:created xsi:type="dcterms:W3CDTF">` + now + `</dcterms:created>` +
		`<dcterms:modified xsi:type="dcterms:W3CDTF">` + now + `</dcterms:modified></cp:coreProperties>`
}

func (b *builder) numberingXML() string {
	bullets := []string{"•", "◦", "▪"}
	formats := []string{"decimal", "lowerLetter", "lowerRoman"}
	var s strings.Builder
	s.WriteString(xmlHeader + `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`)
	for abs := 0; abs < 2; abs++ {
		fmt.Fprintf(&s, `<w:abstractNum w:abstractNumId="%d"><w:multiLevelType w:val="hybridMultilevel"/>`, abs)
		for lvl := 0; lvl < 9; lvl++ {
			ind := 720 * (lvl + 1)
			if abs == 0 {
				fmt.Fprintf(&s, `<w:lvl w:ilvl="%d"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="%s"/><w:lvlJc w:val="left"/>`+
					`<w:pPr><w:ind w:left="%d" w:hanging="360"/></w:pPr></w:lvl>`, lvl, bullets[lvl%3], ind)
			} else {
				fmt.Fprintf(&s, `<w:lvl w:ilvl="%d"><w:start w:val="1"/><w:numFmt w:val="%s"/><w:lvlText w:val="%%%d."/><w:lvlJc w:val="left"/>`+
					`<w:pPr><w:ind w:left="%d" w:hanging="360"/></w:pPr></w:lvl>`, lvl, formats[lvl%3], lvl+1, ind)
			}
		}
		s.WriteString(`</w:abstractNum>`)
	}
	for i, n := range b.nums {
		abs := 0
		if n.ordered {
			abs = 1
		}
		fmt.Fprintf(&s, `<w:num w:numId="%d"><w:abstractNumId w:val="%d"/>`, i+1, abs)
		if n.ordered {
			fmt.Fprintf(&s, `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="%d"/></w:lvlOverride>`, n.start)
		}
		s.WriteString(`</w:num>`)
	}
	s.WriteString(`</w:numbering>`)
	return s.String()
}

func (b *builder) footnotesXML() string {
	var s strings.Builder
	s.WriteString(xmlHeader + `<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
		`<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>` +
		`<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>`)
	for i, text := range b.footnotes {
		fmt.Fprintf(&s, `<w:footnote w:id="%d"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>`+
			`<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>`+
			`<w:r><w:t xml:space="preserve"> %s</w:t></w:r></w:p></w:footnote>`, i+1, esc(text))
	}
	s.WriteString(`</w:footnotes>`)
	return s.String()
}

func (b *builder) commentsXML() string {
	var s strings.Builder
	s.WriteString(xmlHeader + `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`)
	for _, c := range b.comments {
		fmt.Fprintf(&s, `<w:comment w:id="%d" w:author="%s" w:date="%s" w:initials="%s"><w:p><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>`+
			`<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>`+
			`<w:r><w:t xml:space="preserve">%s</w:t></w:r></w:p></w:comment>`,
			c.id, esc(c.author), esc(c.date), esc(initials(c.author)), esc(c.text))
	}
	s.WriteString(`</w:comments>`)
	return s.String()
}

func initials(name string) string {
	var out []rune
	for _, f := range strings.Fields(name) {
		out = append(out, []rune(f)[0])
	}
	return strings.ToUpper(string(out))
}

func (b *builder) headerXML() string {
	text := ExpandPlaceholders(b.opt.Setup.Header, b.opt.Title, b.opt.Author, b.opt.Now)
	return xmlHeader + `<w:hdr ` + nsAll + `><w:p><w:pPr><w:pStyle w:val="Header"/><w:jc w:val="right"/></w:pPr>` +
		run(text, runProps{color: "808080", size: 9}) + `</w:p></w:hdr>`
}

func (b *builder) footerXML() string {
	text := ExpandPlaceholders(b.opt.Setup.Footer, b.opt.Title, b.opt.Author, b.opt.Now)
	rp := runProps{color: "808080", size: 9}
	var s strings.Builder
	s.WriteString(xmlHeader + `<w:ftr ` + nsAll + `><w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="center"/></w:pPr>`)
	s.WriteString(run(text, rp))
	if b.opt.Setup.PageNumbers {
		if text != "" {
			s.WriteString(run("   ·   ", rp))
		}
		s.WriteString(run("Página ", rp))
		s.WriteString(`<w:r>` + rp.xml() + `<w:fldChar w:fldCharType="begin"/></w:r><w:r>` + rp.xml() + `<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
			`<w:r>` + rp.xml() + `<w:fldChar w:fldCharType="separate"/></w:r><w:r>` + rp.xml() + `<w:t>1</w:t></w:r><w:r>` + rp.xml() + `<w:fldChar w:fldCharType="end"/></w:r>`)
		s.WriteString(run(" de ", rp))
		s.WriteString(`<w:r>` + rp.xml() + `<w:fldChar w:fldCharType="begin"/></w:r><w:r>` + rp.xml() + `<w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r>` +
			`<w:r>` + rp.xml() + `<w:fldChar w:fldCharType="separate"/></w:r><w:r>` + rp.xml() + `<w:t>1</w:t></w:r><w:r>` + rp.xml() + `<w:fldChar w:fldCharType="end"/></w:r>`)
	}
	s.WriteString(`</w:p></w:ftr>`)
	return s.String()
}

func stylesXML(st store.PageSetup) string {
	font := st.FontFamily
	if font == "" || font == "Inter" || font == "system-ui" {
		font = "Calibri"
	}
	font = esc(strings.Trim(strings.Split(font, ",")[0], `"' `))
	size := st.FontSize
	if size <= 0 {
		size = 11
	}
	line := st.LineHeight
	if line <= 0 {
		line = 1.15
	}
	hp := func(pt float64) int { return int(pt * 2) }
	para := func(id, name, based, ppr, rpr string, outline int) string {
		ol := ""
		if outline >= 0 {
			ol = fmt.Sprintf(`<w:outlineLvl w:val="%d"/>`, outline)
		}
		basedOn := ""
		if based != "" {
			basedOn = `<w:basedOn w:val="` + based + `"/>`
		}
		return `<w:style w:type="paragraph" w:styleId="` + id + `"><w:name w:val="` + name + `"/>` + basedOn +
			`<w:next w:val="Normal"/><w:qFormat/><w:pPr>` + ppr + ol + `</w:pPr><w:rPr>` + rpr + `</w:rPr></w:style>`
	}
	heading := func(n int, pt float64, before int) string {
		return para(fmt.Sprintf("Heading%d", n), fmt.Sprintf("heading %d", n), "Normal",
			fmt.Sprintf(`<w:keepNext/><w:keepLines/><w:spacing w:before="%d" w:after="80" w:line="240" w:lineRule="auto"/>`, before),
			fmt.Sprintf(`<w:b/><w:color w:val="1F1F1F"/><w:sz w:val="%d"/><w:szCs w:val="%d"/>`, hp(pt), hp(pt)), n-1)
	}
	var s strings.Builder
	s.WriteString(xmlHeader + `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`)
	fmt.Fprintf(&s, `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="%s" w:hAnsi="%s" w:eastAsia="%s" w:cs="%s"/>`+
		`<w:sz w:val="%d"/><w:szCs w:val="%d"/><w:lang w:val="es-ES"/></w:rPr></w:rPrDefault>`+
		`<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="%d" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`,
		font, font, font, font, hp(size), hp(size), int(line*240))
	s.WriteString(`<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`)
	s.WriteString(para("Title", "Title", "Normal", `<w:spacing w:after="240"/>`, fmt.Sprintf(`<w:b/><w:sz w:val="%d"/><w:szCs w:val="%d"/>`, hp(26), hp(26)), -1))
	s.WriteString(heading(1, 20, 360))
	s.WriteString(heading(2, 16, 280))
	s.WriteString(heading(3, 13, 240))
	s.WriteString(heading(4, 12, 200))
	s.WriteString(para("Quote", "Quote", "Normal", `<w:ind w:left="567"/>`, `<w:i/><w:color w:val="555555"/>`, -1))
	s.WriteString(para("Code", "Code", "Normal", `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/>`,
		`<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/>`, -1))
	s.WriteString(para("ListParagraph", "List Paragraph", "Normal", `<w:spacing w:after="40"/><w:contextualSpacing/>`, "", -1))
	s.WriteString(para("TOCHeading", "TOC Heading", "Normal", `<w:spacing w:before="240" w:after="120"/>`, fmt.Sprintf(`<w:b/><w:sz w:val="%d"/>`, hp(16)), -1))
	for i := 1; i <= 3; i++ {
		s.WriteString(para(fmt.Sprintf("TOC%d", i), fmt.Sprintf("toc %d", i), "Normal",
			fmt.Sprintf(`<w:spacing w:after="60"/><w:ind w:left="%d"/>`, (i-1)*360), "", -1))
	}
	s.WriteString(para("FootnoteText", "footnote text", "Normal", `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>`, `<w:sz w:val="18"/>`, -1))
	s.WriteString(para("CommentText", "annotation text", "Normal", "", `<w:sz w:val="20"/>`, -1))
	s.WriteString(para("Header", "header", "Normal", `<w:spacing w:after="0"/>`, "", -1))
	s.WriteString(para("Footer", "footer", "Normal", `<w:spacing w:after="0"/>`, "", -1))
	s.WriteString(`<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1F6FEB"/><w:u w:val="single"/></w:rPr></w:style>`)
	s.WriteString(`<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>`)
	s.WriteString(`<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>`)
	s.WriteString(`</w:styles>`)
	return s.String()
}
