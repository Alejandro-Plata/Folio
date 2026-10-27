package cloudsync

import (
	"context"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeDrive imita lo que usa Folio de la API de Google Drive v3.
type fakeDrive struct {
	mu      sync.Mutex
	files   map[string]*fdFile
	token   string
	expired int // respuestas 401 que debe dar antes de aceptar el token
	limited int // respuestas 429 antes de atender
}

type fdFile struct {
	ID, Name, Mime, Parent string
	Data                   []byte
	Props                  map[string]string
	Trashed                bool
	Mod                    time.Time
}

func newFakeDrive() *fakeDrive {
	return &fakeDrive{files: map[string]*fdFile{"root": {ID: "root", Mime: driveFolderMime}}, token: "tok-1"}
}

func (f *fakeDrive) json(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func (f *fakeDrive) view(x *fdFile) map[string]any {
	m := map[string]any{"id": x.ID, "name": x.Name, "mimeType": x.Mime, "modifiedTime": x.Mod.Format(time.RFC3339Nano), "trashed": x.Trashed}
	if x.Mime != driveFolderMime {
		m["md5Checksum"] = md5hex(x.Data)
		m["size"] = strconv.Itoa(len(x.Data)) // la API real devuelve el tamaño como cadena
	}
	return m
}

var (
	reParent = regexp.MustCompile(`'([^']+)' in parents`)
	reName   = regexp.MustCompile(`name='([^']+)'`)
)

func (f *fakeDrive) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.limited > 0 {
		f.limited--
		w.WriteHeader(http.StatusTooManyRequests)
		return
	}
	if f.expired > 0 {
		f.expired--
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if r.Header.Get("Authorization") != "Bearer "+f.token {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	p := r.URL.Path
	now := time.Now()
	switch {
	case r.Method == "GET" && p == "/drive/v3/files":
		q := r.URL.Query().Get("q")
		var list []any
		for _, x := range f.files {
			if x.ID == "root" || x.Trashed {
				continue
			}
			if m := reParent.FindStringSubmatch(q); m != nil && x.Parent != m[1] {
				continue
			}
			if m := reName.FindStringSubmatch(q); m != nil && x.Name != m[1] {
				continue
			}
			if strings.Contains(q, "appProperties") && x.Props["folio"] != "root" {
				continue
			}
			list = append(list, f.view(x))
		}
		f.json(w, map[string]any{"files": list})
	case r.Method == "POST" && p == "/drive/v3/files":
		var meta struct {
			Name, MimeType string
			Parents        []string
			AppProperties  map[string]string
		}
		_ = json.NewDecoder(r.Body).Decode(&meta)
		x := &fdFile{ID: randomID(), Name: meta.Name, Mime: meta.MimeType, Parent: meta.Parents[0], Props: meta.AppProperties, Mod: now}
		f.files[x.ID] = x
		f.json(w, map[string]any{"id": x.ID})
	case r.Method == "POST" && p == "/upload/drive/v3/files":
		mt, params, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if mt != "multipart/related" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		mr := multipart.NewReader(r.Body, params["boundary"])
		meta, _ := mr.NextPart()
		var m struct {
			Name    string
			Parents []string
		}
		_ = json.NewDecoder(meta).Decode(&m)
		part, _ := mr.NextPart()
		data, _ := io.ReadAll(part)
		x := &fdFile{ID: randomID(), Name: m.Name, Parent: m.Parents[0], Mime: "application/octet-stream", Data: data, Mod: now}
		f.files[x.ID] = x
		f.json(w, map[string]any{"id": x.ID, "md5Checksum": md5hex(data)})
	case strings.HasPrefix(p, "/upload/drive/v3/files/") && r.Method == "PATCH":
		x := f.files[strings.TrimPrefix(p, "/upload/drive/v3/files/")]
		if x == nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		x.Data, _ = io.ReadAll(r.Body)
		x.Mod = now
		f.json(w, map[string]any{"md5Checksum": md5hex(x.Data)})
	case strings.HasPrefix(p, "/drive/v3/files/"):
		x := f.files[strings.TrimPrefix(p, "/drive/v3/files/")]
		if x == nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.Method == "PATCH" {
			var b struct{ Trashed bool }
			_ = json.NewDecoder(r.Body).Decode(&b)
			x.Trashed = b.Trashed
			f.json(w, map[string]any{"id": x.ID})
			return
		}
		if r.URL.Query().Get("alt") == "media" {
			_, _ = w.Write(x.Data)
			return
		}
		f.json(w, f.view(x))
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func newDrive(t *testing.T, fd *fakeDrive) *Drive {
	srv := httptest.NewServer(fd)
	t.Cleanup(srv.Close)
	tokens := 0
	return &Drive{APIBase: srv.URL, Backoff: 1, Token: func(context.Context) (string, error) {
		tokens++
		if tokens > 1 { // tras caducar se entrega uno nuevo
			return fd.token, nil
		}
		return "tok-1", nil
	}}
}

func TestDriveProvider(t *testing.T) {
	fd := newFakeDrive()
	d := newDrive(t, fd)
	ctx := context.Background()
	files, err := d.List(ctx)
	if err != nil || len(files) != 0 {
		t.Fatalf("List inicial: %v %v", files, err)
	}
	rev1, err := d.Put(ctx, "docs/abc/content.json", []byte("uno"), CreateOnly)
	if err != nil || rev1 != md5hex([]byte("uno")) {
		t.Fatalf("Put: %q %v", rev1, err)
	}
	if _, err := d.Put(ctx, "docs/abc/content.json", []byte("x"), CreateOnly); err != ErrConflict {
		t.Fatalf("crear algo que existe: %v", err)
	}
	rev2, err := d.Put(ctx, "docs/abc/content.json", []byte("dos"), rev1)
	if err != nil || rev2 != md5hex([]byte("dos")) {
		t.Fatalf("Put con revisión: %q %v", rev2, err)
	}
	if _, err := d.Put(ctx, "docs/abc/content.json", []byte("tres"), rev1); err != ErrConflict {
		t.Fatalf("revisión vieja: %v", err)
	}
	// Un archivo que no existe pero se esperaba con revisión → conflicto
	if _, err := d.Put(ctx, "nuevo.json", []byte("x"), "r-vieja"); err != ErrConflict {
		t.Fatalf("archivo desaparecido: %v", err)
	}
	// Otra instancia (otro dispositivo) lo ve todo con List
	d2 := newDrive(t, fd)
	files, err = d2.List(ctx)
	if err != nil || len(files) != 1 || files[0].Path != "docs/abc/content.json" || files[0].Rev != rev2 {
		t.Fatalf("List: %+v %v", files, err)
	}
	data, rev, err := d2.Get(ctx, "docs/abc/content.json")
	if err != nil || string(data) != "dos" || rev != rev2 {
		t.Fatalf("Get: %q %q %v", data, rev, err)
	}
	// Borrar manda a la papelera y exige la revisión
	if err := d2.Delete(ctx, "docs/abc/content.json", rev1); err != ErrConflict {
		t.Fatalf("Delete con revisión vieja: %v", err)
	}
	if err := d2.Delete(ctx, "docs/abc/content.json", rev2); err != nil {
		t.Fatal(err)
	}
	for _, x := range fd.files {
		if x.Name == "content.json" && !x.Trashed {
			t.Fatal("el archivo debía quedar en la papelera de Drive")
		}
	}
	files, _ = newDrive(t, fd).List(ctx)
	if len(files) != 0 {
		t.Fatalf("lo borrado no debe listarse: %+v", files)
	}
}

func TestDriveRetriesRateLimitAndExpiredToken(t *testing.T) {
	fd := newFakeDrive()
	d := newDrive(t, fd)
	fd.limited = 2
	fd.expired = 1
	if _, err := d.List(context.Background()); err != nil {
		t.Fatalf("debía reintentar y salir bien: %v", err)
	}
}

func TestEngineOverDrive(t *testing.T) {
	fd := newFakeDrive()
	a, b := newDevice(t, "A", newDrive(t, fd)), newDevice(t, "B", newDrive(t, fd))
	id := a.newDoc("Apuntes", "hola desde Drive")
	a.sync()
	b.sync()
	if a.docText(id) != b.docText(id) {
		t.Fatal("el contenido no coincide")
	}
	a.editDoc(id, "segunda versión", time.Now())
	a.sync()
	b.sync()
	if !strings.Contains(b.docText(id), "segunda versión") {
		t.Fatal("B no recibió el cambio")
	}
}
