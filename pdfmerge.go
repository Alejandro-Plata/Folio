package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"folio/internal/core"
)

// ChoosePdfs abre el diálogo del sistema para elegir uno o varios PDF.
func (a *App) ChoosePdfs() ([]core.PdfFile, error) {
	paths, err := wruntime.OpenMultipleFilesDialog(a.ctx, wruntime.OpenDialogOptions{
		Title:   "Elegir PDF para unir",
		Filters: []wruntime.FileFilter{{DisplayName: "PDF (*.pdf)", Pattern: "*.pdf"}},
	})
	if err != nil {
		return nil, err
	}
	return a.PdfInfo(paths), nil
}

// RenderPdfTemp genera un PDF temporal a partir del HTML de impresión (para
// añadir un documento de Folio a la unión). El archivo se borra al cerrar.
func (a *App) RenderPdfTemp(title, html string) (core.PdfFile, error) {
	dir := filepath.Join(os.TempDir(), "folio-merge")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return core.PdfFile{}, err
	}
	out := filepath.Join(dir, fmt.Sprintf("%s-%d.pdf", core.SafeFileName(title), len(a.tempPdfs)))
	if err := renderPDF(a.localizeAssets(html), out); err != nil {
		return core.PdfFile{}, err
	}
	a.tempPdfs = append(a.tempPdfs, out)
	f := a.PdfInfo([]string{out})[0]
	f.Name = title
	return f, nil
}

// MergePdfs une los archivos en el orden dado y pregunta dónde guardar.
// Devuelve la ruta del PDF creado ("" si se cancela).
func (a *App) MergePdfs(items []core.MergeItem, opt core.MergeOptions) (string, error) {
	if len(items) < 2 {
		return "", errors.New("elige al menos dos archivos para unir")
	}
	out, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
		Title: "Guardar PDF unido", DefaultFilename: core.SafeFileName(items[0].Name) + " (unido).pdf",
		Filters: []wruntime.FileFilter{{DisplayName: "PDF (*.pdf)", Pattern: "*.pdf"}},
	})
	if err != nil || out == "" {
		return "", err
	}
	if !strings.HasSuffix(strings.ToLower(out), ".pdf") {
		out += ".pdf"
	}
	if err := a.MergePdfsTo(items, out, opt.Bookmarks); err != nil {
		return "", err
	}
	if opt.Open {
		_ = openPath(out)
	}
	return out, nil
}

// cleanupTempPdfs borra los PDF temporales de documentos de Folio.
func (a *App) cleanupTempPdfs() {
	for _, p := range a.tempPdfs {
		_ = os.Remove(p)
	}
	a.tempPdfs = nil
}
