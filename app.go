package main

import (
	"context"
	"fmt"
	"net/http"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync/atomic"
	"time"

	"folio/internal/core"
	"folio/internal/paths"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App es la aplicación de escritorio: el núcleo (core.Service, cuyos métodos
// publica Wails tal cual) más lo que necesita ventana, diálogos y navegador.
type App struct {
	*core.Service
	ctx        context.Context
	dictation  dictation
	allowClose atomic.Bool
	tempPdfs   []string // PDF temporales de «Unir PDF»
}

func NewApp() *App {
	a := &App{}
	svc, err := core.New(core.Options{
		ConfigDir: paths.ConfigDir(), Workspace: paths.DefaultWorkspace(), OS: goruntime.GOOS, Version: Version,
		Emit: func(name string, data ...any) {
			if a.ctx != nil {
				wruntime.EventsEmit(a.ctx, name, data...)
			}
		},
		Secrets: keyringSecrets{},
	})
	if err != nil {
		panic(err)
	}
	a.Service = svc
	return a
}

func (a *App) startup(ctx context.Context) { a.ctx = ctx }

// Tamaño inicial de la ventana y espacio que se reserva para la barra de
// tareas y la barra de título del sistema.
const (
	windowWidth   = 1320
	windowHeight  = 860
	chromeReserve = 110
)

// domReady maximiza la ventana si no cabe entera en la pantalla. En portátiles
// de 13-14" (1366×768, o 1920×1080 al 125 %) la ventana de 860 px quedaba por
// debajo de la barra de tareas de Windows y tapaba el pie del panel lateral;
// maximizada, el sistema la ajusta al área libre.
func (a *App) domReady(ctx context.Context) {
	screens, err := wruntime.ScreenGetAll(ctx)
	if err != nil {
		return
	}
	for _, s := range screens {
		if !s.IsCurrent {
			continue
		}
		if s.Size.Width < windowWidth+40 || s.Size.Height < windowHeight+chromeReserve {
			wruntime.WindowMaximise(ctx)
		}
		return
	}
}

// beforeClose da a la interfaz la oportunidad de guardar lo pendiente antes de
// salir. Si no responde en 3 segundos, se cierra igualmente.
func (a *App) beforeClose(ctx context.Context) bool {
	if a.allowClose.Load() {
		return false
	}
	wruntime.EventsEmit(ctx, "app:before-close")
	go func() {
		time.Sleep(3 * time.Second)
		if !a.allowClose.Swap(true) {
			wruntime.Quit(ctx)
		}
	}()
	return true
}

func (a *App) shutdown(context.Context) {
	a.Service.Shutdown()
	a.cleanupTempPdfs()
}

// ConfirmClose lo llama la interfaz cuando ya ha guardado todo.
func (a *App) ConfirmClose() {
	a.allowClose.Store(true)
	wruntime.Quit(a.ctx)
}

// filesHandler sirve las imágenes de los documentos en /files/<id>/<archivo>.
func (a *App) filesHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/files/") {
			http.NotFound(w, r)
			return
		}
		p, err := a.AssetPath(r.URL.Path)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "max-age=31536000, immutable")
		http.ServeFile(w, r, p)
	})
}

// ---------- Funciones con diálogos del sistema ----------

// ExportDocx pide la ruta con el diálogo del sistema y escribe el .docx.
// Devuelve "" si el usuario cancela.
func (a *App) ExportDocx(id string, opt core.ExportOptions) (string, error) {
	doc, err := a.GetDoc(id)
	if err != nil {
		return "", err
	}
	name := safeFileName(doc.Meta.Title)
	if opt.StudentVersion {
		name += " (alumno)"
	}
	path, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
		Title: "Exportar a Word", DefaultFilename: name + ".docx",
		Filters: []wruntime.FileFilter{{DisplayName: "Documento de Word (*.docx)", Pattern: "*.docx"}},
	})
	if err != nil || path == "" {
		return "", err
	}
	if !strings.HasSuffix(strings.ToLower(path), ".docx") {
		path += ".docx"
	}
	return path, a.ExportDocxTo(id, opt, path)
}

// SaveTextFile guarda texto (HTML, Markdown…) donde elija el usuario.
func (a *App) SaveTextFile(defaultName, content, filterName, pattern string) (string, error) {
	path, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
		Title: "Exportar", DefaultFilename: defaultName,
		Filters: []wruntime.FileFilter{{DisplayName: filterName, Pattern: pattern}},
	})
	if err != nil || path == "" {
		return "", err
	}
	if ext := filepath.Ext(defaultName); ext != "" && !strings.HasSuffix(strings.ToLower(path), ext) {
		path += ext
	}
	return path, a.WriteTextFile(path, content)
}

// OpenImportFile abre el diálogo para importar .docx, .md, .html o .txt.
func (a *App) OpenImportFile() (*core.ImportedFile, error) {
	path, err := wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Importar documento",
		Filters: []wruntime.FileFilter{
			{DisplayName: "Documentos (*.docx, *.md, *.html, *.txt)", Pattern: "*.docx;*.md;*.markdown;*.html;*.htm;*.txt"},
		},
	})
	if err != nil || path == "" {
		return nil, err
	}
	return a.ImportFromPath(path)
}

// NoteFile es un archivo elegido para adjuntarlo como apuntes de un tema.
type NoteFile struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

// ChooseNoteFiles abre el diálogo para elegir uno o varios archivos de apuntes.
func (a *App) ChooseNoteFiles() ([]NoteFile, error) {
	paths, err := wruntime.OpenMultipleFilesDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Añadir apuntes",
		Filters: []wruntime.FileFilter{
			{DisplayName: "Apuntes (PDF, Word, presentaciones, imágenes, texto)", Pattern: "*.pdf;*.docx;*.doc;*.odt;*.pptx;*.ppt;*.odp;*.rtf;*.txt;*.md;*.epub;*.png;*.jpg;*.jpeg"},
			{DisplayName: "Todos los archivos", Pattern: "*"},
		},
	})
	if err != nil {
		return nil, err
	}
	out := make([]NoteFile, 0, len(paths))
	for _, p := range paths {
		out = append(out, NoteFile{Path: p, Name: filepath.Base(p)})
	}
	return out, nil
}

// OpenTopicFile abre un apunte adjunto con la aplicación predeterminada del sistema.
func (a *App) OpenTopicFile(rel string) error {
	p := a.AgendaTopicFilePath(rel)
	if p == "" {
		return fmt.Errorf("ruta de apuntes no válida")
	}
	if goruntime.GOOS == "windows" {
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", p).Start()
	}
	return openPath(p)
}

// ChooseWorkspace cambia la carpeta donde se guardan los documentos.
func (a *App) ChooseWorkspace() (string, error) {
	dir, err := wruntime.OpenDirectoryDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Carpeta de documentos", DefaultDirectory: a.Workspace(), CanCreateDirectories: true,
	})
	if err != nil || dir == "" {
		return "", err
	}
	return dir, a.SwitchWorkspace(dir)
}

func (a *App) OpenWorkspaceFolder() error { return openPath(a.Workspace()) }

func (a *App) OpenURL(url string) {
	if strings.HasPrefix(url, "http://") || strings.HasPrefix(url, "https://") || strings.HasPrefix(url, "mailto:") {
		wruntime.BrowserOpenURL(a.ctx, url)
	}
}

func (a *App) RevealFile(path string) error { return openPath(filepath.Dir(path)) }

func openPath(p string) error {
	switch goruntime.GOOS {
	case "windows":
		return exec.Command("explorer", p).Start()
	case "darwin":
		return exec.Command("open", p).Start()
	}
	return exec.Command("xdg-open", p).Start()
}

func safeFileName(s string) string { return core.SafeFileName(s) }

var errNoBrowser = fmt.Errorf("no se encontró Chrome, Edge ni Chromium para generar el PDF; usa Imprimir (Ctrl+P) y elige «Guardar como PDF»")
