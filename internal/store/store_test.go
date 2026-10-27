package store

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func doc(text string) json.RawMessage {
	return json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"` + text + `"}]}]}`)
}

func newTestStore(t *testing.T) (*Store, *time.Time) {
	t.Helper()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	clock := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return clock }
	return s, &clock
}

func TestCreateSaveReopen(t *testing.T) {
	s, _ := newTestStore(t)
	m, err := s.Create("", "Tema 1", "book", nil, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Save(m.ID, doc("Hola mundo"), "Hola mundo", 2); err != nil {
		t.Fatal(err)
	}
	s2, err := Open(s.Root())
	if err != nil {
		t.Fatal(err)
	}
	d, err := s2.Get(m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if d.Meta.Title != "Tema 1" || d.Meta.Words != 2 || !strings.Contains(string(d.Content), "Hola mundo") {
		t.Fatalf("documento inesperado: %+v %s", d.Meta, d.Content)
	}
}

func TestAutoVersions(t *testing.T) {
	s, clock := newTestStore(t)
	m, _ := s.Create("", "Apuntes", "", nil, "", nil)
	vs, _ := s.Versions(m.ID)
	if len(vs) != 1 || vs[0].Kind != KindCreated {
		t.Fatalf("se esperaba la versión inicial, hay %+v", vs)
	}

	// Un guardado inmediato no crea versión: aún no ha pasado AutoInterval.
	r, _ := s.Save(m.ID, doc("a"), "a", 1)
	if r.VersionCreated {
		t.Fatal("no debería crear versión tan pronto")
	}
	*clock = clock.Add(11 * time.Minute)
	r, _ = s.Save(m.ID, doc("ab"), "ab", 1)
	if !r.VersionCreated {
		t.Fatal("debería crear versión automática")
	}
	// Mismo contenido: no se duplica.
	*clock = clock.Add(11 * time.Minute)
	r, _ = s.Save(m.ID, doc("ab"), "ab", 1)
	if r.VersionCreated {
		t.Fatal("no debería versionar contenido idéntico")
	}

	s.Save(m.ID, doc("abc"), "abc", 1)
	*clock = clock.Add(time.Minute)
	s.Save(m.ID, doc("abcd"), "abcd", 1)
	s.SnapshotDirty()
	vs, _ = s.Versions(m.ID)
	if vs[0].Label != "Al cerrar" {
		t.Fatalf("falta la versión al cerrar: %+v", vs[0])
	}
}

func TestRestoreVersion(t *testing.T) {
	s, clock := newTestStore(t)
	m, _ := s.Create("", "Examen", "", nil, "", nil)
	*clock = clock.Add(time.Hour)
	s.Save(m.ID, doc("primera"), "primera", 1)
	v, err := s.CreateVersion(m.ID, "Borrador 1")
	if err != nil {
		t.Fatal(err)
	}
	*clock = clock.Add(time.Hour)
	s.Save(m.ID, doc("segunda"), "segunda", 1)

	d, err := s.RestoreVersion(m.ID, v.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(d.Content), "primera") {
		t.Fatalf("no se restauró: %s", d.Content)
	}
	vs, _ := s.Versions(m.ID)
	foundBackup := false
	for _, v := range vs {
		if v.Kind == KindBackup {
			vd, _ := s.Version(m.ID, v.ID)
			foundBackup = strings.Contains(string(vd.Content), "segunda")
		}
	}
	if !foundBackup {
		t.Fatal("falta la copia de seguridad previa a restaurar")
	}
}

func TestPruneAuto(t *testing.T) {
	now := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	var idx []Version
	for i := 0; i < 24*10; i++ { // una versión cada hora durante 10 días
		idx = append(idx, Version{ID: string(rune('a' + i%26)), Kind: KindAuto, Created: now.Add(-time.Duration(240-i) * time.Hour), Hash: strings.Repeat("0", 64)})
		idx[len(idx)-1].ID = time.Duration(i).String()
	}
	idx = append(idx, Version{ID: "m", Kind: KindManual, Created: now.Add(-300 * time.Hour), Hash: strings.Repeat("0", 64)})
	out := pruneAuto(idx, now)
	if len(out) >= len(idx) {
		t.Fatal("no se podó nada")
	}
	hasManual := false
	for _, v := range out {
		if v.Kind == KindManual {
			hasManual = true
		}
	}
	if !hasManual {
		t.Fatal("se borró una versión con nombre")
	}
}

func TestTrashTreeAndSearch(t *testing.T) {
	s, _ := newTestStore(t)
	p, _ := s.Create("", "Biología", "", nil, "", nil)
	c, _ := s.Create(p.ID, "La célula", "", nil, "", nil)
	s.Save(c.ID, doc("La mitocondria produce energía"), "La mitocondria produce energía", 4)

	hits := s.Search("ENERGIA celula", 10)
	if len(hits) != 1 || hits[0].ID != c.ID {
		t.Fatalf("búsqueda sin tildes falló: %+v", hits)
	}
	if err := s.Trash(p.ID); err != nil {
		t.Fatal(err)
	}
	for _, m := range s.List() {
		if !m.Trashed {
			t.Fatalf("%s debería estar en la papelera", m.Title)
		}
	}
	if hits := s.Search("zzz", 10); hits == nil {
		t.Fatal("Search debe devolver un slice vacío, no nil")
	}
	if len(s.Search("energia", 10)) != 0 {
		t.Fatal("la papelera no debe aparecer en la búsqueda")
	}
	if _, err := s.UpdateMeta(p.ID, MetaPatch{ParentID: &c.ID}); err == nil {
		t.Fatal("debería impedir mover una página dentro de su hija")
	}
	if err := s.EmptyTrash(); err != nil {
		t.Fatal(err)
	}
	if len(s.List()) != 0 {
		t.Fatal("la papelera no se vació")
	}
}

func TestAssetPathRejectsTraversal(t *testing.T) {
	s, _ := newTestStore(t)
	for _, u := range []string{"/files/../../etc/passwd", "/files/abcdef12/../x.png", "/files/abcdef12/x.png"} {
		if _, err := s.AssetPath(u); err == nil {
			t.Fatalf("debería rechazar %s", u)
		}
	}
	m, _ := s.Create("", "x", "", nil, "", nil)
	url, err := s.SaveAsset(m.ID, "foto.PNG", []byte("png"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AssetPath(url); err != nil {
		t.Fatal(err)
	}
}

func TestImportVersion(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	m, err := s.Create("", "Apuntes", "", json.RawMessage(emptyDoc), "", nil)
	if err != nil {
		t.Fatal(err)
	}
	lost := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"texto perdido"}]}]}`)
	v, err := s.ImportVersion(m.ID, lost, "Conflicto · versión de Móvil")
	if err != nil {
		t.Fatal(err)
	}
	if v.Kind != KindManual || v.Label != "Conflicto · versión de Móvil" {
		t.Fatalf("%+v", v)
	}
	vd, err := s.Version(m.ID, v.ID)
	if err != nil || string(vd.Content) != string(lost) || !strings.Contains(vd.Text, "texto perdido") {
		t.Fatalf("versión importada: %+v %v", vd, err)
	}
	if _, err := s.ImportVersion("00000000deadbeef", lost, "x"); err == nil {
		t.Fatal("un documento que no existe debe dar error")
	}
	if _, err := s.ImportVersion(m.ID, json.RawMessage(`no es json`), "x"); err == nil {
		t.Fatal("un contenido no válido debe dar error")
	}
}
