package core

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

func init() {
	// pdfcpu no debe crear su carpeta de configuración en el equipo del usuario.
	model.ConfigPath = "disable"
}

// PdfFile describe un PDF elegido para unir.
type PdfFile struct {
	Path  string `json:"path"`
	Name  string `json:"name"`
	Pages int    `json:"pages"`
	Error string `json:"error,omitempty"` // dañado, protegido con contraseña…
}

// MergeItem es un archivo de la lista, con un rango de páginas opcional
// («1-3, 7»; vacío = todas).
type MergeItem struct {
	Path  string `json:"path"`
	Name  string `json:"name"`
	Pages string `json:"pages"`
}

type MergeOptions struct {
	Bookmarks bool `json:"bookmarks"` // un marcador por archivo con su nombre
	Open      bool `json:"open"`      // abrir el PDF al terminar
}

// PdfInfo devuelve el número de páginas de cada archivo, o por qué no se puede usar.
func (s *Service) PdfInfo(paths []string) []PdfFile {
	out := make([]PdfFile, 0, len(paths))
	for _, p := range paths {
		f := PdfFile{Path: p, Name: strings.TrimSuffix(filepath.Base(p), filepath.Ext(p))}
		n, err := api.PageCountFile(p)
		if err != nil {
			f.Error = pdfErrorText(err)
		}
		f.Pages = n
		out = append(out, f)
	}
	return out
}

// MergePdfsTo une los archivos, en el orden dado, en la ruta indicada.
func (s *Service) MergePdfsTo(items []MergeItem, out string, bookmarks bool) error {
	if len(items) < 2 {
		return errors.New("elige al menos dos archivos para unir")
	}
	return mergePdfs(items, out, bookmarks)
}

// mergePdfs hace la unión. Cada archivo se copia (o se recorta a su rango) a
// una carpeta temporal; después se añade un marcador por archivo con su nombre.
func mergePdfs(items []MergeItem, out string, bookmarks bool) error {
	tmp, err := os.MkdirTemp("", "folio-merge-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	conf := model.NewDefaultConfiguration()
	conf.CreateBookmarks = false
	files := make([]string, 0, len(items))
	var marks []pdfcpu.Bookmark
	page := 1
	for i, it := range items {
		dst := filepath.Join(tmp, fmt.Sprintf("%03d.pdf", i))
		if sel := pageSelection(it.Pages); len(sel) > 0 {
			err = api.TrimFile(it.Path, dst, sel, conf)
		} else {
			err = copyFile(it.Path, dst)
		}
		if err != nil {
			return fmt.Errorf("«%s»: %s", it.Name, pdfErrorText(err))
		}
		n, err := api.PageCountFile(dst)
		if err != nil {
			return fmt.Errorf("«%s»: %s", it.Name, pdfErrorText(err))
		}
		title := strings.TrimSpace(it.Name)
		if title == "" {
			title = fmt.Sprintf("Archivo %d", i+1)
		}
		marks = append(marks, pdfcpu.Bookmark{Title: title, PageFrom: page})
		page += n
		files = append(files, dst)
	}
	merged := filepath.Join(tmp, "unido.pdf")
	if err := api.MergeCreateFile(files, merged, false, conf); err != nil {
		return errors.New("no se pudieron unir los PDF: " + pdfErrorText(err))
	}
	if bookmarks {
		withMarks := filepath.Join(tmp, "marcadores.pdf")
		if err := api.AddBookmarksFile(merged, withMarks, marks, true, conf); err != nil {
			return errors.New("no se pudieron añadir los marcadores: " + err.Error())
		}
		merged = withMarks
	}
	return copyFile(merged, out)
}

// pageSelection convierte «1-3, 7; 10-» al formato de pdfcpu.
func pageSelection(s string) []string {
	var sel []string
	for _, part := range strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ';' || r == ' ' }) {
		if part = strings.TrimSpace(part); part != "" {
			sel = append(sel, part)
		}
	}
	return sel
}

func pdfErrorText(err error) string {
	msg := err.Error()
	low := strings.ToLower(msg)
	switch {
	case strings.Contains(low, "password") || strings.Contains(low, "encrypt"):
		return "está protegido con contraseña"
	case strings.Contains(low, "selected pages") || strings.Contains(low, "page selection"):
		return "el rango de páginas no es válido"
	case strings.Contains(low, "no such file"):
		return "el archivo ya no existe"
	}
	return "no es un PDF válido o está dañado (" + msg + ")"
}

func copyFile(src, dst string) error {
	b, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, b, 0o644)
}
