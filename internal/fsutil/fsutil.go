// Package fsutil reúne las operaciones de disco compartidas por los almacenes
// de documentos y de la agenda: escrituras atómicas y lectura de JSON.
package fsutil

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// ReadJSON lee y decodifica un archivo JSON.
func ReadJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// WriteJSON codifica v con sangría y lo escribe de forma atómica.
func WriteJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return WriteFileAtomic(path, b)
}

// WriteFileAtomic escribe en un temporal y lo renombra encima del destino, para
// que un cierre a mitad de escritura nunca deje un archivo a medias.
func WriteFileAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	if err := os.Rename(name, path); err != nil {
		os.Remove(name)
		return err
	}
	return nil
}
