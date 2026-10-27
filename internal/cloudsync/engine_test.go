package cloudsync

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"folio/internal/agenda"
	"folio/internal/store"
)

// device es un «dispositivo»: una carpeta de trabajo con su motor de sincronización.
type device struct {
	t    *testing.T
	root string
	eng  *Engine
}

func newDevice(t *testing.T, name string, p Provider) *device {
	t.Helper()
	root := filepath.Join(t.TempDir(), name)
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	return &device{t: t, root: root, eng: &Engine{Root: root, Provider: p, Device: name}}
}

func (d *device) sync() *Report {
	d.t.Helper()
	rep, err := d.eng.Sync(context.Background())
	if err != nil {
		d.t.Fatalf("%s: %v", d.eng.Device, err)
	}
	for _, e := range rep.Errors {
		d.t.Fatalf("%s: error de sincronización: %s", d.eng.Device, e)
	}
	return rep
}

// Los almacenes se abren de nuevo tras cada sincronización, como hace el núcleo.
func (d *device) store() *store.Store {
	d.t.Helper()
	s, err := store.Open(d.root)
	if err != nil {
		d.t.Fatal(err)
	}
	return s
}

func (d *device) agenda() *agenda.Store {
	d.t.Helper()
	a, err := agenda.Open(filepath.Join(d.root, "agenda"))
	if err != nil {
		d.t.Fatal(err)
	}
	return a
}

func content(text string) json.RawMessage {
	return json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"` + text + `"}]}]}`)
}

func (d *device) newDoc(title, text string) string {
	d.t.Helper()
	m, err := d.store().Create("", title, "", content(text), text, nil)
	if err != nil {
		d.t.Fatal(err)
	}
	return m.ID
}

func (d *device) editDoc(id, text string, mod time.Time) {
	d.t.Helper()
	if _, err := d.store().Save(id, content(text), text, 1); err != nil {
		d.t.Fatal(err)
	}
	// La fecha del archivo decide quién gana en un conflicto
	p := filepath.Join(d.root, "docs", id, "content.json")
	if err := os.Chtimes(p, mod, mod); err != nil {
		d.t.Fatal(err)
	}
}

func (d *device) docText(id string) string {
	d.t.Helper()
	doc, err := d.store().Get(id)
	if err != nil {
		d.t.Fatalf("%s: %v", d.eng.Device, err)
	}
	return string(doc.Content)
}

func (d *device) hasDoc(id string) bool {
	for _, m := range d.store().List() {
		if m.ID == id && !m.Trashed {
			return true
		}
	}
	return false
}

func TestFirstSyncAndPropagation(t *testing.T) {
	cloud := newMem()
	a, b := newDevice(t, "A", cloud), newDevice(t, "B", cloud)
	id := a.newDoc("Apuntes", "hola")
	if rep := a.sync(); rep.Uploaded == 0 {
		t.Fatal("A no ha subido nada")
	}
	rep := b.sync()
	if rep.Downloaded == 0 || len(rep.DocsChanged) != 1 || rep.DocsChanged[0] != id {
		t.Fatalf("B: %+v", rep)
	}
	if a.docText(id) != b.docText(id) {
		t.Fatal("el contenido no coincide")
	}
	// Sin cambios, no se hace nada
	if rep := b.sync(); rep.Uploaded+rep.Downloaded+rep.Merged != 0 {
		t.Fatalf("sincronización sin cambios: %+v", rep)
	}
	// A edita y B lo recibe
	a.editDoc(id, "hola mundo", time.Now())
	a.sync()
	b.sync()
	if !strings.Contains(b.docText(id), "hola mundo") {
		t.Fatal("B no recibió la edición")
	}
}

func TestConflictNewestWinsOtherBecomesVersion(t *testing.T) {
	cloud := newMem()
	a, b := newDevice(t, "A", cloud), newDevice(t, "B", cloud)
	id := a.newDoc("Apuntes", "inicio")
	a.sync()
	b.sync()
	// Los dos editan sin haber sincronizado; la de B es más reciente
	a.editDoc(id, "version de A", time.Now())
	b.editDoc(id, "version de B", time.Now().Add(time.Hour))
	a.sync() // A sube la suya
	rep := b.sync()
	if rep.Merged == 0 || rep.Conflicts != 1 || len(rep.Extras) != 1 {
		t.Fatalf("B: %+v", rep)
	}
	x := rep.Extras[0]
	if x.Kind != "version" || x.DocID != id || !strings.Contains(string(x.Data), "version de A") || !strings.Contains(x.Label, "Conflicto") {
		t.Fatalf("la versión perdedora (A) debe guardarse en el historial: %+v", x)
	}
	a.sync()
	if !strings.Contains(a.docText(id), "version de B") || !strings.Contains(b.docText(id), "version de B") {
		t.Fatal("tras sincronizar, los dos deben tener la versión más reciente")
	}
}

func TestDeleteRules(t *testing.T) {
	cloud := newMem()
	a, b := newDevice(t, "A", cloud), newDevice(t, "B", cloud)
	keep, gone := a.newDoc("Se queda", "x"), a.newDoc("Se borra", "y")
	a.sync()
	b.sync()
	// A borra uno que B no ha tocado
	if err := a.store().Delete(gone); err != nil {
		t.Fatal(err)
	}
	a.sync()
	rep := b.sync()
	if b.hasDoc(gone) || rep.DeletedLocal == 0 {
		t.Fatalf("B debía borrarlo: %+v", rep)
	}
	if _, err := os.Stat(filepath.Join(b.root, "docs", gone)); !os.IsNotExist(err) {
		t.Fatal("la carpeta del documento borrado debe desaparecer")
	}
	// A borra «keep» mientras B lo edita: sobrevive en los dos
	if err := a.store().Delete(keep); err != nil {
		t.Fatal(err)
	}
	b.editDoc(keep, "editado en B", time.Now())
	a.sync()
	b.sync()
	a.sync()
	if !a.hasDoc(keep) || !b.hasDoc(keep) || !strings.Contains(a.docText(keep), "editado en B") {
		t.Fatalf("el documento editado no puede perderse (A: %v, B: %v)", a.hasDoc(keep), b.hasDoc(keep))
	}
}

func TestAgendaTasksMerge(t *testing.T) {
	cloud := newMem()
	a, b := newDevice(t, "A", cloud), newDevice(t, "B", cloud)
	task := func(title, date string) agenda.Task { return agenda.Task{Title: title, TypeID: "study", Date: date} }
	base, _ := a.agenda().SaveTask(task("Base", "2026-11-02"), "")
	toDelete, _ := a.agenda().SaveTask(task("Se borra", "2026-11-03"), "")
	series, _ := a.agenda().SaveTask(agenda.Task{Title: "Serie", TypeID: "study", Date: "2026-11-02",
		Repeat: &agenda.Repeat{Freq: "daily", Interval: 1}}, "")
	a.sync()
	b.sync()

	// A: añade una tarea, borra otra y marca hecha una ocurrencia de la serie
	if _, err := a.agenda().SaveTask(task("De A", "2026-11-10"), ""); err != nil {
		t.Fatal(err)
	}
	if err := a.agenda().DeleteTasks([]string{toDelete.ID}, "one"); err != nil {
		t.Fatal(err)
	}
	if err := a.agenda().SetDone(agenda.OccurrenceID(series.ID, "2026-11-04"), true); err != nil {
		t.Fatal(err)
	}
	// B: añade otra tarea en el mismo mes, cambia el título de la base y marca hecha otra ocurrencia
	if _, err := b.agenda().SaveTask(task("De B", "2026-11-11"), ""); err != nil {
		t.Fatal(err)
	}
	renamed := base
	renamed.Title = "Base cambiada"
	if _, err := b.agenda().SaveTask(renamed, ""); err != nil {
		t.Fatal(err)
	}
	if err := b.agenda().SetDone(agenda.OccurrenceID(series.ID, "2026-11-05"), true); err != nil {
		t.Fatal(err)
	}

	a.sync()
	rep := b.sync()
	if !rep.AgendaChanged {
		t.Fatal("B debía notar que la agenda cambió")
	}
	a.sync()
	for _, d := range []*device{a, b} {
		titles := map[string]bool{}
		done := map[string]bool{}
		for _, x := range d.agenda().Range("2026-11-01", "2026-11-30") {
			titles[x.Title] = true
			if x.OccurrenceOf != "" && x.Done {
				done[x.Date] = true
			}
		}
		for _, want := range []string{"De A", "De B", "Base cambiada", "Serie"} {
			if !titles[want] {
				t.Errorf("%s: falta «%s» (%v)", d.eng.Device, want, titles)
			}
		}
		if titles["Se borra"] || titles["Base"] {
			t.Errorf("%s: no deberían estar «Se borra» ni «Base»: %v", d.eng.Device, titles)
		}
		if !done["2026-11-04"] || !done["2026-11-05"] {
			t.Errorf("%s: las dos ocurrencias marcadas deben seguir hechas: %v", d.eng.Device, done)
		}
	}
}

func TestTopicsKeepMemoryAndTitle(t *testing.T) {
	cloud := newMem()
	a, b := newDevice(t, "A", cloud), newDevice(t, "B", cloud)
	topics, err := a.agenda().SetTopics([]agenda.Topic{{Title: "Tema original"}})
	if err != nil {
		t.Fatal(err)
	}
	a.sync()
	b.sync()
	// A valora un repaso; B cambia el título
	if _, err := a.agenda().LogSession(agenda.Session{TopicID: topics[0].ID, Date: "2026-11-02", Minutes: 50, Rating: 3}); err != nil {
		t.Fatal(err)
	}
	bt := b.agenda().Topics()
	bt[0].Title = "Tema reescrito"
	if _, err := b.agenda().SetTopics(bt); err != nil {
		t.Fatal(err)
	}
	a.sync()
	b.sync()
	a.sync()
	for _, d := range []*device{a, b} {
		got := d.agenda().Topics()[0]
		if got.Title != "Tema reescrito" || got.Memory.Reps != 1 || got.Studied != "2026-11-02" {
			t.Errorf("%s: %+v", d.eng.Device, got)
		}
		if n := len(d.agenda().Sessions("", "")); n != 1 {
			t.Errorf("%s: %d sesiones", d.eng.Device, n)
		}
	}
}

func TestInterruptedSyncResumesWithoutDuplicates(t *testing.T) {
	cloud := newMem()
	a, b := newDevice(t, "A", cloud), newDevice(t, "B", cloud)
	var ids []string
	for _, n := range []string{"Uno", "Dos", "Tres", "Cuatro"} {
		ids = append(ids, a.newDoc(n, "texto "+n))
	}
	cloud.failAfter = 6 // la conexión se corta a mitad
	if rep, _ := a.eng.Sync(context.Background()); len(rep.Errors) == 0 {
		t.Fatal("debía haber errores por el corte")
	}
	cloud.failAfter = 0
	cloud.ops = 0
	a.sync()
	b.sync()
	for _, id := range ids {
		if !b.hasDoc(id) || a.docText(id) != b.docText(id) {
			t.Fatalf("documento %s incompleto en B", id)
		}
	}
	if n := len(b.store().List()); n != 4 {
		t.Fatalf("B tiene %d documentos, esperaba 4", n)
	}
}

func TestPutConflictIsRetried(t *testing.T) {
	cloud := newMem()
	a, b := newDevice(t, "A", cloud), newDevice(t, "B", cloud)
	id := a.newDoc("Apuntes", "inicio")
	a.sync()
	b.sync()
	a.editDoc(id, "cambio de A", time.Now())
	// Justo antes de que A suba content.json, B sube su propia versión (más reciente)
	cloud.beforePut = func(p string) {
		if !strings.HasSuffix(p, "content.json") {
			return
		}
		cloud.beforePut = nil
		b.editDoc(id, "cambio de B", time.Now().Add(time.Hour))
		if _, err := b.eng.Sync(context.Background()); err != nil {
			t.Error(err)
		}
	}
	a.sync()
	if cloud.conflicts == 0 {
		t.Fatal("la prueba no ha provocado ningún ErrConflict")
	}
	a.sync()
	b.sync()
	if !strings.Contains(a.docText(id), "cambio de B") || a.docText(id) != b.docText(id) {
		t.Fatalf("A y B deben converger en el cambio más reciente:\nA: %s\nB: %s", a.docText(id), b.docText(id))
	}
}

func TestExcludedFilesAreNeverUploaded(t *testing.T) {
	cloud := newMem()
	a := newDevice(t, "A", cloud)
	a.newDoc("Apuntes", "x")
	for _, p := range []string{".tmp-123", ".folio-sync/otro.json", "docs/.oculto"} {
		full := filepath.Join(a.root, p)
		_ = os.MkdirAll(filepath.Dir(full), 0o755)
		_ = os.WriteFile(full, []byte("no"), 0o644)
	}
	a.sync()
	a.sync()
	for p := range cloud.files {
		if ignored(p) {
			t.Errorf("se subió un archivo excluido: %s", p)
		}
	}
	if !cloud.has("docs/") {
		t.Fatal("los documentos sí deben subirse")
	}
}
