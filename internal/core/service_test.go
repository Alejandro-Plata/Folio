package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	dir := t.TempDir()
	var events []string
	s, err := New(Options{ConfigDir: filepath.Join(dir, "cfg"), Workspace: filepath.Join(dir, "ws"), OS: "android", Version: "9.9.9",
		Emit: func(name string, _ ...any) { events = append(events, name) }})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// Todo el recorrido que hará Android: se llama al núcleo solo por Dispatch.
func TestServiceThroughDispatch(t *testing.T) {
	s := newTestService(t)
	call := func(method string, args ...any) string {
		t.Helper()
		b, _ := json.Marshal(args)
		out, err := Dispatch(s, method, string(b))
		if err != nil {
			t.Fatalf("%s: %v", method, err)
		}
		return out
	}

	var init InitData
	_ = json.Unmarshal([]byte(call("Init")), &init)
	if init.OS != "android" || init.Version != "9.9.9" || !init.Settings.PageView {
		t.Fatalf("Init: %+v", init)
	}

	var meta struct{ ID string }
	_ = json.Unmarshal([]byte(call("CreateDoc", CreateRequest{Title: "Apuntes", Content: `{"type":"doc","content":[{"type":"paragraph"}]}`})), &meta)
	if meta.ID == "" {
		t.Fatal("CreateDoc sin id")
	}
	call("SaveDoc", meta.ID, `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hola"}]}]}`, "hola", 1)
	var hits []struct{ ID string }
	_ = json.Unmarshal([]byte(call("Search", "hola")), &hits)
	if len(hits) != 1 || hits[0].ID != meta.ID {
		t.Fatalf("Search: %+v", hits)
	}

	// Exportar por ruta, sin diálogos
	out := filepath.Join(t.TempDir(), "apuntes.docx")
	call("ExportDocxTo", meta.ID, ExportOptions{IncludeTitle: true}, out)
	if st, err := os.Stat(out); err != nil || st.Size() < 1000 {
		t.Fatalf("docx no generado: %v", err)
	}

	// Agenda
	var task struct{ ID string }
	_ = json.Unmarshal([]byte(call("AgendaSaveTask", map[string]any{"title": "Repaso", "typeId": "review", "date": "2026-11-02", "done": false}, "")), &task)
	var tasks []struct{ Title string }
	_ = json.Unmarshal([]byte(call("AgendaRange", "2026-11-01", "2026-11-30")), &tasks)
	if task.ID == "" || len(tasks) != 1 {
		t.Fatalf("agenda: %+v %+v", task, tasks)
	}

	// Tutorial de la agenda: no toca la agenda real
	call("AgendaPractice", true)
	_ = json.Unmarshal([]byte(call("AgendaRange", "2026-11-01", "2026-11-30")), &tasks)
	if len(tasks) != 0 {
		t.Fatal("la agenda de práctica debería estar vacía")
	}
	call("AgendaPractice", false)
	_ = json.Unmarshal([]byte(call("AgendaRange", "2026-11-01", "2026-11-30")), &tasks)
	if len(tasks) != 1 {
		t.Fatal("la agenda real se perdió")
	}
}

func TestNewFallsBackToDefaultWorkspace(t *testing.T) {
	dir := t.TempDir()
	cfg := filepath.Join(dir, "cfg")
	_ = os.MkdirAll(cfg, 0o755)
	// Ajustes que apuntan a una ruta imposible de crear (un archivo en medio)
	blocker := filepath.Join(dir, "archivo")
	_ = os.WriteFile(blocker, []byte("x"), 0o644)
	_ = os.WriteFile(filepath.Join(cfg, "settings.json"), []byte(`{"workspace":"`+filepath.ToSlash(filepath.Join(blocker, "dentro"))+`"}`), 0o644)
	s, err := New(Options{ConfigDir: cfg, Workspace: filepath.Join(dir, "ws"), OS: "linux"})
	if err != nil {
		t.Fatal(err)
	}
	if s.Workspace() != filepath.Join(dir, "ws") {
		t.Fatalf("espacio = %s", s.Workspace())
	}
}
