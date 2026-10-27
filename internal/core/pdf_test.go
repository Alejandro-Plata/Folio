package core

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
)

// writeTestPDF crea un PDF mínimo válido con n páginas en blanco.
func writeTestPDF(t *testing.T, path string, n int) {
	t.Helper()
	var objs []string
	kids := ""
	for i := 0; i < n; i++ {
		kids += fmt.Sprintf("%d 0 R ", 3+i)
	}
	objs = append(objs, "<< /Type /Catalog /Pages 2 0 R >>")
	objs = append(objs, fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", kids, n))
	for i := 0; i < n; i++ {
		objs = append(objs, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>")
	}
	var b bytes.Buffer
	b.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objs))
	for i, o := range objs {
		offsets[i] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, o)
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(objs)+1)
	for _, off := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objs)+1, xref)
	if err := os.WriteFile(path, b.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestMergePdfs(t *testing.T) {
	dir := t.TempDir()
	a, b := filepath.Join(dir, "a.pdf"), filepath.Join(dir, "b.pdf")
	writeTestPDF(t, a, 3)
	writeTestPDF(t, b, 5)

	out := filepath.Join(dir, "unido.pdf")
	items := []MergeItem{{Path: a, Name: "Tema 1"}, {Path: b, Name: "Tema 2", Pages: "1-2, 5"}}
	if err := mergePdfs(items, out, true); err != nil {
		t.Fatal(err)
	}
	n, err := api.PageCountFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if n != 6 {
		t.Fatalf("páginas = %d, se esperaban 6 (3 + 3)", n)
	}
	bms, err := api.Bookmarks(mustOpen(t, out), nil)
	if err != nil {
		t.Fatal(err)
	}
	var titles []string
	for _, bm := range bms {
		titles = append(titles, bm.Title)
	}
	if !reflect.DeepEqual(titles, []string{"Tema 1", "Tema 2"}) {
		t.Fatalf("marcadores = %v", titles)
	}
}

func TestMergePdfsErrors(t *testing.T) {
	dir := t.TempDir()
	good := filepath.Join(dir, "ok.pdf")
	writeTestPDF(t, good, 1)
	bad := filepath.Join(dir, "roto.pdf")
	os.WriteFile(bad, []byte("esto no es un pdf"), 0o644)

	infos := (&Service{}).PdfInfo([]string{good, bad})
	if infos[0].Pages != 1 || infos[0].Error != "" {
		t.Fatalf("PDF válido: %+v", infos[0])
	}
	if infos[1].Error == "" {
		t.Fatal("el PDF dañado debería avisar")
	}
	err := mergePdfs([]MergeItem{{Path: good, Name: "ok"}, {Path: bad, Name: "roto"}}, filepath.Join(dir, "x.pdf"), false)
	if err == nil {
		t.Fatal("unir con un PDF dañado debería fallar con un mensaje claro")
	}
}

func TestPageSelection(t *testing.T) {
	got := pageSelection(" 1-3, 7;10- ")
	if !reflect.DeepEqual(got, []string{"1-3", "7", "10-"}) {
		t.Fatalf("%v", got)
	}
	if pageSelection("") != nil {
		t.Fatal("vacío = todas las páginas")
	}
}

func mustOpen(t *testing.T, p string) *os.File {
	t.Helper()
	f, err := os.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.Close() })
	return f
}
