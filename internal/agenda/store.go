package agenda

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	fsrs "github.com/open-spaced-repetition/go-fsrs/v3"

	"folio/internal/fsutil"
)

var ErrNotFound = errors.New("tarea no encontrada")

const undoDepth = 50

// Store guarda la agenda en ‹espacio de trabajo›/agenda (o la carpeta que se
// indique): JSON legibles, partidos por meses y escritos de forma atómica.
type Store struct {
	mu        sync.Mutex
	dir       string
	types     []TaskType
	settings  PlanSettings
	topics    []Topic
	templates []WeekTemplate
	tasks     map[string]*Task
	sessions  []Session
	undo      []snapshot
	now       func() time.Time             // reemplazable en los tests
	external  func(from, to string) []Task // eventos de los círculos (solo lectura aquí)
}

type snapshot struct {
	tasks    map[string]*Task
	topics   []Topic
	sessions []Session
}

// Open abre (o crea) la agenda en dir.
func Open(dir string) (*Store, error) {
	s := &Store{dir: dir, tasks: map[string]*Task{}, now: time.Now}
	for _, d := range []string{dir, s.tasksDir(), s.sessionsDir()} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return nil, err
		}
	}
	s.types = DefaultTypes()
	_ = fsutil.ReadJSON(s.path("types.json"), &s.types)
	s.settings = DefaultSettings()
	_ = fsutil.ReadJSON(s.path("settings.json"), &s.settings)
	_ = fsutil.ReadJSON(s.path("topics.json"), &s.topics)
	_ = fsutil.ReadJSON(s.path("templates.json"), &s.templates)

	files, _ := filepath.Glob(filepath.Join(s.tasksDir(), "*.json"))
	for _, f := range files {
		var list []Task
		if err := fsutil.ReadJSON(f, &list); err != nil {
			continue // un mes dañado no impide abrir el resto
		}
		for i := range list {
			t := list[i]
			s.tasks[t.ID] = &t
		}
	}
	files, _ = filepath.Glob(filepath.Join(s.sessionsDir(), "*.jsonl"))
	sort.Strings(files)
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(bytes.NewReader(b))
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			var se Session
			if json.Unmarshal(sc.Bytes(), &se) == nil && se.ID != "" {
				s.sessions = append(s.sessions, se)
			}
		}
	}
	return s, nil
}

func (s *Store) path(name string) string { return filepath.Join(s.dir, name) }
func (s *Store) tasksDir() string        { return filepath.Join(s.dir, "tasks") }
func (s *Store) sessionsDir() string     { return filepath.Join(s.dir, "sessions") }

// Today es el día local actual.
func (s *Store) Today() string { return FormatDate(s.now()) }

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ---------- Persistencia ----------

// writeMonths reescribe los archivos de tareas de los meses indicados.
func (s *Store) writeMonths(months map[string]bool) error {
	byMonth := map[string][]Task{}
	for _, t := range s.tasks {
		if m := monthOf(t.Date); months[m] {
			byMonth[m] = append(byMonth[m], *t)
		}
	}
	for m := range months {
		p := filepath.Join(s.tasksDir(), m+".json")
		list := byMonth[m]
		if len(list) == 0 {
			_ = os.Remove(p)
			continue
		}
		sort.Slice(list, func(i, j int) bool {
			if list[i].Date != list[j].Date {
				return list[i].Date < list[j].Date
			}
			if list[i].Start != list[j].Start {
				return list[i].Start < list[j].Start
			}
			return list[i].ID < list[j].ID
		})
		if err := fsutil.WriteJSON(p, list); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) writeSessions(months map[string]bool) error {
	byMonth := map[string][]Session{}
	for _, se := range s.sessions {
		if m := monthOf(se.Date); months[m] {
			byMonth[m] = append(byMonth[m], se)
		}
	}
	for m := range months {
		p := filepath.Join(s.sessionsDir(), m+".jsonl")
		list := byMonth[m]
		if len(list) == 0 {
			_ = os.Remove(p)
			continue
		}
		var b bytes.Buffer
		for _, se := range list {
			line, _ := json.Marshal(se)
			b.Write(line)
			b.WriteByte('\n')
		}
		if err := fsutil.WriteFileAtomic(p, b.Bytes()); err != nil {
			return err
		}
	}
	return nil
}

func monthOf(date string) string {
	if len(date) >= 7 {
		return date[:7]
	}
	return "sin-fecha"
}

// checkpoint guarda el estado para poder deshacer la operación que sigue.
func (s *Store) checkpoint() {
	snap := snapshot{tasks: make(map[string]*Task, len(s.tasks)), topics: slices.Clone(s.topics), sessions: slices.Clone(s.sessions)}
	for k, v := range s.tasks {
		c := cloneTask(*v)
		snap.tasks[k] = &c
	}
	s.undo = append(s.undo, snap)
	if len(s.undo) > undoDepth {
		s.undo = s.undo[len(s.undo)-undoDepth:]
	}
}

func cloneTask(t Task) Task {
	if t.Repeat != nil {
		r := *t.Repeat
		r.Weekdays = slices.Clone(r.Weekdays)
		r.Except = slices.Clone(r.Except)
		r.Done = slices.Clone(r.Done)
		t.Repeat = &r
	}
	if t.Remind != nil {
		v := *t.Remind
		t.Remind = &v
	}
	return t
}

// Undo deshace la última operación sobre tareas, temario o sesiones.
func (s *Store) Undo() (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.undo) == 0 {
		return false, nil
	}
	snap := s.undo[len(s.undo)-1]
	s.undo = s.undo[:len(s.undo)-1]
	months := map[string]bool{}
	for _, t := range s.tasks {
		months[monthOf(t.Date)] = true
	}
	for _, t := range snap.tasks {
		months[monthOf(t.Date)] = true
	}
	sessMonths := map[string]bool{}
	for _, se := range s.sessions {
		sessMonths[monthOf(se.Date)] = true
	}
	for _, se := range snap.sessions {
		sessMonths[monthOf(se.Date)] = true
	}
	files := map[string][]TopicFile{}
	for _, t := range s.topics {
		files[t.ID] = t.Files
	}
	s.tasks, s.topics, s.sessions = snap.tasks, snap.topics, snap.sessions
	// Los apuntes adjuntos no forman parte de deshacer: siguen como están en disco
	for i := range s.topics {
		s.topics[i].Files = files[s.topics[i].ID]
	}
	if err := s.writeMonths(months); err != nil {
		return true, err
	}
	if err := s.writeSessions(sessMonths); err != nil {
		return true, err
	}
	return true, fsutil.WriteJSON(s.path("topics.json"), s.topics)
}

// ---------- Lectura ----------

// Range devuelve las tareas (con las series ya expandidas) entre from y to.
func (s *Store) Range(from, to string) []Task {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []Task
	for _, t := range s.tasks {
		out = append(out, occurrences(t, from, to)...)
	}
	if s.external != nil {
		out = append(out, s.external(from, to)...)
	}
	s.sortTasks(out)
	return out
}

// SetExternal añade a la agenda los eventos de los círculos: se ven en Range y
// el plan de estudio los respeta como tiempo ocupado.
func (s *Store) SetExternal(fn func(from, to string) []Task) {
	s.mu.Lock()
	s.external = fn
	s.mu.Unlock()
}

func (s *Store) priority(typeID string) int {
	for _, ty := range s.types {
		if ty.ID == typeID {
			return ty.Priority
		}
	}
	return 99
}

func (s *Store) sortTasks(list []Task) {
	sort.SliceStable(list, func(i, j int) bool {
		a, b := list[i], list[j]
		if a.Date != b.Date {
			return a.Date < b.Date
		}
		if (a.Start == "") != (b.Start == "") {
			return a.Start == "" // las de día completo, primero
		}
		if a.Start != b.Start {
			return a.Start < b.Start
		}
		if pa, pb := s.priority(a.TypeID), s.priority(b.TypeID); pa != pb {
			return pa < pb
		}
		return a.ID < b.ID
	})
}

// ---------- Escritura de tareas ----------

func (s *Store) normalize(t *Task) error {
	t.Title = strings.TrimSpace(t.Title)
	if t.Title == "" {
		return errors.New("la tarea necesita un título")
	}
	if _, err := ParseDate(t.Date); err != nil {
		return err
	}
	if t.Start != "" && MinutesOf(t.Start) < 0 {
		return errors.New("hora no válida: " + t.Start)
	}
	if t.TypeID == "" && len(s.types) > 0 {
		t.TypeID = s.types[len(s.types)-1].ID
	}
	if t.Minutes < 0 {
		t.Minutes = 0
	}
	if r := t.Repeat; r != nil {
		if r.Interval < 1 {
			r.Interval = 1
		}
		if !slices.Contains([]string{"daily", "weekly", "monthly"}, r.Freq) {
			return errors.New("repetición no válida")
		}
		if r.Until != "" && r.Until < t.Date {
			return errors.New("la repetición termina antes de empezar")
		}
	}
	t.Updated = s.now()
	t.OccurrenceOf = ""
	return nil
}

// SaveTask crea o actualiza una tarea. Si id es una ocurrencia («serie@fecha»),
// scope decide si el cambio afecta solo a ella, a ella y las siguientes o a toda la serie.
func (s *Store) SaveTask(t Task, scope string) (Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.checkpoint()
	months := map[string]bool{}
	saved, err := s.saveLocked(t, scope, months)
	if err != nil {
		s.undo = s.undo[:len(s.undo)-1]
		return Task{}, err
	}
	return saved, s.writeMonths(months)
}

// SaveTasks crea o actualiza varias tareas de una vez (un solo «deshacer»).
func (s *Store) SaveTasks(list []Task) ([]Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.checkpoint()
	months := map[string]bool{}
	out := make([]Task, 0, len(list))
	for _, t := range list {
		saved, err := s.saveLocked(t, ScopeOne, months)
		if err != nil {
			s.restoreLast()
			return nil, err
		}
		out = append(out, saved)
	}
	return out, s.writeMonths(months)
}

// restoreLast vuelve al último punto de control sin escribir (error a medias).
func (s *Store) restoreLast() {
	snap := s.undo[len(s.undo)-1]
	s.undo = s.undo[:len(s.undo)-1]
	s.tasks, s.topics, s.sessions = snap.tasks, snap.topics, snap.sessions
}

func (s *Store) put(t Task, months map[string]bool) {
	if old, ok := s.tasks[t.ID]; ok {
		months[monthOf(old.Date)] = true
	}
	c := t
	s.tasks[t.ID] = &c
	months[monthOf(t.Date)] = true
}

func (s *Store) remove(id string, months map[string]bool) {
	if old, ok := s.tasks[id]; ok {
		months[monthOf(old.Date)] = true
		delete(s.tasks, id)
	}
}

func (s *Store) saveLocked(t Task, scope string, months map[string]bool) (Task, error) {
	seriesID, occDate := SplitOccurrenceID(t.ID)
	if occDate == "" {
		if t.ID == "" {
			t.ID = newID()
		} else if _, ok := s.tasks[t.ID]; !ok {
			return Task{}, ErrNotFound
		}
		if err := s.normalize(&t); err != nil {
			return Task{}, err
		}
		if old, ok := s.tasks[t.ID]; ok && old.Repeat != nil && t.Repeat != nil {
			// Conserva lo que no viaja por la interfaz
			t.Repeat.Done = old.Repeat.Done
		}
		s.put(t, months)
		return t, nil
	}

	master, ok := s.tasks[seriesID]
	if !ok || master.Repeat == nil {
		return Task{}, ErrNotFound
	}
	switch scope {
	case ScopeAll:
		// Mover una ocurrencia mueve la serie entera los mismos días
		shift := DaysBetween(occDate, t.Date)
		m := cloneTask(*master)
		m.Title, m.TypeID, m.Start, m.Minutes, m.Notes = t.Title, t.TypeID, t.Start, t.Minutes, t.Notes
		m.TopicID, m.Kind, m.DocID, m.Pinned, m.Remind = t.TopicID, t.Kind, t.DocID, t.Pinned, t.Remind
		if t.Repeat != nil {
			done := m.Repeat.Done
			m.Repeat = t.Repeat
			m.Repeat.Done = done
		}
		m.Date = AddDays(m.Date, shift)
		if err := s.normalize(&m); err != nil {
			return Task{}, err
		}
		s.put(m, months)
		return m, nil
	case ScopeFollowing:
		if occDate == master.Date {
			return s.saveLocked(Task{ID: OccurrenceID(seriesID, occDate), Title: t.Title, TypeID: t.TypeID, Date: t.Date, Start: t.Start,
				Minutes: t.Minutes, Notes: t.Notes, Repeat: t.Repeat, TopicID: t.TopicID, Kind: t.Kind, DocID: t.DocID, Pinned: t.Pinned, Remind: t.Remind}, ScopeAll, months)
		}
		old := cloneTask(*master)
		old.Repeat.Until = AddDays(occDate, -1)
		s.put(old, months)
		n := t
		n.ID = newID()
		n.SeriesID = ""
		if n.Repeat == nil {
			r := cloneTask(*master).Repeat
			n.Repeat = r
		}
		n.Repeat.Except = filterFrom(n.Repeat.Except, occDate)
		n.Repeat.Done = filterFrom(master.Repeat.Done, occDate)
		if err := s.normalize(&n); err != nil {
			return Task{}, err
		}
		s.put(n, months)
		return n, nil
	default: // solo esta: se separa de la serie
		m := cloneTask(*master)
		m.Repeat.Except = appendUnique(m.Repeat.Except, occDate)
		s.put(m, months)
		n := t
		n.ID = newID()
		n.SeriesID = seriesID
		n.Repeat = nil
		n.Done = t.Done || slices.Contains(master.Repeat.Done, occDate)
		if err := s.normalize(&n); err != nil {
			return Task{}, err
		}
		s.put(n, months)
		return n, nil
	}
}

func filterFrom(dates []string, from string) []string {
	var out []string
	for _, d := range dates {
		if d >= from {
			out = append(out, d)
		}
	}
	return out
}

func appendUnique(list []string, v string) []string {
	if slices.Contains(list, v) {
		return list
	}
	return append(list, v)
}

// DeleteTasks borra tareas u ocurrencias (scope como en SaveTask).
func (s *Store) DeleteTasks(ids []string, scope string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.checkpoint()
	months := map[string]bool{}
	for _, id := range ids {
		seriesID, occDate := SplitOccurrenceID(id)
		master, ok := s.tasks[seriesID]
		if !ok {
			continue
		}
		if occDate == "" || master.Repeat == nil {
			s.remove(id, months)
			continue
		}
		switch {
		case scope == ScopeAll || (scope == ScopeFollowing && occDate <= master.Date):
			s.remove(seriesID, months)
			for _, t := range s.tasks {
				if t.SeriesID == seriesID {
					s.remove(t.ID, months)
				}
			}
		case scope == ScopeFollowing:
			m := cloneTask(*master)
			m.Repeat.Until = AddDays(occDate, -1)
			s.put(m, months)
		default:
			m := cloneTask(*master)
			m.Repeat.Except = appendUnique(m.Repeat.Except, occDate)
			s.put(m, months)
		}
	}
	return s.writeMonths(months)
}

// MoveTasks desplaza tareas n días (las ocurrencias se separan de su serie).
func (s *Store) MoveTasks(ids []string, days int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.checkpoint()
	months := map[string]bool{}
	for _, id := range ids {
		seriesID, occDate := SplitOccurrenceID(id)
		master, ok := s.tasks[seriesID]
		if !ok {
			continue
		}
		if occDate == "" {
			t := cloneTask(*master)
			t.Date = AddDays(t.Date, days)
			if t.Repeat != nil && t.Repeat.Until != "" {
				t.Repeat.Until = AddDays(t.Repeat.Until, days)
			}
			t.Updated = s.now()
			if t.Auto {
				t.Pinned = true // movida a mano: el planificador la respeta
			}
			s.put(t, months)
			continue
		}
		o := cloneTask(*master)
		o.ID, o.Date, o.Repeat = OccurrenceID(seriesID, AddDays(occDate, days)), AddDays(occDate, days), nil
		if _, err := s.saveLocked(Task{ID: OccurrenceID(seriesID, occDate), Title: o.Title, TypeID: o.TypeID, Date: o.Date, Start: o.Start,
			Minutes: o.Minutes, Notes: o.Notes, TopicID: o.TopicID, Kind: o.Kind, DocID: o.DocID}, ScopeOne, months); err != nil {
			s.restoreLast()
			return err
		}
	}
	return s.writeMonths(months)
}

// SetDone marca una tarea u ocurrencia como hecha o pendiente.
func (s *Store) SetDone(id string, done bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.checkpoint()
	months := map[string]bool{}
	if err := s.setDoneLocked(id, done, months); err != nil {
		s.undo = s.undo[:len(s.undo)-1]
		return err
	}
	return s.writeMonths(months)
}

func (s *Store) setDoneLocked(id string, done bool, months map[string]bool) error {
	seriesID, occDate := SplitOccurrenceID(id)
	master, ok := s.tasks[seriesID]
	if !ok {
		return ErrNotFound
	}
	t := cloneTask(*master)
	if occDate != "" && t.Repeat != nil {
		t.Repeat.Done = slices.DeleteFunc(t.Repeat.Done, func(d string) bool { return d == occDate })
		if done {
			t.Repeat.Done = append(t.Repeat.Done, occDate)
		}
	} else {
		t.Done = done
	}
	t.Updated = s.now()
	s.put(t, months)
	return nil
}

// ---------- Tipos, ajustes, semanas tipo ----------

func (s *Store) Types() []TaskType {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.types)
}

func (s *Store) SetTypes(list []TaskType) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(list) == 0 {
		return errors.New("tiene que haber al menos un tipo")
	}
	for i := range list {
		if list[i].ID == "" {
			list[i].ID = newID()
		}
		if strings.TrimSpace(list[i].Name) == "" {
			return errors.New("todos los tipos necesitan un nombre")
		}
	}
	sort.SliceStable(list, func(i, j int) bool { return list[i].Priority < list[j].Priority })
	s.types = list
	return fsutil.WriteJSON(s.path("types.json"), list)
}

func (s *Store) Settings() PlanSettings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.settings
}

func (s *Store) SetSettings(p PlanSettings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	d := DefaultSettings()
	if p.BlockMinutes <= 0 {
		p.BlockMinutes = d.BlockMinutes
	}
	if p.ReviewMinutes <= 0 {
		p.ReviewMinutes = d.ReviewMinutes
	}
	if p.Retention < 0.7 || p.Retention > 0.97 {
		p.Retention = d.Retention
	}
	if p.Capacity == nil {
		p.Capacity = d.Capacity
	}
	if p.Windows == nil {
		p.Windows = d.Windows
	}
	if p.CapacityMode == "" {
		p.CapacityMode = d.CapacityMode
	}
	s.settings = p
	return fsutil.WriteJSON(s.path("settings.json"), p)
}

func (s *Store) Templates() []WeekTemplate {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.templates)
}

func (s *Store) SetTemplates(list []WeekTemplate) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range list {
		if list[i].ID == "" {
			list[i].ID = newID()
		}
	}
	s.templates = list
	return fsutil.WriteJSON(s.path("templates.json"), list)
}

// ApplyTemplate crea las tareas de una semana tipo en cada semana que empieza
// en los lunes indicados.
func (s *Store) ApplyTemplate(id string, mondays []string) ([]Task, error) {
	s.mu.Lock()
	var tpl *WeekTemplate
	for i := range s.templates {
		if s.templates[i].ID == id {
			tpl = &s.templates[i]
		}
	}
	s.mu.Unlock()
	if tpl == nil {
		return nil, errors.New("semana tipo no encontrada")
	}
	var list []Task
	for _, mon := range mondays {
		mon = AddDays(mon, 1-Weekday(mon))
		for _, tt := range tpl.Tasks {
			list = append(list, Task{Title: tt.Title, TypeID: tt.TypeID, Date: AddDays(mon, tt.Weekday-1), Start: tt.Start, Minutes: tt.Minutes, Notes: tt.Notes})
		}
	}
	return s.SaveTasks(list)
}

// ---------- Temario ----------

func (s *Store) Topics() []Topic {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.topics)
}

// SetTopics reemplaza el temario. Los temas que ya existían (mismo ID)
// conservan su estado de memoria aunque la interfaz no lo envíe completo.
func (s *Store) SetTopics(list []Topic) ([]Topic, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.checkpoint()
	old := map[string]Topic{}
	for _, t := range s.topics {
		old[t.ID] = t
	}
	for i := range list {
		t := &list[i]
		t.Title = strings.TrimSpace(t.Title)
		if t.ID == "" {
			t.ID = newID()
			t.Memory = fsrs.NewCard()
		} else if o, ok := old[t.ID]; ok {
			t.Memory, t.Studied, t.Files = o.Memory, o.Studied, o.Files
			delete(old, t.ID)
		}
		if t.Weight <= 0 {
			t.Weight = 1
		}
		if t.Number == 0 {
			t.Number = i + 1
		}
	}
	s.topics = list
	if err := fsutil.WriteJSON(s.path("topics.json"), list); err != nil {
		return nil, err
	}
	for _, gone := range old {
		for _, f := range gone.Files {
			_ = os.Remove(s.filePath(f.Path))
		}
	}
	return slices.Clone(list), nil
}

func (s *Store) fsrs() *fsrs.FSRS {
	p := fsrs.DefaultParam()
	p.RequestRetention = s.settings.Retention
	p.EnableShortTerm = false // se planifica por días
	p.MaximumInterval = 365
	return fsrs.NewFSRS(p)
}

// ---------- Sesiones ----------

// LogSession registra lo que se hizo. Si es estudio o repaso de un tema con
// valoración, actualiza su memoria (FSRS); si viene de una tarea, la marca hecha.
func (s *Store) LogSession(se Session) (Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := ParseDate(se.Date); err != nil {
		return Session{}, err
	}
	if se.Minutes < 0 || se.Minutes > 24*60 {
		return Session{}, errors.New("minutos no válidos")
	}
	if se.Rating < 0 || se.Rating > 4 {
		return Session{}, errors.New("valoración no válida")
	}
	s.checkpoint()
	if se.ID == "" {
		se.ID = newID()
	}
	months := map[string]bool{}
	if se.TaskID != "" {
		if err := s.setDoneLocked(se.TaskID, true, months); err != nil && !errors.Is(err, ErrNotFound) {
			s.restoreLast()
			return Session{}, err
		}
	}
	if se.TopicID != "" && se.Rating > 0 {
		f := s.fsrs()
		for i := range s.topics {
			t := &s.topics[i]
			if t.ID != se.TopicID {
				continue
			}
			when, _ := ParseDate(se.Date)
			t.Memory = f.Next(t.Memory, when, fsrs.Rating(se.Rating)).Card
			if t.Studied == "" {
				t.Studied = se.Date
			}
		}
		if err := fsutil.WriteJSON(s.path("topics.json"), s.topics); err != nil {
			return Session{}, err
		}
	}
	s.sessions = append(s.sessions, se)
	if err := s.writeSessions(map[string]bool{monthOf(se.Date): true}); err != nil {
		return Session{}, err
	}
	return se, s.writeMonths(months)
}

// DeleteSession borra una sesión registrada por error (la memoria del tema no
// se recalcula: para eso está «deshacer»).
func (s *Store) DeleteSession(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, se := range s.sessions {
		if se.ID == id {
			s.checkpoint()
			s.sessions = slices.Delete(s.sessions, i, i+1)
			return s.writeSessions(map[string]bool{monthOf(se.Date): true})
		}
	}
	return nil
}

// Sessions devuelve las sesiones entre from y to (vacíos = todas).
func (s *Store) Sessions(from, to string) []Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []Session
	for _, se := range s.sessions {
		if (from == "" || se.Date >= from) && (to == "" || se.Date <= to) {
			out = append(out, se)
		}
	}
	return out
}

// Retrievability estima la probabilidad de recordar cada tema estudiado en date.
func (s *Store) Retrievability(date string) map[string]float64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	f := s.fsrs()
	when, err := ParseDate(date)
	if err != nil {
		return nil
	}
	out := map[string]float64{}
	for _, t := range s.topics {
		if t.Memory.State != fsrs.New {
			out[t.ID] = f.GetRetrievability(t.Memory, when)
		}
	}
	return out
}
