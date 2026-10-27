package cloudsync

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func mustMerge(t *testing.T, in MergeInput) ([]byte, []Extra) {
	t.Helper()
	out, extras, err := Merge(in)
	if err != nil {
		t.Fatal(err)
	}
	return out, extras
}

func tasksOf(t *testing.T, raw []byte) map[string]map[string]any {
	t.Helper()
	var list []map[string]any
	if err := json.Unmarshal(raw, &list); err != nil {
		t.Fatalf("%v\n%s", err, raw)
	}
	out := map[string]map[string]any{}
	for _, x := range list {
		out[x["id"].(string)] = x
	}
	return out
}

func TestClassify(t *testing.T) {
	cases := map[string]Kind{
		"docs/abc/files/x.png":           KindImmutable,
		"docs/abc/versions/h.json.gz":    KindImmutable,
		"docs/abc/versions/index.json":   KindVersionsIndex,
		"docs/abc/meta.json":             KindDocMeta,
		"docs/abc/content.json":          KindDocContent,
		"docs/abc/content.txt":           KindDocText,
		"agenda/tasks/2026-11.json":      KindTasks,
		"agenda/sessions/2026-11.jsonl":  KindSessions,
		"agenda/topics.json":             KindTopics,
		"agenda/types.json":              KindTypes,
		"agenda/templates.json":          KindTemplates,
		"agenda/settings.json":           KindAgendaSettings,
		"agenda/apuntes/ab12-Tema 1.pdf": KindImmutable,
		"notas.txt":                      KindOther,
	}
	for p, want := range cases {
		if got := Classify(p); got != want {
			t.Errorf("%s: %v, se esperaba %v", p, got, want)
		}
	}
}

func TestMergeTasksFieldByField(t *testing.T) {
	base := `[{"id":"a","title":"Estudio","minutes":60,"date":"2026-11-02","updated":"2026-11-01T10:00:00Z"},
	           {"id":"b","title":"B","date":"2026-11-03","updated":"2026-11-01T10:00:00Z"},
	           {"id":"c","title":"C","date":"2026-11-04","updated":"2026-11-01T10:00:00Z"}]`
	// A cambia el título de «a» y borra «c»; B cambia los minutos de «a», toca «b» y añade «d»
	local := `[{"id":"a","title":"Estudio nuevo","minutes":60,"date":"2026-11-02","updated":"2026-11-02T10:00:00Z"},
	            {"id":"b","title":"B","date":"2026-11-03","updated":"2026-11-01T10:00:00Z"}]`
	remote := `[{"id":"a","title":"Estudio","minutes":90,"date":"2026-11-02","updated":"2026-11-02T11:00:00Z"},
	             {"id":"b","title":"B editada","date":"2026-11-03","updated":"2026-11-02T11:00:00Z"},
	             {"id":"c","title":"C","date":"2026-11-04","updated":"2026-11-01T10:00:00Z"},
	             {"id":"d","title":"D","date":"2026-11-05","updated":"2026-11-02T11:00:00Z"}]`
	out, _ := mustMerge(t, MergeInput{Path: "agenda/tasks/2026-11.json", Base: []byte(base), Local: []byte(local), Remote: []byte(remote)})
	got := tasksOf(t, out)
	if got["a"]["title"] != "Estudio nuevo" || got["a"]["minutes"].(float64) != 90 {
		t.Errorf("a: los dos cambios deben conservarse: %v", got["a"])
	}
	if got["b"]["title"] != "B editada" {
		t.Errorf("b: %v", got["b"])
	}
	if _, ok := got["c"]; ok {
		t.Error("c: borrada en un lado y sin tocar en el otro debe desaparecer")
	}
	if got["d"] == nil {
		t.Error("d: añadida en un lado debe existir")
	}
}

func TestMergeTaskEditBeatsDelete(t *testing.T) {
	base := `[{"id":"a","title":"A","date":"2026-11-02","updated":"2026-11-01T10:00:00Z"}]`
	edited := `[{"id":"a","title":"A cambiada","date":"2026-11-02","updated":"2026-11-02T10:00:00Z"}]`
	out, _ := mustMerge(t, MergeInput{Path: "agenda/tasks/2026-11.json", Base: []byte(base), Local: []byte("[]"), Remote: []byte(edited)})
	if tasksOf(t, out)["a"] == nil {
		t.Fatal("una tarea editada en un lado no puede perderse porque se borró en el otro")
	}
}

func TestMergeSeriesDoneAndExceptAreSets(t *testing.T) {
	series := func(except, done string) string {
		return `[{"id":"s","title":"Serie","date":"2026-11-02","updated":"2026-11-01T10:00:00Z","repeat":{"freq":"daily","interval":1,"except":[` + except + `],"done":[` + done + `]}}]`
	}
	base := series(``, `"2026-11-02"`)
	local := series(`"2026-11-04"`, `"2026-11-02","2026-11-03"`)  // A: quita el día 4, marca el 3
	remote := series(`"2026-11-05"`, `"2026-11-02","2026-11-06"`) // B: quita el 5, marca el 6
	out, _ := mustMerge(t, MergeInput{Path: "agenda/tasks/2026-11.json", Base: []byte(base), Local: []byte(local), Remote: []byte(remote)})
	rep := tasksOf(t, out)["s"]["repeat"].(map[string]any)
	if s := strings.Join(toStrings(rep["except"]), ","); s != "2026-11-04,2026-11-05" {
		t.Errorf("except = %s", s)
	}
	if s := strings.Join(toStrings(rep["done"]), ","); s != "2026-11-02,2026-11-03,2026-11-06" {
		t.Errorf("done = %s", s)
	}
	// Desmarcar en un lado se respeta
	local = series(``, ``)
	remote = series(``, `"2026-11-02","2026-11-06"`)
	out, _ = mustMerge(t, MergeInput{Path: "agenda/tasks/2026-11.json", Base: []byte(base), Local: []byte(local), Remote: []byte(remote)})
	rep = tasksOf(t, out)["s"]["repeat"].(map[string]any)
	if s := strings.Join(toStrings(rep["done"]), ","); s != "2026-11-06" {
		t.Errorf("desmarcada: done = %s", s)
	}
}

func toStrings(v any) []string {
	var out []string
	for _, x := range v.([]any) {
		out = append(out, x.(string))
	}
	return out
}

func TestMergeTopicsKeepMemoryAndTitle(t *testing.T) {
	topic := func(title, last string, reps int) string {
		return `[{"id":"t","number":1,"title":"` + title + `","weight":1,"memory":{"Due":"2026-11-10T00:00:00Z","Reps":` + itoa(reps) + `,"LastReview":"` + last + `"}}]`
	}
	base := topic("Tema", "2026-11-01T00:00:00Z", 1)
	local := topic("Tema", "2026-11-05T00:00:00Z", 2)            // A: valora un repaso
	remote := topic("Tema reescrito", "2026-11-01T00:00:00Z", 1) // B: cambia el título
	out, _ := mustMerge(t, MergeInput{Path: "agenda/topics.json", Base: []byte(base), Local: []byte(local), Remote: []byte(remote)})
	got := tasksOf2(t, out)["t"]
	mem := got["memory"].(map[string]any)
	if got["title"] != "Tema reescrito" || mem["Reps"].(float64) != 2 {
		t.Fatalf("se debían conservar el título de B y la memoria de A: %v", got)
	}
	// Los dos valoran: gana el repaso más reciente
	remote = topic("Tema", "2026-11-07T00:00:00Z", 3)
	out, _ = mustMerge(t, MergeInput{Path: "agenda/topics.json", Base: []byte(base), Local: []byte(local), Remote: []byte(remote)})
	if tasksOf2(t, out)["t"]["memory"].(map[string]any)["Reps"].(float64) != 3 {
		t.Fatal("debía ganar la memoria con el repaso más reciente")
	}
}

func tasksOf2(t *testing.T, raw []byte) map[string]map[string]any { return tasksOf(t, raw) }
func itoa(n int) string                                           { b, _ := json.Marshal(n); return string(b) }

func TestMergeSessionsUnion(t *testing.T) {
	l := `{"id":"1","date":"2026-11-02","minutes":50}` + "\n"
	r := `{"id":"2","date":"2026-11-03","minutes":25}` + "\n"
	out, _ := mustMerge(t, MergeInput{Path: "agenda/sessions/2026-11.jsonl", Local: []byte(l), Remote: []byte(r)})
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) != 2 || !strings.Contains(lines[0], `"id":"1"`) || !strings.Contains(lines[1], `"id":"2"`) {
		t.Fatalf("%s", out)
	}
}

func TestMergeVersionIndexUnion(t *testing.T) {
	l := `[{"id":"a","created":"2026-11-01T10:00:00Z","label":"A","hash":"h1"}]`
	r := `[{"id":"b","created":"2026-11-01T09:00:00Z","label":"B","hash":"h2"}]`
	out, _ := mustMerge(t, MergeInput{Path: "docs/abc/versions/index.json", Local: []byte(l), Remote: []byte(r)})
	var list []map[string]any
	_ = json.Unmarshal(out, &list)
	if len(list) != 2 || list[0]["id"] != "b" {
		t.Fatalf("debían estar las dos, la más antigua primero: %s", out)
	}
}

func TestMergeMetaTrashWins(t *testing.T) {
	meta := func(trashed bool, order int, updated string) string {
		return `{"meta":{"id":"abc","title":"T","trashed":` + map[bool]string{true: "true", false: "false"}[trashed] + `,"order":` + itoa(order) + `,"updated":"` + updated + `"},"setup":{}}`
	}
	base := meta(false, 1, "2026-11-01T10:00:00Z")
	local := meta(true, 1, "2026-11-02T10:00:00Z")   // A manda el documento a la papelera
	remote := meta(false, 5, "2026-11-03T10:00:00Z") // B solo cambia el orden, más tarde
	out, _ := mustMerge(t, MergeInput{Path: "docs/abc/meta.json", Base: []byte(base), Local: []byte(local), Remote: []byte(remote)})
	var m map[string]map[string]any
	_ = json.Unmarshal(out, &m)
	if m["meta"]["trashed"] != true || m["meta"]["order"].(float64) != 5 {
		t.Fatalf("la papelera de A y el orden de B deben conservarse: %v", m["meta"])
	}
}

func TestMergeContentNewestWinsLoserBecomesVersion(t *testing.T) {
	now := time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC)
	in := MergeInput{Path: "docs/abc/content.json", Local: []byte(`{"v":"local"}`), Remote: []byte(`{"v":"remota"}`),
		LocalMod: now, RemoteMod: now.Add(time.Hour), Device: "Móvil", Now: now}
	out, extras := mustMerge(t, in)
	if string(out) != `{"v":"remota"}` || len(extras) != 1 || extras[0].Kind != "version" || extras[0].DocID != "abc" ||
		string(extras[0].Data) != `{"v":"local"}` || !strings.Contains(extras[0].Label, "Conflicto") || !strings.Contains(extras[0].Label, "Móvil") {
		t.Fatalf("%s %+v", out, extras)
	}
	in.LocalMod, in.RemoteMod = now.Add(time.Hour), now
	out, extras = mustMerge(t, in)
	if string(out) != `{"v":"local"}` || string(extras[0].Data) != `{"v":"remota"}` {
		t.Fatalf("%s %+v", out, extras)
	}
}

func TestMergeUnknownFileKeepsBothCopies(t *testing.T) {
	now := time.Now()
	out, extras := mustMerge(t, MergeInput{Path: "notas.txt", Local: []byte("a"), Remote: []byte("b"), LocalMod: now, RemoteMod: now.Add(time.Minute), Device: "PC"})
	if string(out) != "b" || len(extras) != 1 || extras[0].Kind != "file" || extras[0].Path != "notas (conflicto PC).txt" || string(extras[0].Data) != "a" {
		t.Fatalf("%s %+v", out, extras)
	}
}
