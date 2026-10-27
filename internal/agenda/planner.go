package agenda

import (
	"fmt"
	"math"
	"slices"
	"sort"
	"strconv"

	fsrs "github.com/open-spaced-repetition/go-fsrs/v3"
)

// PlanReport resume lo que ha hecho el planificador y si el temario cabe.
type PlanReport struct {
	Created     int      `json:"created"`
	Reviews     int      `json:"reviews"`
	Studies     int      `json:"studies"`
	Mocks       int      `json:"mocks"`
	Horizon     string   `json:"horizon"`
	FinishDate  string   `json:"finishDate"`  // último día con estudio nuevo planificado
	Unscheduled int      `json:"unscheduled"` // temas que no caben antes de la fase final
	Shortfall   int      `json:"shortfall"`   // minutos que faltan
	ExtraPerDay int      `json:"extraPerDay"` // minutos diarios extra para que quepa
	Warnings    []string `json:"warnings"`
}

// interval es un hueco ocupado del día, en minutos desde medianoche.
type interval struct{ from, to int }

// dayAlloc reparte el tiempo de un día: respeta lo ocupado, la franja elegida,
// los descansos entre bloques y el máximo de minutos de estudio.
type dayAlloc struct {
	busy   []interval
	cursor int
	end    int
	budget int
	brk    int
}

// room es el bloque más largo que se puede colocar desde el cursor (en
// cualquier hueco libre de la franja, no solo en el inmediato).
func (a *dayAlloc) room() int {
	best := 0
	at := a.cursor
	for at < a.end {
		at = freeSlot(a.busy, at, 1)
		if at >= a.end {
			break
		}
		limit := a.end
		for _, iv := range a.busy {
			if iv.from >= at && iv.from < limit {
				limit = iv.from
			}
		}
		best = max(best, limit-at)
		at = limit
	}
	return max(0, min(best, a.budget))
}

// place reserva n minutos y devuelve la hora de inicio.
func (a *dayAlloc) place(n int) (int, bool) {
	if n <= 0 || n > a.budget {
		return 0, false
	}
	at := freeSlot(a.busy, a.cursor, n)
	if at+n > a.end {
		return 0, false
	}
	a.busy = append(a.busy, interval{at, at + n})
	a.cursor = at + n + a.brk
	a.budget -= n
	return at, true
}

// Plan rehace las tareas automáticas desde hoy. Respeta las tareas manuales,
// las fijadas (Pinned) y las ya hechas, y nunca supera la capacidad de un día
// ni se sale de su franja.
func (s *Store) Plan() (PlanReport, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.checkpoint()
	rep, months := s.planLocked(s.Today())
	return rep, s.writeMonths(months)
}

func (s *Store) typeFor(kind string) string {
	for _, ty := range s.types {
		if ty.ID == kind {
			return ty.ID
		}
	}
	for _, ty := range s.types {
		if ty.CountsAsStudy {
			return ty.ID
		}
	}
	return s.types[0].ID
}

func (s *Store) planLocked(today string) (PlanReport, map[string]bool) {
	set := s.settings
	months := map[string]bool{}
	rep := PlanReport{}

	// 1. Fuera lo automático pendiente: se vuelve a calcular entero.
	for id, t := range s.tasks {
		if t.Auto && !t.Pinned && !t.Done {
			months[monthOf(t.Date)] = true
			delete(s.tasks, id)
		}
	}

	horizon := AddDays(today, 120)
	finalFrom := ""
	if set.ExamDate != "" && set.ExamDate > today {
		horizon = AddDays(set.ExamDate, -1) // el día del examen no se estudia
		finalFrom = AddDays(set.ExamDate, -max(0, set.FinalPhaseDays))
	}
	rep.Horizon = horizon

	// Ocupación por día: tareas manuales, fijadas y hechas.
	busy := map[string][]interval{}
	studyDone := map[string]int{} // minutos de estudio que ya ocupan tareas manuales
	studyTypes := map[string]bool{}
	for _, ty := range s.types {
		if ty.CountsAsStudy {
			studyTypes[ty.ID] = true
		}
	}
	restDates := map[string]bool{}
	// Los eventos de los círculos (citas, quedadas…) también ocupan su hueco
	if s.external != nil {
		for _, o := range s.external(today, horizon) {
			if o.Start != "" {
				from := MinutesOf(o.Start)
				busy[o.Date] = append(busy[o.Date], interval{from, from + max(o.Minutes, 15)})
			}
		}
	}
	for _, t := range s.tasks {
		for _, o := range occurrences(t, today, horizon) {
			if o.Kind == KindRest {
				restDates[o.Date] = true
				continue
			}
			if o.Start != "" {
				from := MinutesOf(o.Start)
				busy[o.Date] = append(busy[o.Date], interval{from, from + max(o.Minutes, 15)})
			}
			if studyTypes[o.TypeID] {
				studyDone[o.Date] += o.Minutes
			}
		}
	}

	f := s.fsrs()
	// Copia de trabajo del temario: el plan simula cada repaso como «Bien».
	topics := make([]*Topic, 0, len(s.topics))
	for i := range s.topics {
		if !s.topics[i].Archived {
			c := s.topics[i]
			topics = append(topics, &c)
		}
	}
	sort.SliceStable(topics, func(i, j int) bool { return topics[i].Number < topics[j].Number })
	due := map[*Topic]string{}
	var pending []*Topic // temas sin estudiar, en orden del temario
	for _, t := range topics {
		if t.Memory.State == fsrs.New {
			pending = append(pending, t)
			continue
		}
		due[t] = max(today, FormatDate(t.Memory.Due))
	}
	reviewsPlanned := map[*Topic]int{}
	carry, carryPart := 0, 0 // minutos y parte del tema nuevo que quedó a medias

	studyMin := func(t *Topic) int {
		m := t.StudyMinutes
		if m <= 0 {
			m = set.BlockMinutes
		}
		return roundTo5(float64(m) * math.Max(t.Weight, 0.25))
	}
	reviewMin := func(t *Topic) int { return roundTo5(float64(set.ReviewMinutes) * math.Max(t.Weight, 0.5)) }
	minChunk := min(set.BlockMinutes, 25)

	for d := today; d <= horizon; d = AddDays(d, 1) {
		wd := Weekday(d)
		if slices.Contains(set.RestDays, wd) || restDates[d] {
			continue
		}
		alloc := s.dayAllocFor(d, busy[d], studyDone[d])
		if alloc.room() < min(set.ReviewMinutes, minChunk) {
			continue
		}
		final := finalFrom != "" && d >= finalFrom
		when, _ := ParseDate(d)
		used := map[*Topic]bool{}
		weakestFirst := func(list []*Topic) {
			sort.SliceStable(list, func(i, j int) bool {
				ri, rj := f.GetRetrievability(list[i].Memory, when), f.GetRetrievability(list[j].Memory, when)
				if ri != rj {
					return ri < rj
				}
				return list[i].Number < list[j].Number
			})
		}
		review := func(t *Topic) bool {
			at, ok := alloc.place(reviewMin(t))
			if !ok {
				return false
			}
			s.addAuto(d, at, reviewMin(t), KindReview, t, 0, 0, months, &rep)
			t.Memory = f.Next(t.Memory, when, fsrs.Good).Card
			due[t] = max(AddDays(d, 1), FormatDate(t.Memory.Due))
			reviewsPlanned[t]++
			used[t] = true
			return true
		}

		// Fase final: un simulacro el sábado, antes que nada.
		if final && wd == 6 {
			if n := min(alloc.room(), 180); n >= 120 {
				if at, ok := alloc.place(n); ok {
					s.addAuto(d, at, n, KindMock, nil, 0, 0, months, &rep)
				}
			}
		}

		// 2. Repasos que tocan, los más olvidados primero. Lo que no cabe pasa al día siguiente.
		var queue []*Topic
		for t, dd := range due {
			if dd <= d {
				queue = append(queue, t)
			}
		}
		weakestFirst(queue)

		// 3. Intercalar: estudio nuevo (con la cabeza fresca), repaso, estudio, repaso…
		studyOpen := !final
		tryStudy := func() bool {
			if !studyOpen || (carry == 0 && len(pending) == 0) {
				return false
			}
			t := pending[0]
			need := carry
			if need == 0 {
				need = studyMin(t)
				carryPart = 0
			}
			take := min(need, alloc.room())
			if need-take > 0 && need-take < 15 {
				take = need // no dejar restos ridículos para otro día
			}
			at, ok := 0, false
			if take >= min(need, minChunk) {
				at, ok = alloc.place(take)
			}
			if !ok {
				studyOpen = false
				return false
			}
			carryPart++
			parts := 0
			if carryPart > 1 || take < need {
				parts = max(2, carryPart)
			}
			s.addAuto(d, at, take, KindStudy, t, carryPart, parts, months, &rep)
			used[t] = true
			carry = need - take
			if carry > 0 {
				studyOpen = false // el resto del tema, otro día
				return true
			}
			// Tema completo: el primer repaso lo decide FSRS como si saliera «Bien»
			t.Memory = f.Next(t.Memory, when, fsrs.Good).Card
			due[t] = max(AddDays(d, 1), FormatDate(t.Memory.Due))
			pending = pending[1:]
			rep.FinishDate = d
			return true
		}
		tryReview := func() bool {
			for len(queue) > 0 {
				t := queue[0]
				queue = queue[1:]
				if !used[t] && review(t) {
					return true
				}
			}
			return false
		}
		studyTurn := true
		for i := 0; i < 500; i++ {
			first, second := tryReview, tryStudy
			if studyTurn {
				first, second = tryStudy, tryReview
			}
			if !first() && !second() {
				break
			}
			studyTurn = !studyTurn
		}

		// 4. Fase final: repasos extra de los temas más flojos, aunque no toquen.
		if final {
			var extra []*Topic
			for t := range due {
				if !used[t] {
					extra = append(extra, t)
				}
			}
			weakestFirst(extra)
			for _, t := range extra {
				if alloc.room() < reviewMin(t) {
					break
				}
				review(t)
			}
		}
	}

	// 5. ¿Cabe el temario?
	if len(pending) > 0 {
		rep.Unscheduled = len(pending)
		for i, t := range pending {
			if i == 0 && carry > 0 {
				rep.Shortfall += carry
			} else {
				rep.Shortfall += studyMin(t)
			}
		}
		end := horizon
		if finalFrom != "" {
			end = finalFrom
		}
		days := 0
		for d := today; d < end; d = AddDays(d, 1) {
			if !slices.Contains(set.RestDays, Weekday(d)) {
				days++
			}
		}
		if days > 0 {
			rep.ExtraPerDay = roundTo5(float64(rep.Shortfall)/float64(days)) + 5
		}
		if set.ExamDate != "" {
			rep.Warnings = append(rep.Warnings, fmt.Sprintf(
				"Con el tiempo de estudio actual faltan %s para terminar el temario antes de la fase final de repaso. Añade unos %d min al día, acorta la fase final o revisa el peso de los temas.",
				humanMinutes(rep.Shortfall), rep.ExtraPerDay))
		}
	}
	if set.ExamDate != "" && set.MinReviews > 0 {
		low := 0
		for _, t := range topics {
			if t.Memory.State != fsrs.New && reviewsPlanned[t] < set.MinReviews {
				low++
			}
		}
		if low > 0 {
			rep.Warnings = append(rep.Warnings, fmt.Sprintf("%d %s menos de %d repasos antes del examen.", low, plural(low, "tema tendrá", "temas tendrán"), set.MinReviews))
		}
	}
	if len(topics) == 0 {
		rep.Warnings = append(rep.Warnings, "Añade el temario para que el plan reparta el estudio y los repasos.")
	}
	return rep, months
}

// dayAllocFor prepara el reparto de un día según el modo de capacidad elegido.
func (s *Store) dayAllocFor(date string, busy []interval, studyDone int) *dayAlloc {
	set := s.settings
	key := strconv.Itoa(Weekday(date))
	start, end := 16*60, max(MinutesOf(set.DayEnd), 20*60)
	w, hasWindow := set.Windows[key]
	if hasWindow && MinutesOf(w.Start) >= 0 {
		start = MinutesOf(w.Start)
		if set.CapacityMode != "hours" && MinutesOf(w.End) > start {
			end = MinutesOf(w.End)
		}
	}
	budget := set.Capacity[key]
	if set.CapacityMode == "window" || (set.CapacityMode != "hours" && budget == 0 && hasWindow) {
		budget = end - start
	}
	if date == s.Today() {
		now := s.now()
		start = max(start, roundUp(now.Hour()*60+now.Minute(), 15))
	}
	return &dayAlloc{busy: slices.Clone(busy), cursor: start, end: end, budget: max(0, budget-studyDone), brk: set.BreakMinutes}
}

// capacityFor son los minutos de estudio de ese día de la semana según el modo elegido.
func (s *Store) capacityFor(wd int) int {
	set := s.settings
	key := strconv.Itoa(wd)
	hours := set.Capacity[key]
	w, ok := set.Windows[key]
	win := 0
	if ok {
		win = max(0, MinutesOf(w.End)-MinutesOf(w.Start))
	}
	switch set.CapacityMode {
	case "window":
		return win
	case "hours":
		return hours
	default:
		if !ok || win == 0 {
			return hours
		}
		return min(hours, win)
	}
}

// addAuto crea una tarea del plan.
func (s *Store) addAuto(date string, at, minutes int, kind string, topic *Topic, part, parts int, months map[string]bool, rep *PlanReport) {
	t := Task{ID: newID(), Date: date, Start: HHMM(at), Minutes: minutes, Kind: kind, Auto: true, Updated: s.now()}
	switch kind {
	case KindStudy:
		t.TypeID = s.typeFor("study")
		t.Title = "Estudio · " + topicLabel(topic)
		if parts > 1 {
			t.Title += fmt.Sprintf(" (parte %d)", part)
		}
		rep.Studies++
	case KindReview:
		t.TypeID = s.typeFor("review")
		t.Title = "Repaso · " + topicLabel(topic)
		rep.Reviews++
	case KindMock:
		t.TypeID = s.typeFor("mock")
		t.Title = "Simulacro de examen"
		rep.Mocks++
	}
	if topic != nil {
		t.TopicID, t.DocID = topic.ID, topic.DocID
	}
	s.tasks[t.ID] = &t
	months[monthOf(date)] = true
	rep.Created++
}

// freeSlot devuelve el primer minuto desde from donde caben n minutos sin pisar nada.
func freeSlot(busy []interval, from, n int) int {
	at := from
	for moved := true; moved; {
		moved = false
		for _, iv := range busy {
			if at < iv.to && at+n > iv.from {
				at = iv.to
				moved = true
			}
		}
	}
	return at
}

func topicLabel(t *Topic) string {
	if t == nil {
		return ""
	}
	if t.Number > 0 {
		return fmt.Sprintf("Tema %d. %s", t.Number, t.Title)
	}
	return t.Title
}

func roundTo5(x float64) int  { return max(5, int(math.Round(x/5))*5) }
func roundUp(x, step int) int { return (x + step - 1) / step * step }

func humanMinutes(m int) string {
	h, mm := m/60, m%60
	switch {
	case h == 0:
		return fmt.Sprintf("%d min", mm)
	case mm == 0:
		return fmt.Sprintf("%d h", h)
	}
	return fmt.Sprintf("%d h %d min", h, mm)
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}
