package store

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// Tipos de versión del historial.
const (
	KindCreated = "created" // al crear el documento
	KindAuto    = "auto"    // automática mientras se escribe
	KindManual  = "manual"  // guardada por el usuario con nombre
	KindBackup  = "backup"  // copia de seguridad antes de restaurar otra versión
)

// Version es una entrada del historial. El contenido se guarda comprimido y
// direccionado por su hash: dos versiones idénticas comparten el mismo archivo.
type Version struct {
	ID      string    `json:"id"`
	Created time.Time `json:"created"`
	Label   string    `json:"label"`
	Kind    string    `json:"kind"`
	Hash    string    `json:"hash"`
	Title   string    `json:"title"`
	Words   int       `json:"words"`
	Size    int       `json:"size"`
	Setup   PageSetup `json:"setup"`
}

type VersionData struct {
	Version
	Content json.RawMessage `json:"content"`
	Text    string          `json:"text"`
}

type blob struct {
	Content json.RawMessage `json:"content"`
	Text    string          `json:"text"`
}

var ErrVersionNotFound = errors.New("versión no encontrada")

func (s *Store) versionsDir(id string) string { return filepath.Join(s.docDir(id), "versions") }

func (s *Store) Versions(id string) ([]Version, error) {
	if !idPattern.MatchString(id) {
		return nil, ErrInvalidID
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	idx, err := s.readIndexLocked(id)
	if err != nil {
		return nil, err
	}
	// Más recientes primero.
	out := make([]Version, len(idx))
	for i, v := range idx {
		out[len(idx)-1-i] = v
	}
	return out, nil
}

func (s *Store) Version(id, vid string) (VersionData, error) {
	if !idPattern.MatchString(id) {
		return VersionData{}, ErrInvalidID
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.versionLocked(id, vid)
}

// CreateVersion guarda una versión con nombre (Archivo > Guardar versión).
func (s *Store) CreateVersion(id, label string) (Version, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.docs[id]
	if !ok {
		return Version{}, ErrNotFound
	}
	if label == "" {
		label = "Versión guardada"
	}
	v, err := s.snapshotLocked(id, KindManual, label)
	if err == nil {
		e.dirty = false
	}
	return v, err
}

func (s *Store) RenameVersion(id, vid, label string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	idx, err := s.readIndexLocked(id)
	if err != nil {
		return err
	}
	for i := range idx {
		if idx[i].ID == vid {
			idx[i].Label = label
			if idx[i].Kind == KindAuto && label != "" {
				idx[i].Kind = KindManual // al ponerle nombre deja de podarse
			}
			return s.writeIndexLocked(id, idx)
		}
	}
	return ErrVersionNotFound
}

func (s *Store) DeleteVersion(id, vid string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	idx, err := s.readIndexLocked(id)
	if err != nil {
		return err
	}
	out := idx[:0]
	found := false
	for _, v := range idx {
		if v.ID == vid {
			found = true
			continue
		}
		out = append(out, v)
	}
	if !found {
		return ErrVersionNotFound
	}
	if err := s.writeIndexLocked(id, out); err != nil {
		return err
	}
	s.gcBlobsLocked(id, out)
	return nil
}

// RestoreVersion sustituye el contenido actual por el de una versión anterior.
// Antes guarda una copia del estado actual para que la restauración se pueda deshacer.
func (s *Store) RestoreVersion(id, vid string) (Document, error) {
	s.mu.Lock()
	e, ok := s.docs[id]
	if !ok {
		s.mu.Unlock()
		return Document{}, ErrNotFound
	}
	vd, err := s.versionLocked(id, vid)
	if err != nil {
		s.mu.Unlock()
		return Document{}, err
	}
	when := vd.Created.Local().Format("02/01/2006 15:04")
	if _, err := s.snapshotLocked(id, KindBackup, "Antes de restaurar la versión del "+when); err != nil {
		s.mu.Unlock()
		return Document{}, err
	}
	if err := writeFileAtomic(filepath.Join(s.docDir(id), "content.json"), vd.Content); err != nil {
		s.mu.Unlock()
		return Document{}, err
	}
	_ = writeFileAtomic(filepath.Join(s.docDir(id), "content.txt"), []byte(vd.Text))
	s.text[id] = vd.Text
	e.meta.Updated = s.now()
	e.meta.Words = vd.Words
	if vd.Title != "" {
		e.meta.Title = vd.Title
	}
	e.setup = vd.Setup
	if err := s.writeMetaLocked(e); err != nil {
		s.mu.Unlock()
		return Document{}, err
	}
	_, err = s.snapshotLocked(id, KindManual, "Restaurada la versión del "+when)
	e.dirty = false
	s.mu.Unlock()
	if err != nil {
		return Document{}, err
	}
	return s.Get(id)
}

func (s *Store) snapshotLocked(id, kind, label string) (Version, error) {
	content, err := os.ReadFile(filepath.Join(s.docDir(id), "content.json"))
	if err != nil {
		return Version{}, err
	}
	text, _ := os.ReadFile(filepath.Join(s.docDir(id), "content.txt"))
	return s.addVersionLocked(id, kind, label, content, string(text))
}

// ImportVersion guarda en el historial un contenido que viene de fuera: la
// versión que pierde un conflicto de sincronización. Es una versión con nombre,
// así que nunca se poda.
func (s *Store) ImportVersion(id string, content json.RawMessage, label string) (Version, error) {
	if !idPattern.MatchString(id) {
		return Version{}, ErrInvalidID
	}
	if !json.Valid(content) {
		return Version{}, errors.New("contenido no válido")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.docs[id]; !ok {
		return Version{}, ErrNotFound
	}
	return s.addVersionLocked(id, KindManual, label, content, plainTextOf(content))
}

func (s *Store) addVersionLocked(id, kind, label string, content []byte, text string) (Version, error) {
	e := s.docs[id]
	hash := hashBytes(content)

	idx, err := s.readIndexLocked(id)
	if err != nil {
		return Version{}, err
	}
	if kind == KindAuto && len(idx) > 0 && idx[len(idx)-1].Hash == hash {
		return idx[len(idx)-1], nil
	}
	if err := os.MkdirAll(s.versionsDir(id), 0o755); err != nil {
		return Version{}, err
	}
	bp := filepath.Join(s.versionsDir(id), hash[:32]+".json.gz")
	if _, err := os.Stat(bp); err != nil {
		raw, _ := json.Marshal(blob{Content: content, Text: text})
		var buf bytes.Buffer
		zw, _ := gzip.NewWriterLevel(&buf, gzip.BestSpeed)
		zw.Write(raw)
		zw.Close()
		if err := writeFileAtomic(bp, buf.Bytes()); err != nil {
			return Version{}, err
		}
	}
	vid, _ := newID()
	v := Version{
		ID: vid, Created: s.now(), Label: label, Kind: kind, Hash: hash,
		Title: e.meta.Title, Words: e.meta.Words, Size: len(content), Setup: e.setup,
	}
	idx = append(idx, v)
	if kind == KindAuto {
		idx = pruneAuto(idx, s.now())
	}
	if err := s.writeIndexLocked(id, idx); err != nil {
		return Version{}, err
	}
	s.gcBlobsLocked(id, idx)
	return v, nil
}

// pruneAuto aclara las versiones automáticas antiguas: se conservan todas las
// de las últimas 24 horas, una por hora durante la última semana y una por día
// a partir de ahí. Las versiones con nombre nunca se borran.
func pruneAuto(idx []Version, now time.Time) []Version {
	const maxAuto = 300
	seen := map[string]bool{}
	keep := make([]bool, len(idx))
	autos := 0
	for i := len(idx) - 1; i >= 0; i-- {
		v := idx[i]
		if v.Kind != KindAuto {
			keep[i] = true
			continue
		}
		age := now.Sub(v.Created)
		var bucket string
		switch {
		case age < 24*time.Hour:
			bucket = v.ID
		case age < 7*24*time.Hour:
			bucket = v.Created.Format("2006010215")
		default:
			bucket = v.Created.Format("20060102")
		}
		if seen[bucket] || autos >= maxAuto {
			continue
		}
		seen[bucket] = true
		keep[i] = true
		autos++
	}
	out := idx[:0]
	for i, v := range idx {
		if keep[i] {
			out = append(out, v)
		}
	}
	return out
}

func (s *Store) gcBlobsLocked(id string, idx []Version) {
	used := map[string]bool{}
	for _, v := range idx {
		used[v.Hash[:32]+".json.gz"] = true
	}
	files, _ := filepath.Glob(filepath.Join(s.versionsDir(id), "*.json.gz"))
	for _, f := range files {
		if !used[filepath.Base(f)] {
			os.Remove(f)
		}
	}
}

func (s *Store) versionLocked(id, vid string) (VersionData, error) {
	idx, err := s.readIndexLocked(id)
	if err != nil {
		return VersionData{}, err
	}
	for _, v := range idx {
		if v.ID != vid {
			continue
		}
		f, err := os.Open(filepath.Join(s.versionsDir(id), v.Hash[:32]+".json.gz"))
		if err != nil {
			return VersionData{}, err
		}
		defer f.Close()
		zr, err := gzip.NewReader(f)
		if err != nil {
			return VersionData{}, err
		}
		raw, err := io.ReadAll(zr)
		if err != nil {
			return VersionData{}, err
		}
		var b blob
		if err := json.Unmarshal(raw, &b); err != nil {
			return VersionData{}, fmt.Errorf("versión dañada: %w", err)
		}
		return VersionData{Version: v, Content: b.Content, Text: b.Text}, nil
	}
	return VersionData{}, ErrVersionNotFound
}

func (s *Store) readIndexLocked(id string) ([]Version, error) {
	var idx []Version
	err := readJSON(filepath.Join(s.versionsDir(id), "index.json"), &idx)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	sort.SliceStable(idx, func(i, j int) bool { return idx[i].Created.Before(idx[j].Created) })
	return idx, err
}

func (s *Store) writeIndexLocked(id string, idx []Version) error {
	if err := os.MkdirAll(s.versionsDir(id), 0o755); err != nil {
		return err
	}
	b, err := json.Marshal(idx)
	if err != nil {
		return err
	}
	return writeFileAtomic(filepath.Join(s.versionsDir(id), "index.json"), b)
}
