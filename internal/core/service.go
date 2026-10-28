// Package core reúne la lógica de Folio sin depender de la interfaz: la usan
// la app de escritorio (Wails) y la de Android (gomobile). Los métodos
// exportados de Service son los que llama la interfaz.
package core

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"folio/internal/agenda"
	"folio/internal/docx"
	"folio/internal/gastos"
	"folio/internal/social"
	"folio/internal/store"
)

// Emitter envía un evento a la interfaz (nombre y datos serializables a JSON).
type Emitter func(name string, data ...any)

// Options configura el núcleo según la plataforma.
type Options struct {
	ConfigDir string         // ajustes de la app (settings.json)
	Workspace string         // espacio por defecto si los ajustes no dicen otro
	OS        string         // "linux", "windows", "android"
	Version   string         // versión de Folio
	Emit      Emitter        // puede ser nil
	Secrets   social.Secrets // almacén seguro de la plataforma (sesión de la cuenta); puede ser nil
}

type Settings struct {
	Workspace          string  `json:"workspace"`
	Theme              string  `json:"theme"` // system | light | dark
	Zoom               float64 `json:"zoom"`
	ZoomFit            bool    `json:"zoomFit"` // zoom «ajustar al ancho»: la hoja se reduce si no cabe
	SidebarOpen        bool    `json:"sidebarOpen"`
	SidebarWidth       int     `json:"sidebarWidth"`
	AuthorName         string  `json:"authorName"`
	AutoVersionMinutes int     `json:"autoVersionMinutes"`
	LastDoc            string  `json:"lastDoc"`
	Spellcheck         bool    `json:"spellcheck"`
	SmartQuotes        bool    `json:"smartQuotes"`
	PageView           bool    `json:"pageView"` // vista de página (Diseño de impresión) o ancho completo
	ShowMarks          bool    `json:"showMarks"`
	Ribbon             bool    `json:"ribbon"`
	Keymap             string  `json:"keymap"`        // es | en: atajos de Word en español o en inglés
	PinTipShown        bool    `json:"pinTipShown"`   // aviso de anclar a la barra de tareas (Windows) ya mostrado
	TourDone           bool    `json:"tourDone"`      // tutorial guiado visto (o descartado)
	ManualVersion      int     `json:"manualVersion"` // versión del «Manual de Folio» ya instalada en el espacio de trabajo
	// Valores predeterminados de Exportar e Imprimir
	ExportFormat  string `json:"exportFormat"`  // docx | pdf | html | md
	ExportNoTitle bool   `json:"exportNoTitle"` // no incluir el título del documento
	ExportStudent bool   `json:"exportStudent"` // versión del alumnado (sin soluciones)
	// Página de los documentos nuevos; nil = la predeterminada
	DocSetup *store.PageSetup `json:"docSetup,omitempty"`
	// Sync solo se cambia con las funciones Sync* (SaveSettings la conserva)
	Sync SyncConfig `json:"sync"`
}

func defaultSettings(workspace string) Settings {
	return Settings{
		Workspace: workspace, Theme: "system", Zoom: 1, ZoomFit: true, SidebarOpen: true,
		SidebarWidth: 260, AutoVersionMinutes: 10, Spellcheck: true, SmartQuotes: true,
		PageView: true, Ribbon: true, Keymap: "es",
	}
}

type InitData struct {
	Settings  Settings     `json:"settings"`
	Docs      []store.Meta `json:"docs"`
	Version   string       `json:"version"`
	Workspace string       `json:"workspace"`
	OS        string       `json:"os"`
}

type CreateRequest struct {
	ParentID string           `json:"parentId"`
	Title    string           `json:"title"`
	Icon     string           `json:"icon"`
	Content  string           `json:"content"`
	Text     string           `json:"text"`
	Setup    *store.PageSetup `json:"setup"`
}

type ExportOptions struct {
	StudentVersion bool `json:"studentVersion"`
	IncludeTitle   bool `json:"includeTitle"`
}

type ImportedFile struct {
	Name string `json:"name"`
	Ext  string `json:"ext"`
	Data string `json:"data"` // base64
}

// Service es el núcleo de la aplicación.
type Service struct {
	opt        Options
	store      atomic.Pointer[store.Store]
	agenda     atomic.Pointer[agenda.Store]
	realAgenda atomic.Pointer[agenda.Store] // guardada mientras dura el tutorial
	gastos     atomic.Pointer[gastos.Store]
	mu         sync.Mutex
	settings   Settings
	syncing    atomic.Bool
	social     *social.Service
}

// New abre el núcleo: lee los ajustes y abre el espacio de trabajo (si el
// configurado no está disponible, vuelve al predeterminado).
func New(o Options) (*Service, error) {
	s := &Service{opt: o, settings: defaultSettings(o.Workspace)}
	s.social = social.New(filepath.Join(o.ConfigDir, "social"), o.Secrets)
	if b, err := os.ReadFile(s.settingsPath()); err == nil {
		_ = json.Unmarshal(b, &s.settings)
	}
	if err := s.openWorkspace(s.settings.Workspace); err != nil {
		s.settings.Workspace = o.Workspace
		if err := s.openWorkspace(s.settings.Workspace); err != nil {
			return nil, err
		}
	}
	return s, nil
}

func (s *Service) st() *store.Store { return s.store.Load() }

func (s *Service) settingsPath() string { return filepath.Join(s.opt.ConfigDir, "settings.json") }

func (s *Service) openWorkspace(dir string) error {
	st, err := store.Open(dir)
	if err != nil {
		return err
	}
	if m := s.settings.AutoVersionMinutes; m > 0 {
		st.AutoInterval = time.Duration(m) * time.Minute
	}
	ag, err := agenda.Open(filepath.Join(dir, "agenda"))
	if err != nil {
		return err
	}
	ag.SetExternal(s.circleTasks)
	gs, err := gastos.Open(filepath.Join(dir, "gastos"))
	if err != nil {
		return err
	}
	s.store.Store(st)
	s.agenda.Store(ag)
	s.gastos.Store(gs)
	return nil
}

// emit avisa a la interfaz de un evento (no hace nada si no hay receptor).
func (s *Service) emit(name string, data ...any) {
	if s.opt.Emit != nil {
		s.opt.Emit(name, data...)
	}
}

// Workspace devuelve la carpeta de documentos actual.
func (s *Service) Workspace() string { return s.st().Root() }

// SwitchWorkspace cambia la carpeta de documentos y la guarda en los ajustes.
func (s *Service) SwitchWorkspace(dir string) error {
	s.st().SnapshotDirty()
	if err := s.openWorkspace(dir); err != nil {
		return err
	}
	s.mu.Lock()
	s.settings.Workspace = dir
	cur := s.settings
	s.mu.Unlock()
	return s.SaveSettings(cur)
}

// Shutdown guarda lo pendiente (versión «al cerrar»).
func (s *Service) Shutdown() { s.st().SnapshotDirty() }

// AssetPath traduce «/files/<doc>/<archivo>» a la ruta del archivo.
func (s *Service) AssetPath(url string) (string, error) { return s.st().AssetPath(url) }

// ---------- API expuesta a la interfaz ----------

func (s *Service) Init() InitData {
	s.mu.Lock()
	cur := s.settings
	s.mu.Unlock()
	return InitData{Settings: cur, Docs: s.st().List(), Version: s.opt.Version, Workspace: s.st().Root(), OS: s.opt.OS}
}

func (s *Service) SaveSettings(cur Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur.Workspace = s.settings.Workspace
	cur.Sync = s.settings.Sync
	s.settings = cur
	if cur.AutoVersionMinutes > 0 {
		s.st().AutoInterval = time.Duration(cur.AutoVersionMinutes) * time.Minute
	}
	if err := os.MkdirAll(s.opt.ConfigDir, 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(cur, "", "  ")
	return os.WriteFile(s.settingsPath(), b, 0o644)
}

func (s *Service) ListDocs() []store.Meta { return s.st().List() }

func (s *Service) GetDoc(id string) (store.Document, error) { return s.st().Get(id) }

func (s *Service) CreateDoc(r CreateRequest) (store.Meta, error) {
	if r.Content != "" && !json.Valid([]byte(r.Content)) {
		return store.Meta{}, errors.New("contenido no válido")
	}
	return s.st().Create(r.ParentID, r.Title, r.Icon, json.RawMessage(r.Content), r.Text, r.Setup)
}

func (s *Service) SaveDoc(id, content, text string, words int) (store.SaveResult, error) {
	return s.st().Save(id, json.RawMessage(content), text, words)
}

func (s *Service) UpdateMeta(id string, p store.MetaPatch) (store.Meta, error) {
	return s.st().UpdateMeta(id, p)
}

func (s *Service) SetSetup(id string, setup store.PageSetup) error { return s.st().SetSetup(id, setup) }
func (s *Service) TrashDoc(id string) error                        { return s.st().Trash(id) }
func (s *Service) RestoreDoc(id string) error                      { return s.st().Restore(id) }
func (s *Service) DeleteDoc(id string) error                       { return s.st().Delete(id) }
func (s *Service) EmptyTrash() error                               { return s.st().EmptyTrash() }
func (s *Service) DuplicateDoc(id string) (store.Meta, error)      { return s.st().Duplicate(id) }
func (s *Service) Search(q string) []store.SearchHit               { return s.st().Search(q, 30) }

func (s *Service) ListVersions(id string) ([]store.Version, error) { return s.st().Versions(id) }
func (s *Service) GetVersion(id, vid string) (store.VersionData, error) {
	return s.st().Version(id, vid)
}
func (s *Service) CreateVersion(id, label string) (store.Version, error) {
	return s.st().CreateVersion(id, label)
}
func (s *Service) RestoreVersion(id, vid string) (store.Document, error) {
	return s.st().RestoreVersion(id, vid)
}
func (s *Service) RenameVersion(id, vid, label string) error {
	return s.st().RenameVersion(id, vid, label)
}
func (s *Service) DeleteVersion(id, vid string) error { return s.st().DeleteVersion(id, vid) }

// SaveImage guarda una imagen (en base64) dentro del documento y devuelve su URL.
func (s *Service) SaveImage(docID, name, b64 string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return "", err
	}
	return s.st().SaveAsset(docID, name, data)
}

// ---------- Archivos por ruta (cada plataforma pone su propio diálogo) ----------

// ExportDocxTo escribe el documento como .docx en la ruta indicada.
func (s *Service) ExportDocxTo(id string, opt ExportOptions, path string) error {
	doc, err := s.st().Get(id)
	if err != nil {
		return err
	}
	s.mu.Lock()
	author := s.settings.AuthorName
	s.mu.Unlock()
	var buf bytes.Buffer
	err = docx.Write(&buf, doc.Content, docx.Options{
		Title: doc.Meta.Title, Author: author, Setup: doc.Setup,
		StudentVersion: opt.StudentVersion, IncludeTitle: opt.IncludeTitle,
		ResolveImage: func(src string) ([]byte, error) {
			// Imágenes incrustadas en el propio contenido (data:image/png;base64,…)
			if rest, ok := strings.CutPrefix(src, "data:image/"); ok {
				if i := strings.Index(rest, ";base64,"); i >= 0 {
					return base64.StdEncoding.DecodeString(rest[i+len(";base64,"):])
				}
				return nil, errors.New("imagen incrustada sin base64")
			}
			p, err := s.st().AssetPath(src)
			if err != nil {
				return nil, err
			}
			return os.ReadFile(p)
		},
	})
	if err != nil {
		return err
	}
	return os.WriteFile(path, buf.Bytes(), 0o644)
}

// WriteTextFile escribe texto (HTML, Markdown…) en la ruta indicada.
func (s *Service) WriteTextFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0o644)
}

// ImportFromPath lee un archivo para importarlo (.docx, .md, .html o .txt).
func (s *Service) ImportFromPath(path string) (*ImportedFile, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	ext := strings.ToLower(filepath.Ext(path))
	return &ImportedFile{
		Name: strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)),
		Ext:  ext, Data: base64.StdEncoding.EncodeToString(b),
	}, nil
}

// SafeFileName quita de un título los caracteres que no valen en un nombre de archivo.
func SafeFileName(name string) string {
	name = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`<>:"/\|?*`, r) || r < 32 {
			return '-'
		}
		return r
	}, strings.TrimSpace(name))
	if name == "" {
		return "Documento"
	}
	return name
}
