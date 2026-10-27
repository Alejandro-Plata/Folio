package cloudsync

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"folio/internal/fsutil"
)

const stateDirName = ".folio-sync"

// fileState es lo que se sabía de un archivo en la última sincronización correcta.
type fileState struct {
	Hash    string `json:"hash"` // SHA-256 del contenido local
	Rev     string `json:"rev"`  // revisión remota
	Size    int64  `json:"size"`
	ModNano int64  `json:"mod"` // para no volver a calcular el hash si no ha cambiado
}

type state struct {
	Files map[string]*fileState `json:"files"`
}

func stateDir(root string) string  { return filepath.Join(root, stateDirName) }
func statePath(root string) string { return filepath.Join(stateDir(root), "state.json") }
func basePath(root, rel string) string {
	return filepath.Join(stateDir(root), "base", filepath.FromSlash(rel))
}

func loadState(root string) *state {
	st := &state{Files: map[string]*fileState{}}
	if err := fsutil.ReadJSON(statePath(root), st); err != nil || st.Files == nil {
		st.Files = map[string]*fileState{}
	}
	return st
}

func (s *state) save(root string) error {
	if err := os.MkdirAll(stateDir(root), 0o755); err != nil {
		return err
	}
	return fsutil.WriteJSON(statePath(root), s)
}

// ResetState olvida lo sincronizado (al desvincular o cambiar de nube).
func ResetState(root string) error { return os.RemoveAll(stateDir(root)) }

type localFile struct {
	Hash string
	Size int64
	Mod  int64
}

func hashBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func hashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// ignored indica los archivos que no se sincronizan nunca: el estado de la
// sincronización, los temporales de escritura atómica y los ocultos.
func ignored(rel string) bool {
	for _, part := range strings.Split(rel, "/") {
		if strings.HasPrefix(part, ".") {
			return true
		}
	}
	return false
}

// scanLocal recorre el espacio de trabajo. Si un archivo no ha cambiado de
// tamaño ni de fecha desde la última vez, reutiliza su hash.
func scanLocal(root string, st *state) (map[string]*localFile, error) {
	out := map[string]*localFile{}
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return nil
			}
			return err
		}
		rel, _ := filepath.Rel(root, p)
		rel = filepath.ToSlash(rel)
		if rel == "." {
			return nil
		}
		if ignored(rel) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		lf := &localFile{Size: info.Size(), Mod: info.ModTime().UnixNano()}
		if prev, ok := st.Files[rel]; ok && prev.Size == lf.Size && prev.ModNano == lf.Mod && prev.Hash != "" {
			lf.Hash = prev.Hash
		} else if lf.Hash, err = hashFile(p); err != nil {
			return nil
		}
		out[rel] = lf
		return nil
	})
	return out, err
}
