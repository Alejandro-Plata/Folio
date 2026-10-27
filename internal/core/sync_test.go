package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/net/webdav"

	"folio/internal/agenda"
)

func davTestServer(t *testing.T) string {
	t.Helper()
	h := &webdav.Handler{FileSystem: webdav.NewMemFS(), LockSystem: webdav.NewMemLS()}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if u, p, ok := r.BasicAuth(); !ok || u != "ana" || p != "secreta" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		h.ServeHTTP(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv.URL + "/Folio"
}

type syncDevice struct {
	*Service
	events []string
}

func newSyncDevice(t *testing.T, name, url string) *syncDevice {
	t.Helper()
	d := &syncDevice{}
	dir := t.TempDir()
	s, err := New(Options{ConfigDir: filepath.Join(dir, "cfg"), Workspace: filepath.Join(dir, "ws"), OS: "linux", Version: "1",
		Emit: func(n string, _ ...any) { d.events = append(d.events, n) }})
	if err != nil {
		t.Fatal(err)
	}
	d.Service = s
	if _, err := s.SyncConfigure(SyncConfig{Provider: "webdav", URL: url, User: "ana", DeviceName: name}); err != nil {
		t.Fatal(err)
	}
	return d
}

func (d *syncDevice) now(t *testing.T) SyncResult {
	t.Helper()
	res, err := d.SyncNow("secreta")
	if err != nil {
		t.Fatalf("%s: %v", d.SyncStatus().Config.DeviceName, err)
	}
	return res
}

func (d *syncDevice) has(ev string) bool {
	for _, e := range d.events {
		if e == ev {
			return true
		}
	}
	return false
}

func TestSyncBetweenTwoServices(t *testing.T) {
	url := davTestServer(t)
	a, b := newSyncDevice(t, "Portátil", url), newSyncDevice(t, "Móvil", url)

	meta, err := a.CreateDoc(CreateRequest{Title: "Apuntes", Content: string(docJSON("inicio"))})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.AgendaSaveTask(taskJSON("Repaso"), ""); err != nil {
		t.Fatal(err)
	}
	a.now(t)
	res := b.now(t)
	if !res.Changed || !res.AgendaChanged || len(res.DocsChanged) != 1 || res.DocsChanged[0] != meta.ID {
		t.Fatalf("B: %+v", res)
	}
	if !b.has("sync:changed") || !b.has("sync:done") || !b.has("sync:progress") {
		t.Fatalf("eventos: %v", b.events)
	}
	// Los almacenes de B se han recargado: ve el documento y la tarea sin reiniciar
	if docs := b.ListDocs(); len(docs) != 1 || docs[0].Title != "Apuntes" {
		t.Fatalf("B no ve el documento: %+v", docs)
	}
	if tasks := b.AgendaRange("2026-11-01", "2026-11-30"); len(tasks) != 1 {
		t.Fatalf("B no ve la tarea: %+v", tasks)
	}
	if st := b.SyncStatus(); st.Config.LastSync == "" || st.Config.LastError != "" {
		t.Fatalf("estado: %+v", st)
	}

	// Conflicto: los dos editan; la edición de B (más reciente) gana y la de A queda en el historial de B
	_, _ = a.SaveDoc(meta.ID, string(docJSON("edición de A")), "edición de A", 3)
	_, _ = b.SaveDoc(meta.ID, string(docJSON("edición de B")), "edición de B", 3)
	future := time.Now().Add(time.Hour)
	_ = os.Chtimes(filepath.Join(b.Workspace(), "docs", meta.ID, "content.json"), future, future)
	a.now(t)
	res = b.now(t)
	if res.Conflicts != 1 {
		t.Fatalf("B debía tener un conflicto: %+v", res)
	}
	versions, err := b.ListVersions(meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, v := range versions {
		if strings.Contains(v.Label, "Conflicto") {
			vd, _ := b.GetVersion(meta.ID, v.ID)
			found = strings.Contains(string(vd.Content), "edición de A") && strings.Contains(vd.Text, "edición de A")
		}
	}
	if !found {
		t.Fatalf("la edición perdedora debe estar en el historial: %+v", versions)
	}
	a.now(t)
	for _, d := range []*syncDevice{a, b} {
		doc, _ := d.GetDoc(meta.ID)
		if !strings.Contains(string(doc.Content), "edición de B") {
			t.Fatalf("%s no tiene la edición más reciente", d.SyncStatus().Config.DeviceName)
		}
	}
}

func docJSON(text string) json.RawMessage {
	return json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"` + text + `"}]}]}`)
}

func taskJSON(title string) agenda.Task {
	return agenda.Task{Title: title, TypeID: "review", Date: "2026-11-02"}
}

func TestSyncConfigureValidatesAndUnlinks(t *testing.T) {
	s := newTestService(t)
	for _, bad := range []SyncConfig{
		{Provider: "webdav", URL: "http://nube.ejemplo.es/dav", User: "ana"}, // sin https
		{Provider: "webdav", URL: "https://nube.ejemplo.es/dav"},             // sin usuario
		{Provider: "otra"},
	} {
		if _, err := s.SyncConfigure(bad); err == nil {
			t.Errorf("debía rechazar %+v", bad)
		}
	}
	cfg, err := s.SyncConfigure(SyncConfig{Provider: "webdav", URL: "https://nube.ejemplo.es/dav", User: "ana"})
	if err != nil || cfg.DeviceID == "" || cfg.DeviceName == "" {
		t.Fatalf("%+v %v", cfg, err)
	}
	if !s.SyncStatus().Linked {
		t.Fatal("debía estar vinculada")
	}
	// SaveSettings desde la interfaz no puede borrar la vinculación
	st := s.Init().Settings
	st.Sync = SyncConfig{}
	if err := s.SaveSettings(st); err != nil {
		t.Fatal(err)
	}
	if !s.SyncStatus().Linked {
		t.Fatal("SaveSettings no debe tocar la configuración de la nube")
	}
	if _, err := s.SyncNow(""); err == nil {
		t.Fatal("sin contraseña debe fallar con un mensaje claro")
	}
	if err := s.SyncUnlink(); err != nil || s.SyncStatus().Linked {
		t.Fatalf("desvincular: %v", err)
	}
	if _, err := s.SyncNow("x"); err == nil {
		t.Fatal("sin nube vinculada debe fallar")
	}
}

func TestSyncTestChecksCredentials(t *testing.T) {
	url := davTestServer(t)
	s := newTestService(t)
	cfg := SyncConfig{Provider: "webdav", URL: url, User: "ana"}
	if err := s.SyncTest(cfg, "secreta"); err != nil {
		t.Fatal(err)
	}
	if err := s.SyncTest(cfg, "mala"); err == nil || !strings.Contains(err.Error(), "contraseña") {
		t.Fatalf("contraseña mala: %v", err)
	}
}
