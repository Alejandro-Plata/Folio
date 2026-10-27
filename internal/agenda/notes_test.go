package agenda

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAttachAndRemoveFiles(t *testing.T) {
	s := openTest(t)
	topics, err := s.SetTopics([]Topic{{Title: "La Constitución"}, {Title: "Derechos"}})
	if err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(t.TempDir(), "Tema 1: resumen.pdf")
	if err := os.WriteFile(src, []byte("%PDF-1.4 prueba"), 0o644); err != nil {
		t.Fatal(err)
	}
	tp, err := s.AttachFiles(topics[0].ID, []string{src})
	if err != nil {
		t.Fatal(err)
	}
	if len(tp.Files) != 1 || tp.Files[0].Name != "Tema 1: resumen.pdf" || tp.Files[0].Size != 15 {
		t.Fatalf("adjunto inesperado: %+v", tp.Files)
	}
	abs := s.FilePath(tp.Files[0].Path)
	if b, err := os.ReadFile(abs); err != nil || string(b) != "%PDF-1.4 prueba" {
		t.Fatalf("copia: %v %q", err, b)
	}
	if s.FilePath("../topics.json") != "" || s.FilePath("apuntes/../../x") != "" {
		t.Fatal("FilePath no debe salir de apuntes/")
	}

	// Guardar el temario desde la interfaz (sin archivos) no los pierde
	list := s.Topics()
	list[0].Files = nil
	if _, err := s.SetTopics(list); err != nil {
		t.Fatal(err)
	}
	if len(s.Topics()[0].Files) != 1 {
		t.Fatal("SetTopics ha perdido los apuntes")
	}
	// Deshacer no quita apuntes que siguen en disco
	if _, err := s.Undo(); err != nil {
		t.Fatal(err)
	}
	if len(s.Topics()[0].Files) != 1 {
		t.Fatal("deshacer ha perdido los apuntes")
	}
	// Persisten al reabrir
	s2, err := Open(s.dir)
	if err != nil || len(s2.Topics()[0].Files) != 1 {
		t.Fatalf("al reabrir: %v %+v", err, s2.Topics())
	}

	if tp, err = s.RemoveTopicFile(topics[0].ID, tp.Files[0].ID); err != nil || len(tp.Files) != 0 {
		t.Fatalf("quitar: %v %+v", err, tp.Files)
	}
	if _, err := os.Stat(abs); !os.IsNotExist(err) {
		t.Fatal("la copia sigue en disco")
	}

	// Quitar un tema borra sus apuntes
	tp, _ = s.AttachFiles(topics[1].ID, []string{src})
	abs = s.FilePath(tp.Files[0].Path)
	if _, err := s.SetTopics(s.Topics()[:1]); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(abs); !os.IsNotExist(err) {
		t.Fatal("los apuntes de un tema quitado siguen en disco")
	}
}

func TestForecast(t *testing.T) {
	s := openTest(t)
	topics, _ := s.SetTopics([]Topic{{Title: "Tema"}})
	id := topics[0].ID
	f, err := s.Forecast(id, "2026-10-01")
	if err != nil || !f.New || len(f.Curve) != 0 || len(f.Next) != 4 {
		t.Fatalf("tema nuevo: %v %+v", err, f)
	}
	if _, err := s.LogSession(Session{TopicID: id, Date: "2026-10-01", Minutes: 50, Rating: 3}); err != nil {
		t.Fatal(err)
	}
	f, err = s.Forecast(id, "2026-10-05")
	if err != nil || f.New || f.Reps != 1 || f.LastReview != "2026-10-01" {
		t.Fatalf("tras estudiarlo: %v %+v", err, f)
	}
	if f.Retention <= 0 || f.Retention >= 1 || f.Curve[0] < 0.99 {
		t.Fatalf("retención: %+v", f)
	}
	for i := 1; i < len(f.Curve); i++ {
		if f.Curve[i] > f.Curve[i-1] {
			t.Fatal("la curva del olvido debe bajar")
		}
	}
	// Cuanto mejor la valoración, más lejos el siguiente repaso
	if !(f.Next[1] <= f.Next[2] && f.Next[2] <= f.Next[3] && f.Next[3] <= f.Next[4]) || f.Next[4] <= "2026-10-05" {
		t.Fatalf("siguientes repasos: %+v", f.Next)
	}
}

func TestExternalEventsAreBusy(t *testing.T) {
	s := openTest(t)
	set := DefaultSettings()
	set.ExamDate = "2027-02-01"
	if err := s.SetSettings(set); err != nil {
		t.Fatal(err)
	}
	// Una cita el miércoles que ocupa toda la franja de estudio
	w := set.Windows["3"]
	if w.Start == "" {
		t.Fatal("sin franja de estudio el miércoles")
	}
	cita := Task{ID: "c:e1", Title: "Cita", TypeID: "circle:c1", Date: "2026-11-04", Start: w.Start, Minutes: MinutesOf(w.End) - MinutesOf(w.Start), Circle: &CircleRef{ID: "c1", Kind: "couple"}}
	s.SetExternal(func(from, to string) []Task {
		if cita.Date >= from && cita.Date <= to {
			return []Task{cita}
		}
		return nil
	})
	if _, err := s.SetTopics(makeTopics(10)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Plan(); err != nil {
		t.Fatal(err)
	}
	day := s.Range("2026-11-04", "2026-11-04")
	sawCita := false
	for _, x := range day {
		if x.ID == "c:e1" {
			sawCita = x.Circle != nil
			continue
		}
		if x.Auto && x.Start != "" {
			from, to := MinutesOf(x.Start), MinutesOf(x.Start)+x.Minutes
			if from < MinutesOf(cita.Start)+cita.Minutes && to > MinutesOf(cita.Start) {
				t.Fatalf("el plan pone %q (%s) encima de la cita", x.Title, x.Start)
			}
		}
	}
	if !sawCita {
		t.Fatal("la cita no aparece en Range")
	}
}
