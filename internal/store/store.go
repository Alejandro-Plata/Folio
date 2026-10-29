// Package store guarda los documentos en disco: un directorio por documento con
// sus metadatos, su contenido (JSON de ProseMirror), sus imágenes y su historial
// de versiones. Todas las escrituras son atómicas para no corromper nada si la
// aplicación se cierra a mitad de un guardado.
package store

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"folio/internal/fsutil"
)

var (
	ErrNotFound  = errors.New("documento no encontrado")
	ErrInvalidID = errors.New("identificador no válido")
	idPattern    = regexp.MustCompile(`^[a-f0-9]{8,32}$`)
)

type Meta struct {
	ID       string    `json:"id"`
	Title    string    `json:"title"`
	Icon     string    `json:"icon"`
	ParentID string    `json:"parentId"`
	Order    float64   `json:"order"`
	Favorite bool      `json:"favorite"`
	Trashed  bool      `json:"trashed"`
	Created  time.Time `json:"created"`
	Updated  time.Time `json:"updated"`
	Words    int       `json:"words"`
}

// PageSetup es la configuración de página (Formato > Configurar página en Word).
// Las medidas de márgenes van en milímetros y el tamaño de fuente en puntos.
type PageSetup struct {
	Paper        string  `json:"paper"`
	Orientation  string  `json:"orientation"`
	MarginTop    float64 `json:"marginTop"`
	MarginBottom float64 `json:"marginBottom"`
	MarginLeft   float64 `json:"marginLeft"`
	MarginRight  float64 `json:"marginRight"`
	Header       string  `json:"header"`
	Footer       string  `json:"footer"`
	PageNumbers  bool    `json:"pageNumbers"`
	FontFamily   string  `json:"fontFamily"`
	FontSize     float64 `json:"fontSize"`
	LineHeight   float64 `json:"lineHeight"`
	TitleSize    float64 `json:"titleSize,omitempty"` // pt; 0 = proporcional al texto
}

func DefaultSetup() PageSetup {
	return PageSetup{
		Paper: "A4", Orientation: "portrait",
		MarginTop: 25, MarginBottom: 25, MarginLeft: 25, MarginRight: 25,
		PageNumbers: true, FontFamily: "Inter", FontSize: 11, LineHeight: 1.5,
	}
}

type Document struct {
	Meta    Meta            `json:"meta"`
	Setup   PageSetup       `json:"setup"`
	Content json.RawMessage `json:"content"`
}

type MetaPatch struct {
	Title    *string  `json:"title,omitempty"`
	Icon     *string  `json:"icon,omitempty"`
	ParentID *string  `json:"parentId,omitempty"`
	Order    *float64 `json:"order,omitempty"`
	Favorite *bool    `json:"favorite,omitempty"`
}

type SaveResult struct {
	Updated        time.Time `json:"updated"`
	VersionCreated bool      `json:"versionCreated"`
}

type SearchHit struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Icon    string `json:"icon"`
	Snippet string `json:"snippet"`
	Score   int    `json:"score"`
}

type metaFile struct {
	Meta  Meta      `json:"meta"`
	Setup PageSetup `json:"setup"`
}

type entry struct {
	meta  Meta
	setup PageSetup
	dirty bool // hay cambios sin instantánea en el historial
}

type Store struct {
	root string
	mu   sync.RWMutex
	docs map[string]*entry
	text map[string]string // texto plano para la búsqueda (carga perezosa)

	// AutoInterval es el tiempo mínimo entre dos versiones automáticas.
	AutoInterval time.Duration
	now          func() time.Time
}

const emptyDoc = `{"type":"doc","content":[{"type":"paragraph"}]}`

func Open(root string) (*Store, error) {
	s := &Store{
		root:         root,
		docs:         map[string]*entry{},
		text:         map[string]string{},
		AutoInterval: 10 * time.Minute,
		now:          time.Now,
	}
	if err := os.MkdirAll(s.docsDir(), 0o755); err != nil {
		return nil, err
	}
	dirs, err := os.ReadDir(s.docsDir())
	if err != nil {
		return nil, err
	}
	for _, d := range dirs {
		if !d.IsDir() || !idPattern.MatchString(d.Name()) {
			continue
		}
		var mf metaFile
		if err := readJSON(filepath.Join(s.docsDir(), d.Name(), "meta.json"), &mf); err != nil {
			continue // documento a medio crear o dañado: se ignora
		}
		mf.Meta.ID = d.Name()
		s.docs[d.Name()] = &entry{meta: mf.Meta, setup: mf.Setup}
	}
	return s, nil
}

func (s *Store) Root() string { return s.root }

func (s *Store) docsDir() string           { return filepath.Join(s.root, "docs") }
func (s *Store) docDir(id string) string   { return filepath.Join(s.docsDir(), id) }
func (s *Store) filesDir(id string) string { return filepath.Join(s.docDir(id), "files") }

func (s *Store) List() []Meta {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Meta, 0, len(s.docs))
	for _, e := range s.docs {
		out = append(out, e.meta)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Order != out[j].Order {
			return out[i].Order < out[j].Order
		}
		return out[i].Created.Before(out[j].Created)
	})
	return out
}

func (s *Store) Get(id string) (Document, error) {
	if !idPattern.MatchString(id) {
		return Document{}, ErrInvalidID
	}
	s.mu.RLock()
	e, ok := s.docs[id]
	s.mu.RUnlock()
	if !ok {
		return Document{}, ErrNotFound
	}
	content, err := os.ReadFile(filepath.Join(s.docDir(id), "content.json"))
	if err != nil {
		content = []byte(emptyDoc)
	}
	return Document{Meta: e.meta, Setup: e.setup, Content: content}, nil
}

func (s *Store) Create(parentID, title, icon string, content json.RawMessage, text string, setup *PageSetup) (Meta, error) {
	id, err := newID()
	if err != nil {
		return Meta{}, err
	}
	if len(content) == 0 {
		content = json.RawMessage(emptyDoc)
	}
	st := DefaultSetup()
	if setup != nil {
		st = *setup
	}
	now := s.now()

	s.mu.Lock()
	defer s.mu.Unlock()
	if parentID != "" {
		if _, ok := s.docs[parentID]; !ok {
			parentID = ""
		}
	}
	m := Meta{
		ID: id, Title: title, Icon: icon, ParentID: parentID,
		Order: s.nextOrderLocked(parentID), Created: now, Updated: now,
		Words: countWords(text),
	}
	if err := os.MkdirAll(s.docDir(id), 0o755); err != nil {
		return Meta{}, err
	}
	if err := writeFileAtomic(filepath.Join(s.docDir(id), "content.json"), content); err != nil {
		return Meta{}, err
	}
	_ = writeFileAtomic(filepath.Join(s.docDir(id), "content.txt"), []byte(text))
	e := &entry{meta: m, setup: st}
	if err := s.writeMetaLocked(e); err != nil {
		return Meta{}, err
	}
	s.docs[id] = e
	s.text[id] = text
	if _, err := s.snapshotLocked(id, KindCreated, "Documento creado"); err != nil {
		return Meta{}, err
	}
	return m, nil
}

// Save guarda el contenido actual. Si ha pasado AutoInterval desde la última
// versión y el contenido ha cambiado, crea además una versión automática.
func (s *Store) Save(id string, content json.RawMessage, text string, words int) (SaveResult, error) {
	if !idPattern.MatchString(id) {
		return SaveResult{}, ErrInvalidID
	}
	if !json.Valid(content) {
		return SaveResult{}, fmt.Errorf("contenido JSON no válido")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.docs[id]
	if !ok {
		return SaveResult{}, ErrNotFound
	}
	if err := writeFileAtomic(filepath.Join(s.docDir(id), "content.json"), content); err != nil {
		return SaveResult{}, err
	}
	_ = writeFileAtomic(filepath.Join(s.docDir(id), "content.txt"), []byte(text))
	s.text[id] = text
	e.meta.Updated = s.now()
	e.meta.Words = words
	if err := s.writeMetaLocked(e); err != nil {
		return SaveResult{}, err
	}

	res := SaveResult{Updated: e.meta.Updated}
	idx, _ := s.readIndexLocked(id)
	hash := hashBytes(content)
	var last *Version
	if len(idx) > 0 {
		last = &idx[len(idx)-1]
	}
	switch {
	case last != nil && last.Hash == hash:
		e.dirty = false
	case last == nil || s.now().Sub(last.Created) >= s.AutoInterval:
		if _, err := s.snapshotLocked(id, KindAuto, ""); err != nil {
			return res, err
		}
		res.VersionCreated = true
		e.dirty = false
	default:
		e.dirty = true
	}
	return res, nil
}

func (s *Store) UpdateMeta(id string, p MetaPatch) (Meta, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.docs[id]
	if !ok {
		return Meta{}, ErrNotFound
	}
	if p.Title != nil {
		e.meta.Title = strings.TrimSpace(*p.Title)
	}
	if p.Icon != nil {
		e.meta.Icon = *p.Icon
	}
	if p.Favorite != nil {
		e.meta.Favorite = *p.Favorite
	}
	if p.ParentID != nil && *p.ParentID != e.meta.ParentID {
		np := *p.ParentID
		if np != "" {
			if _, ok := s.docs[np]; !ok {
				return Meta{}, ErrNotFound
			}
			if np == id || s.isDescendantLocked(np, id) {
				return Meta{}, fmt.Errorf("no se puede mover una página dentro de sí misma")
			}
		}
		e.meta.ParentID = np
		if p.Order == nil {
			e.meta.Order = s.nextOrderLocked(np)
		}
	}
	if p.Order != nil {
		e.meta.Order = *p.Order
	}
	return e.meta, s.writeMetaLocked(e)
}

func (s *Store) SetSetup(id string, setup PageSetup) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.docs[id]
	if !ok {
		return ErrNotFound
	}
	e.setup = setup
	return s.writeMetaLocked(e)
}

// Trash mueve a la papelera el documento y todas sus subpáginas.
func (s *Store) Trash(id string) error { return s.setTrashed(id, true) }

// Restore saca de la papelera el documento y sus subpáginas. Si su página padre
// sigue en la papelera, se restaura en la raíz.
func (s *Store) Restore(id string) error { return s.setTrashed(id, false) }

func (s *Store) setTrashed(id string, trashed bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.docs[id]
	if !ok {
		return ErrNotFound
	}
	if !trashed && e.meta.ParentID != "" {
		if p, ok := s.docs[e.meta.ParentID]; !ok || p.meta.Trashed {
			e.meta.ParentID = ""
		}
	}
	for _, d := range append([]string{id}, s.descendantsLocked(id)...) {
		de := s.docs[d]
		de.meta.Trashed = trashed
		if err := s.writeMetaLocked(de); err != nil {
			return err
		}
	}
	return nil
}

// Delete elimina definitivamente el documento, sus subpáginas y su historial.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.docs[id]; !ok {
		return ErrNotFound
	}
	for _, d := range append(s.descendantsLocked(id), id) {
		if err := os.RemoveAll(s.docDir(d)); err != nil {
			return err
		}
		delete(s.docs, d)
		delete(s.text, d)
	}
	return nil
}

func (s *Store) EmptyTrash() error {
	s.mu.RLock()
	var ids []string
	for id, e := range s.docs {
		if e.meta.Trashed {
			ids = append(ids, id)
		}
	}
	s.mu.RUnlock()
	for _, id := range ids {
		if err := s.Delete(id); err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
	}
	return nil
}

func (s *Store) Duplicate(id string) (Meta, error) {
	doc, err := s.Get(id)
	if err != nil {
		return Meta{}, err
	}
	text, _ := s.plainText(id)
	m, err := s.Create(doc.Meta.ParentID, doc.Meta.Title+" (copia)", doc.Meta.Icon, doc.Content, text, &doc.Setup)
	if err != nil {
		return Meta{}, err
	}
	// Copia las imágenes y reescribe sus rutas para que apunten al nuevo documento.
	if files, err := os.ReadDir(s.filesDir(id)); err == nil && len(files) > 0 {
		_ = os.MkdirAll(s.filesDir(m.ID), 0o755)
		for _, f := range files {
			if b, err := os.ReadFile(filepath.Join(s.filesDir(id), f.Name())); err == nil {
				_ = os.WriteFile(filepath.Join(s.filesDir(m.ID), f.Name()), b, 0o644)
			}
		}
		content := bytes.ReplaceAll(doc.Content, []byte("/files/"+id+"/"), []byte("/files/"+m.ID+"/"))
		if _, err := s.Save(m.ID, content, text, doc.Meta.Words); err != nil {
			return Meta{}, err
		}
	}
	s.mu.Lock()
	s.docs[m.ID].meta.Words = doc.Meta.Words
	_ = s.writeMetaLocked(s.docs[m.ID])
	m = s.docs[m.ID].meta
	s.mu.Unlock()
	return m, nil
}

var allowedImageExt = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".svg": true, ".bmp": true,
}

// SaveAsset guarda una imagen dentro del documento y devuelve la URL con la que
// el editor la referencia. Las imágenes idénticas se guardan una sola vez.
func (s *Store) SaveAsset(id, name string, data []byte) (string, error) {
	if !idPattern.MatchString(id) {
		return "", ErrInvalidID
	}
	s.mu.RLock()
	_, ok := s.docs[id]
	s.mu.RUnlock()
	if !ok {
		return "", ErrNotFound
	}
	ext := strings.ToLower(filepath.Ext(name))
	if ext == ".jpeg" {
		ext = ".jpg"
	}
	if !allowedImageExt[ext] {
		return "", fmt.Errorf("formato de imagen no admitido: %s", ext)
	}
	file := hashBytes(data)[:16] + ext
	if err := os.MkdirAll(s.filesDir(id), 0o755); err != nil {
		return "", err
	}
	p := filepath.Join(s.filesDir(id), file)
	if _, err := os.Stat(p); err != nil {
		if err := writeFileAtomic(p, data); err != nil {
			return "", err
		}
	}
	return "/files/" + id + "/" + file, nil
}

var assetName = regexp.MustCompile(`^[a-f0-9]{16}\.[a-z]{3,4}$`)

// AssetPath traduce una URL /files/<id>/<archivo> a una ruta del disco,
// rechazando cualquier intento de salir de la carpeta del documento.
func (s *Store) AssetPath(url string) (string, error) {
	parts := strings.Split(strings.TrimPrefix(url, "/files/"), "/")
	if len(parts) != 2 || !idPattern.MatchString(parts[0]) || !assetName.MatchString(parts[1]) {
		return "", ErrNotFound
	}
	return filepath.Join(s.filesDir(parts[0]), parts[1]), nil
}

func (s *Store) plainText(id string) (string, error) {
	s.mu.RLock()
	t, ok := s.text[id]
	s.mu.RUnlock()
	if ok {
		return t, nil
	}
	b, err := os.ReadFile(filepath.Join(s.docDir(id), "content.txt"))
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	s.text[id] = string(b)
	s.mu.Unlock()
	return string(b), nil
}

// Search busca en títulos y contenido sin distinguir mayúsculas ni tildes.
func (s *Store) Search(q string, limit int) []SearchHit {
	// Nunca nil: la interfaz espera un array JSON, no null.
	hits := []SearchHit{}
	terms := strings.Fields(fold(q))
	if len(terms) == 0 {
		return hits
	}
	for _, m := range s.List() {
		if m.Trashed {
			continue
		}
		text, _ := s.plainText(m.ID)
		ft, fx := fold(m.Title), fold(text)
		score, pos := 0, -1
		for _, t := range terms {
			inTitle := strings.Contains(ft, t)
			i := strings.Index(fx, t)
			if !inTitle && i < 0 {
				score = 0
				break
			}
			if inTitle {
				score += 10
			}
			if i >= 0 {
				score += 1 + strings.Count(fx, t)/4
				if pos < 0 {
					pos = i
				}
			}
		}
		if score == 0 {
			continue
		}
		hits = append(hits, SearchHit{ID: m.ID, Title: m.Title, Icon: m.Icon, Snippet: snippet(text, fx, pos), Score: score})
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].Score > hits[j].Score })
	if limit > 0 && len(hits) > limit {
		hits = hits[:limit]
	}
	return hits
}

// SnapshotDirty crea una versión de cada documento con cambios aún no
// versionados. Se llama al cerrar la aplicación.
func (s *Store) SnapshotDirty() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, e := range s.docs {
		if e.dirty {
			_, _ = s.snapshotLocked(id, KindAuto, "Al cerrar")
			e.dirty = false
		}
	}
}

func (s *Store) nextOrderLocked(parentID string) float64 {
	max := 0.0
	for _, e := range s.docs {
		if e.meta.ParentID == parentID && e.meta.Order > max {
			max = e.meta.Order
		}
	}
	return max + 1
}

func (s *Store) descendantsLocked(id string) []string {
	var out []string
	for cid, e := range s.docs {
		if e.meta.ParentID == id {
			out = append(out, cid)
			out = append(out, s.descendantsLocked(cid)...)
		}
	}
	return out
}

func (s *Store) isDescendantLocked(candidate, ancestor string) bool {
	for cur := candidate; cur != ""; {
		e, ok := s.docs[cur]
		if !ok {
			return false
		}
		if e.meta.ParentID == ancestor {
			return true
		}
		cur = e.meta.ParentID
	}
	return false
}

func (s *Store) writeMetaLocked(e *entry) error {
	b, err := json.MarshalIndent(metaFile{Meta: e.meta, Setup: e.setup}, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(filepath.Join(s.docDir(e.meta.ID), "meta.json"), b)
}

func newID() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func hashBytes(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func countWords(s string) int { return len(strings.Fields(s)) }

var foldReplacer = strings.NewReplacer(
	"á", "a", "à", "a", "ä", "a", "â", "a",
	"é", "e", "è", "e", "ë", "e", "ê", "e",
	"í", "i", "ì", "i", "ï", "i", "î", "i",
	"ó", "o", "ò", "o", "ö", "o", "ô", "o",
	"ú", "u", "ù", "u", "ü", "u", "û", "u",
	"ñ", "n", "ç", "c",
)

// fold normaliza el texto para comparar sin mayúsculas ni tildes. Cada
// sustitución conserva la longitud en runas, así los índices de runas coinciden.
func fold(s string) string { return foldReplacer.Replace(strings.ToLower(s)) }

func snippet(orig, folded string, bytePos int) string {
	const radius = 70
	or, fr := []rune(orig), []rune(folded)
	if bytePos < 0 || len(or) != len(fr) {
		if len(or) > 2*radius {
			return string(or[:2*radius]) + "…"
		}
		return string(or)
	}
	pos := len([]rune(folded[:bytePos]))
	start, end := max(0, pos-radius), min(len(or), pos+radius)
	out := strings.Join(strings.Fields(string(or[start:end])), " ")
	if start > 0 {
		out = "…" + out
	}
	if end < len(or) {
		out += "…"
	}
	return out
}

func readJSON(path string, v any) error { return fsutil.ReadJSON(path, v) }

// writeFileAtomic escribe en un temporal y lo renombra encima del destino.
func writeFileAtomic(path string, data []byte) error { return fsutil.WriteFileAtomic(path, data) }
