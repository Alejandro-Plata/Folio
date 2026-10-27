// Package cloudsync sincroniza el espacio de trabajo de Folio (documentos y
// agenda) con una nube del usuario: WebDAV (Nextcloud y similares) o Google
// Drive. Trabaja por archivos, con fusión a tres bandas según el tipo de
// archivo, y nunca borra datos que se hayan cambiado en otro dispositivo.
package cloudsync

import (
	"context"
	"errors"
	"time"
)

// RemoteFile es un archivo de la carpeta remota.
type RemoteFile struct {
	Path     string    // relativo a la carpeta remota, con «/»
	Rev      string    // ETag (WebDAV) o md5Checksum (Drive): cambia si cambia el contenido
	Size     int64     // bytes
	Modified time.Time // última modificación según el servidor (puede ser cero)
}

// Valores especiales de ifRev en Put y Delete.
const (
	// CreateOnly: el archivo no debe existir todavía.
	CreateOnly = ""
	// AnyRev: sin condición, se sobrescribe lo que haya.
	AnyRev = "*"
)

// ErrConflict indica que el archivo remoto ha cambiado desde que se leyó.
var ErrConflict = errors.New("el archivo remoto ha cambiado")

// Provider es lo mínimo que necesita el motor de cualquier nube.
type Provider interface {
	Name() string
	// List devuelve todos los archivos de la carpeta remota, recursivamente.
	List(ctx context.Context) ([]RemoteFile, error)
	// Get devuelve el contenido y la revisión de un archivo.
	Get(ctx context.Context, path string) (data []byte, rev string, err error)
	// Put escribe un archivo (creando las carpetas que falten) y devuelve su
	// nueva revisión. ifRev es la revisión que se espera encontrar, CreateOnly o AnyRev.
	Put(ctx context.Context, path string, data []byte, ifRev string) (string, error)
	// Delete borra un archivo. Si ya no existe no es un error.
	Delete(ctx context.Context, path string, ifRev string) error
}
