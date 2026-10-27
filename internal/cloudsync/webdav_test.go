package cloudsync

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/net/webdav"
)

// davServer es un servidor WebDAV real (x/net/webdav) con autenticación básica y
// las precondiciones If-Match / If-None-Match que usan Nextcloud y compañía.
func davServer(t *testing.T) (*httptest.Server, webdav.FileSystem) {
	t.Helper()
	fs := webdav.NewMemFS()
	h := &webdav.Handler{FileSystem: fs, LockSystem: webdav.NewMemLS()}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if u, p, ok := r.BasicAuth(); !ok || u != "ana" || p != "secreta" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.Method == "PUT" || r.Method == "DELETE" {
			fi, err := fs.Stat(r.Context(), r.URL.Path)
			etag := ""
			if err == nil {
				etag = fmt.Sprintf(`"%x%x"`, fi.ModTime().UnixNano(), fi.Size())
			}
			if im := r.Header.Get("If-Match"); im != "" && im != etag {
				w.WriteHeader(http.StatusPreconditionFailed)
				return
			}
			if r.Header.Get("If-None-Match") == "*" && err == nil {
				w.WriteHeader(http.StatusPreconditionFailed)
				return
			}
		}
		h.ServeHTTP(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv, fs
}

func TestWebDAVProvider(t *testing.T) {
	srv, _ := davServer(t)
	ctx := context.Background()
	w := &WebDAV{BaseURL: srv.URL + "/Folio", User: "ana", Password: "secreta", Backoff: 1}

	// La carpeta no existe: List la crea y devuelve vacío
	files, err := w.List(ctx)
	if err != nil || len(files) != 0 {
		t.Fatalf("List inicial: %v %v", files, err)
	}
	// Crear con carpetas anidadas y nombres con espacios y tildes
	rev1, err := w.Put(ctx, "docs/abc/files/imagen año 1.png", []byte("PNG"), CreateOnly)
	if err != nil || rev1 == "" {
		t.Fatalf("Put: %q %v", rev1, err)
	}
	if _, err := w.Put(ctx, "docs/abc/files/imagen año 1.png", []byte("otra"), CreateOnly); err != ErrConflict {
		t.Fatalf("crear un archivo que ya existe debe dar ErrConflict, dio %v", err)
	}
	data, rev, err := w.Get(ctx, "docs/abc/files/imagen año 1.png")
	if err != nil || string(data) != "PNG" || rev != rev1 {
		t.Fatalf("Get: %q %q %v", data, rev, err)
	}
	// Actualizar con la revisión correcta y con una vieja
	time.Sleep(2 * time.Millisecond) // la revisión del servidor de pruebas depende de la fecha del archivo
	rev2, err := w.Put(ctx, "docs/abc/files/imagen año 1.png", []byte("PNG2"), rev1)
	if err != nil || rev2 == rev1 {
		t.Fatalf("Put con revisión: %q %v", rev2, err)
	}
	if _, err := w.Put(ctx, "docs/abc/files/imagen año 1.png", []byte("PNG3"), rev1); err != ErrConflict {
		t.Fatalf("con una revisión vieja debe dar ErrConflict, dio %v", err)
	}
	if _, err := w.Put(ctx, "agenda/topics.json", []byte("[]"), AnyRev); err != nil {
		t.Fatal(err)
	}
	files, err = w.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, f := range files {
		got[f.Path] = f.Rev
	}
	if len(got) != 2 || got["docs/abc/files/imagen año 1.png"] != rev2 || got["agenda/topics.json"] == "" {
		t.Fatalf("List recursivo: %v", got)
	}
	// Borrar con revisión vieja falla; con la buena funciona; borrar lo que no existe no es error
	if err := w.Delete(ctx, "docs/abc/files/imagen año 1.png", rev1); err != ErrConflict {
		t.Fatalf("Delete con revisión vieja: %v", err)
	}
	if err := w.Delete(ctx, "docs/abc/files/imagen año 1.png", rev2); err != nil {
		t.Fatal(err)
	}
	if err := w.Delete(ctx, "docs/abc/files/imagen año 1.png", AnyRev); err != nil {
		t.Fatalf("borrar lo que no existe: %v", err)
	}
}

func TestWebDAVBadCredentials(t *testing.T) {
	srv, _ := davServer(t)
	w := &WebDAV{BaseURL: srv.URL + "/Folio", User: "ana", Password: "mala", Backoff: 1}
	if _, err := w.List(context.Background()); err == nil || !strings.Contains(err.Error(), "contraseña") {
		t.Fatalf("debía avisar de la contraseña: %v", err)
	}
}

func TestValidateURL(t *testing.T) {
	for raw, ok := range map[string]bool{
		"https://nube.ejemplo.es/dav": true, "http://localhost:8080/dav": true, "http://127.0.0.1/dav": true,
		"http://nube.ejemplo.es/dav": false, "nube.ejemplo.es": false, "": false,
	} {
		if err := ValidateURL(raw); (err == nil) != ok {
			t.Errorf("%q: %v", raw, err)
		}
	}
}

// Sincronizar dos dispositivos a través de un servidor WebDAV de verdad.
func TestEngineOverWebDAV(t *testing.T) {
	srv, _ := davServer(t)
	mk := func() *WebDAV {
		return &WebDAV{BaseURL: srv.URL + "/Folio", User: "ana", Password: "secreta", Backoff: 1}
	}
	a, b := newDevice(t, "A", mk()), newDevice(t, "B", mk())
	id := a.newDoc("Apuntes con año", "hola ñandú")
	a.sync()
	b.sync()
	if a.docText(id) != b.docText(id) {
		t.Fatal("el contenido no coincide tras sincronizar por WebDAV")
	}
	a.editDoc(id, "segunda", time.Now())
	a.sync()
	b.sync()
	if !strings.Contains(b.docText(id), "segunda") {
		t.Fatal("B no recibió el cambio")
	}
	if _, err := os.Stat(filepath.Join(b.root, ".folio-sync", "state.json")); err != nil {
		t.Fatal("falta el estado de la sincronización")
	}
}
