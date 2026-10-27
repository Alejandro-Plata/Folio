package agenda

import (
	"fmt"
	"reflect"
	"sort"
	"strconv"
	"testing"
	"time"
)

func dates(list []Task) []string {
	var out []string
	for _, t := range list {
		out = append(out, t.Date)
	}
	return out
}

func TestOccurrences(t *testing.T) {
	cases := []struct {
		name     string
		task     Task
		from, to string
		want     []string
	}{
		{"cada día con excepción", Task{ID: "a", Date: "2026-03-27", Repeat: &Repeat{Freq: "daily", Interval: 1, Except: []string{"2026-03-29"}}},
			"2026-03-27", "2026-03-31", []string{"2026-03-27", "2026-03-28", "2026-03-30", "2026-03-31"}}, // cruza el cambio de hora de marzo
		{"cada 2 semanas lunes y jueves hasta una fecha", Task{ID: "b", Date: "2026-10-05", Repeat: &Repeat{Freq: "weekly", Interval: 2, Weekdays: []int{1, 4}, Until: "2026-11-05"}},
			"2026-10-01", "2026-11-30", []string{"2026-10-05", "2026-10-08", "2026-10-19", "2026-10-22", "2026-11-02", "2026-11-05"}},
		{"mensual el día 31 cae en el último día", Task{ID: "c", Date: "2027-01-31", Repeat: &Repeat{Freq: "monthly", Interval: 1}},
			"2027-01-01", "2027-04-30", []string{"2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"}},
		{"bisiesto", Task{ID: "d", Date: "2028-01-31", Repeat: &Repeat{Freq: "monthly", Interval: 1}},
			"2028-02-01", "2028-02-29", []string{"2028-02-29"}},
		{"de lunes a viernes, cruza el cambio de hora de octubre", Task{ID: "e", Date: "2026-10-23", Repeat: &Repeat{Freq: "weekly", Interval: 1, Weekdays: []int{1, 2, 3, 4, 5}}},
			"2026-10-23", "2026-10-28", []string{"2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28"}},
	}
	for _, c := range cases {
		got := dates(occurrences(&c.task, c.from, c.to))
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s:\n got %v\nwant %v", c.name, got, c.want)
		}
	}
}

func TestDateHelpers(t *testing.T) {
	if AddDays("2026-12-31", 1) != "2027-01-01" || AddDays("2026-03-29", 1) != "2026-03-30" {
		t.Fatal("AddDays")
	}
	if DaysBetween("2026-03-28", "2026-03-30") != 2 || DaysBetween("2026-10-30", "2026-10-24") != -6 {
		t.Fatal("DaysBetween")
	}
	if Weekday("2026-10-26") != 1 || Weekday("2026-11-01") != 7 {
		t.Fatal("Weekday")
	}
	if MinutesOf("09:30") != 570 || MinutesOf("25:00") != -1 || HHMM(570) != "09:30" {
		t.Fatal("MinutesOf/HHMM")
	}
}

func openTest(t *testing.T) *Store {
	t.Helper()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s.now = func() time.Time { return time.Date(2026, 11, 2, 8, 0, 0, 0, time.Local) } // lunes
	return s
}

func TestSeriesEditing(t *testing.T) {
	s := openTest(t)
	m, err := s.SaveTask(Task{Title: "Estudio", Date: "2026-11-02", Start: "16:00", Minutes: 60, Repeat: &Repeat{Freq: "weekly", Interval: 1, Weekdays: []int{1, 3, 5}}}, "")
	if err != nil {
		t.Fatal(err)
	}
	week := s.Range("2026-11-02", "2026-11-08")
	if len(week) != 3 {
		t.Fatalf("ocurrencias = %d", len(week))
	}

	// Solo esta: el miércoles a las 18:00
	wed := week[1]
	wed.Start = "18:00"
	if _, err := s.SaveTask(wed, ScopeOne); err != nil {
		t.Fatal(err)
	}
	week = s.Range("2026-11-02", "2026-11-08")
	if week[1].Start != "18:00" || week[1].OccurrenceOf != "" || week[0].Start != "16:00" {
		t.Fatalf("solo esta: %+v", week)
	}

	// Esta y las siguientes: desde el viernes 13, título nuevo
	occ := s.Range("2026-11-13", "2026-11-13")[0]
	occ.Title = "Repaso"
	if _, err := s.SaveTask(occ, ScopeFollowing); err != nil {
		t.Fatal(err)
	}
	if got := s.Range("2026-11-11", "2026-11-11")[0].Title; got != "Estudio" {
		t.Fatalf("antes del corte = %q", got)
	}
	if got := s.Range("2026-11-16", "2026-11-16")[0].Title; got != "Repaso" {
		t.Fatalf("después del corte = %q", got)
	}

	// Borrar solo una
	if err := s.DeleteTasks([]string{OccurrenceID(m.ID, "2026-11-09")}, ScopeOne); err != nil {
		t.Fatal(err)
	}
	if n := len(s.Range("2026-11-09", "2026-11-09")); n != 0 {
		t.Fatalf("borrada sigue: %d", n)
	}

	// Marcar hecha una ocurrencia y comprobar que solo cambia esa
	o := s.Range("2026-11-04", "2026-11-06")
	if err := s.SetDone(o[len(o)-1].ID, true); err != nil {
		t.Fatal(err)
	}
	o = s.Range("2026-11-02", "2026-11-06")
	if !o[len(o)-1].Done || o[0].Done {
		t.Fatalf("hecha: %+v", o)
	}
}

func TestUndoAndPersistence(t *testing.T) {
	s := openTest(t)
	a, _ := s.SaveTask(Task{Title: "A", Date: "2026-11-03"}, "")
	if _, err := s.SaveTasks([]Task{{Title: "B", Date: "2026-11-04"}, {Title: "C", Date: "2026-12-01"}}); err != nil {
		t.Fatal(err)
	}
	if err := s.MoveTasks([]string{a.ID}, 2); err != nil {
		t.Fatal(err)
	}
	if got := s.Range("2026-11-05", "2026-11-05"); len(got) != 1 || got[0].Title != "A" {
		t.Fatalf("mover: %+v", got)
	}
	if ok, err := s.Undo(); !ok || err != nil {
		t.Fatal("deshacer mover", err)
	}
	if got := s.Range("2026-11-03", "2026-11-03"); len(got) != 1 {
		t.Fatal("deshacer no devolvió A a su día")
	}
	if ok, _ := s.Undo(); !ok { // deshace B y C de una vez
		t.Fatal("deshacer lote")
	}
	if n := len(s.Range("2026-11-01", "2026-12-31")); n != 1 {
		t.Fatalf("tras deshacer el lote quedan %d", n)
	}

	// Reabrir desde disco
	s2, err := Open(s.dir)
	if err != nil {
		t.Fatal(err)
	}
	if n := len(s2.Range("2026-11-01", "2026-12-31")); n != 1 {
		t.Fatalf("al reabrir hay %d tareas", n)
	}
}

func TestSessionsUpdateMemory(t *testing.T) {
	s := openTest(t)
	topics, _ := s.SetTopics([]Topic{{Title: "La Constitución"}})
	task, _ := s.SaveTask(Task{Title: "Estudio", Date: "2026-11-02", Kind: KindStudy, TopicID: topics[0].ID}, "")
	if _, err := s.LogSession(Session{TaskID: task.ID, TopicID: topics[0].ID, Date: "2026-11-02", Minutes: 50, Rating: 3}); err != nil {
		t.Fatal(err)
	}
	tp := s.Topics()[0]
	if tp.Studied != "2026-11-02" || tp.Memory.Reps != 1 || FormatDate(tp.Memory.Due) <= "2026-11-02" {
		t.Fatalf("memoria: %+v", tp)
	}
	if !s.Range("2026-11-02", "2026-11-02")[0].Done {
		t.Fatal("la tarea no quedó hecha")
	}
	// Un tema reorganizado conserva su memoria
	tp.Title = "Tema 1 reescrito"
	tp.Memory.Reps = 0
	after, _ := s.SetTopics([]Topic{tp})
	if after[0].Memory.Reps != 1 {
		t.Fatal("SetTopics perdió la memoria")
	}
	if len(s.Sessions("2026-11-01", "2026-11-30")) != 1 {
		t.Fatal("sesiones")
	}
}

func makeTopics(n int) []Topic {
	out := make([]Topic, n)
	for i := range out {
		w := 1.0
		if i%7 == 3 {
			w = 1.5 // algunos temas más largos
		}
		out[i] = Topic{Number: i + 1, Title: fmt.Sprintf("Tema %d", i+1), Weight: w}
	}
	return out
}

func TestPlanner(t *testing.T) {
	for _, tc := range []struct {
		topics int
		exam   string
	}{{25, "2027-03-01"}, {70, "2027-09-15"}, {90, "2027-12-01"}} {
		t.Run(strconv.Itoa(tc.topics), func(t *testing.T) {
			s := openTest(t)
			set := DefaultSettings()
			set.ExamDate = tc.exam
			if err := s.SetSettings(set); err != nil {
				t.Fatal(err)
			}
			// Clase fija los martes de 17:00 a 19:00, dentro de la franja de estudio
			if _, err := s.SaveTask(Task{Title: "Clase", TypeID: "work", Date: "2026-11-03", Start: "17:00", Minutes: 120,
				Repeat: &Repeat{Freq: "weekly", Interval: 1, Weekdays: []int{2}}}, ""); err != nil {
				t.Fatal(err)
			}
			if _, err := s.SetTopics(makeTopics(tc.topics)); err != nil {
				t.Fatal(err)
			}
			rep, err := s.Plan()
			if err != nil {
				t.Fatal(err)
			}
			if rep.Unscheduled != 0 {
				t.Fatalf("no cabe el temario: %+v", rep)
			}
			all := s.Range(s.Today(), tc.exam)
			perDay := map[string]int{}
			reviews := map[string]int{}
			type slot struct{ from, to int }
			slots := map[string][]slot{}
			for _, x := range all {
				if x.Start != "" {
					from := MinutesOf(x.Start)
					slots[x.Date] = append(slots[x.Date], slot{from, from + x.Minutes})
				}
				if !x.Auto {
					continue
				}
				if x.Kind != KindMock {
					perDay[x.Date] += x.Minutes
				}
				if x.Kind == KindReview {
					reviews[x.TopicID]++
				}
				if Weekday(x.Date) == 7 {
					t.Fatalf("planificado en día de descanso: %+v", x)
				}
			}
			for d, m := range perDay {
				if limit := s.capacityFor(Weekday(d)); m > limit {
					t.Fatalf("%s: %d min > capacidad %d", d, m, limit)
				}
			}
			// Nada automático fuera de la franja elegida
			for _, x := range all {
				if !x.Auto {
					continue
				}
				w := set.Windows[strconv.Itoa(Weekday(x.Date))]
				if MinutesOf(x.Start) < MinutesOf(w.Start) || MinutesOf(x.Start)+x.Minutes > MinutesOf(w.End) {
					t.Fatalf("fuera de la franja %s-%s: %s %s %d min %s", w.Start, w.End, x.Date, x.Start, x.Minutes, x.Title)
				}
			}
			for d, list := range slots {
				sort.Slice(list, func(i, j int) bool { return list[i].from < list[j].from })
				for i := 1; i < len(list); i++ {
					if list[i].from < list[i-1].to {
						t.Fatalf("%s: tareas solapadas %v", d, list)
					}
				}
			}
			for _, tp := range s.Topics() {
				if reviews[tp.ID] < 3 {
					t.Fatalf("%s solo tiene %d repasos antes del examen", tp.Title, reviews[tp.ID])
				}
			}
			// Mismo resultado con la misma entrada
			first := summary(all)
			if _, err := s.Plan(); err != nil {
				t.Fatal(err)
			}
			if second := summary(s.Range(s.Today(), tc.exam)); !reflect.DeepEqual(first, second) {
				t.Fatal("el plan cambia sin cambiar la entrada")
			}
		})
	}
}

func TestPlannerWarnsWhenItDoesNotFit(t *testing.T) {
	s := openTest(t)
	set := DefaultSettings()
	set.ExamDate = "2026-12-15"
	s.SetSettings(set)
	s.SetTopics(makeTopics(80))
	rep, err := s.Plan()
	if err != nil {
		t.Fatal(err)
	}
	if rep.Unscheduled == 0 || rep.Shortfall == 0 || rep.ExtraPerDay == 0 || len(rep.Warnings) == 0 {
		t.Fatalf("debería avisar: %+v", rep)
	}
}

func TestPlannerKeepsManualAndPinned(t *testing.T) {
	s := openTest(t)
	set := DefaultSettings()
	set.ExamDate = "2027-02-01"
	s.SetSettings(set)
	s.SetTopics(makeTopics(10))
	if _, err := s.Plan(); err != nil {
		t.Fatal(err)
	}
	day := s.Range("2026-11-04", "2026-11-04")
	if len(day) == 0 {
		t.Fatal("sin plan el miércoles")
	}
	// Mover a mano una tarea automática la fija
	if err := s.MoveTasks([]string{day[0].ID}, 1); err != nil {
		t.Fatal(err)
	}
	moved := day[0].ID
	if _, err := s.Plan(); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, x := range s.Range("2026-11-05", "2026-11-05") {
		if x.ID == moved && x.Pinned {
			found = true
		}
	}
	if !found {
		t.Fatal("el planificador borró una tarea movida a mano")
	}
}

func summary(list []Task) []string {
	var out []string
	for _, x := range list {
		out = append(out, x.Date+" "+x.Start+" "+x.Title)
	}
	sort.Strings(out)
	return out
}

func TestPlannerSkipsRestDates(t *testing.T) {
	s := openTest(t)
	set := DefaultSettings()
	set.ExamDate = "2027-02-01"
	s.SetSettings(set)
	s.SetTopics(makeTopics(10))
	if _, err := s.SaveTask(Task{Title: "Descanso", Date: "2026-11-04", Kind: KindRest}, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Plan(); err != nil {
		t.Fatal(err)
	}
	for _, x := range s.Range("2026-11-04", "2026-11-04") {
		if x.Auto {
			t.Fatalf("plan en un día de descanso: %+v", x)
		}
	}
}
