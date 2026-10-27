// Package agenda guarda y planifica la agenda de estudio: tareas (con
// repeticiones), tipos con prioridad, temario con repetición espaciada (FSRS),
// sesiones realizadas y el planificador que intercala estudio y repaso.
//
// Las fechas son días locales «AAAA-MM-DD» y las horas «HH:MM»: en una agenda
// personal se evitan así los problemas de zonas horarias y cambios de hora.
package agenda

import (
	"time"

	fsrs "github.com/open-spaced-repetition/go-fsrs/v3"
)

const (
	DateLayout = "2006-01-02"

	KindStudy  = "study"  // estudio nuevo de un tema
	KindReview = "review" // repaso de un tema
	KindMock   = "mock"   // simulacro / test
	KindRest   = "rest"   // día de descanso concreto: el plan no pone nada

	ScopeOne       = "one"       // solo esta ocurrencia de una serie
	ScopeFollowing = "following" // esta y las siguientes
	ScopeAll       = "all"       // toda la serie
)

// Task es una tarea con hora (Start) o de día completo (Start vacío).
// Si tiene Repeat es la «madre» de una serie; sus ocurrencias se calculan al
// leer un rango. Una ocurrencia editada por separado es otra tarea con SeriesID.
type Task struct {
	ID       string    `json:"id"`
	Title    string    `json:"title"`
	TypeID   string    `json:"typeId"`
	Date     string    `json:"date"`
	Start    string    `json:"start,omitempty"`
	Minutes  int       `json:"minutes,omitempty"`
	Notes    string    `json:"notes,omitempty"`
	Repeat   *Repeat   `json:"repeat,omitempty"`
	SeriesID string    `json:"seriesId,omitempty"`
	TopicID  string    `json:"topicId,omitempty"`
	Kind     string    `json:"kind,omitempty"`
	Auto     bool      `json:"auto,omitempty"`
	Pinned   bool      `json:"pinned,omitempty"`
	Done     bool      `json:"done"`
	DocID    string    `json:"docId,omitempty"`
	Updated  time.Time `json:"updated"`

	// Solo en las ocurrencias devueltas por Range (no se guardan).
	OccurrenceOf string `json:"occurrenceOf,omitempty"`
	// Evento de un círculo (vive en el servidor, no en la agenda local).
	Circle *CircleRef `json:"circle,omitempty"`
}

// CircleRef indica que una tarea es un evento compartido de un círculo.
type CircleRef struct {
	ID         string `json:"id"`
	Name       string `json:"name,omitempty"`
	Kind       string `json:"kind,omitempty"` // friends | couple
	Color      string `json:"color,omitempty"`
	By         string `json:"by,omitempty"` // nombre de quien lo creó
	Mine       bool   `json:"mine,omitempty"`
	ProposalID string `json:"proposalId,omitempty"` // si salió de una cita
}

// Repeat describe una repetición sencilla (lo que se puede decir con palabras:
// «de lunes a viernes», «cada 2 semanas los martes», «cada mes hasta junio»).
type Repeat struct {
	Freq     string   `json:"freq"`               // daily | weekly | monthly
	Interval int      `json:"interval"`           // cada N (mínimo 1)
	Weekdays []int    `json:"weekdays,omitempty"` // 1 = lunes … 7 = domingo (weekly)
	Until    string   `json:"until,omitempty"`    // último día incluido
	Except   []string `json:"except,omitempty"`   // fechas quitadas de la serie
	Done     []string `json:"done,omitempty"`     // ocurrencias marcadas como hechas
}

// TaskType define el tipo de tarea y su prioridad (1 = máxima). El color nunca
// va solo: cada tipo tiene además icono y trama, por accesibilidad.
type TaskType struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Priority      int    `json:"priority"`
	Color         string `json:"color"`
	Icon          string `json:"icon"`
	Pattern       string `json:"pattern"` // solid | stripes | dots | grid
	CountsAsStudy bool   `json:"countsAsStudy"`
	Fixed         bool   `json:"fixed"` // el planificador nunca lo mueve
}

// Topic es un tema del temario con su estado de memoria FSRS.
type Topic struct {
	ID           string      `json:"id"`
	Number       int         `json:"number"`
	Title        string      `json:"title"`
	Block        string      `json:"block,omitempty"`
	Weight       float64     `json:"weight"`       // dificultad o extensión (1 = normal)
	StudyMinutes int         `json:"studyMinutes"` // primera vez; 0 = el bloque por defecto
	DocID        string      `json:"docId,omitempty"`
	Files        []TopicFile `json:"files,omitempty"` // apuntes adjuntos (Word, PDF…)
	Memory       fsrs.Card   `json:"memory"`
	Studied      string      `json:"studied,omitempty"` // día en que se estudió por primera vez
	Archived     bool        `json:"archived,omitempty"`
}

// TopicFile es un archivo de apuntes adjunto a un tema. Se copia dentro de
// la agenda (apuntes/) con un nombre único, así que nunca cambia y se
// sincroniza como un archivo inmutable.
type TopicFile struct {
	ID    string `json:"id"`
	Name  string `json:"name"` // nombre original, para mostrarlo
	Path  string `json:"path"` // relativa a la carpeta de la agenda
	Size  int64  `json:"size"`
	Added string `json:"added"`
}

// Session es lo que realmente se hizo.
type Session struct {
	ID      string   `json:"id"`
	TaskID  string   `json:"taskId,omitempty"`
	TopicID string   `json:"topicId,omitempty"`
	TypeID  string   `json:"typeId,omitempty"`
	Kind    string   `json:"kind,omitempty"`
	Date    string   `json:"date"`
	Start   string   `json:"start,omitempty"`
	Minutes int      `json:"minutes"`
	Rating  int      `json:"rating,omitempty"` // 1 Otra vez · 2 Difícil · 3 Bien · 4 Fácil
	Score   *float64 `json:"score,omitempty"`  // nota de test, 0-10
	Note    string   `json:"note,omitempty"`
}

// Window es una franja horaria de estudio.
type Window struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

// PlanSettings son las preferencias del planificador. Todo lo elige la persona;
// la interfaz solo sugiere valores a partir de sus últimas acciones.
type PlanSettings struct {
	ExamDate     string `json:"examDate"`
	CapacityMode string `json:"capacityMode"` // hours | window | both
	// Minutos de estudio por día de la semana (clave "1" = lunes … "7" = domingo).
	Capacity       map[string]int    `json:"capacity"`
	Windows        map[string]Window `json:"windows"` // franja por día de la semana
	RestDays       []int             `json:"restDays"`
	BlockMinutes   int               `json:"blockMinutes"`
	ReviewMinutes  int               `json:"reviewMinutes"`
	BreakMinutes   int               `json:"breakMinutes"`
	Retention      float64           `json:"retention"`
	FinalPhaseDays int               `json:"finalPhaseDays"`
	MinReviews     int               `json:"minReviews"` // repasos mínimos de cada tema antes del examen
	Suggestions    bool              `json:"suggestions"`
	DayStart       string            `json:"dayStart"` // franja visible en día/semana
	DayEnd         string            `json:"dayEnd"`
}

// WeekTemplate es una «semana tipo» que se aplica de una vez a varias semanas.
type WeekTemplate struct {
	ID    string         `json:"id"`
	Name  string         `json:"name"`
	Tasks []TemplateTask `json:"tasks"`
}

// TemplateTask es una tarea de una semana tipo (día de la semana en vez de fecha).
type TemplateTask struct {
	Weekday int    `json:"weekday"` // 1 = lunes
	Title   string `json:"title"`
	TypeID  string `json:"typeId"`
	Start   string `json:"start,omitempty"`
	Minutes int    `json:"minutes,omitempty"`
	Notes   string `json:"notes,omitempty"`
}

// DefaultTypes son los tipos iniciales (editables).
func DefaultTypes() []TaskType {
	return []TaskType{
		{ID: "mock", Name: "Simulacro / examen", Priority: 1, Color: "#c33b3b", Icon: "target", Pattern: "grid", CountsAsStudy: true, Fixed: true},
		{ID: "review", Name: "Repaso", Priority: 2, Color: "#2f74c0", Icon: "history", Pattern: "stripes", CountsAsStudy: true},
		{ID: "study", Name: "Estudio nuevo", Priority: 3, Color: "#2e8b4e", Icon: "bookOpen", Pattern: "solid", CountsAsStudy: true},
		{ID: "work", Name: "Clase / trabajo", Priority: 4, Color: "#a87700", Icon: "graduation", Pattern: "dots", Fixed: true},
		{ID: "personal", Name: "Personal", Priority: 5, Color: "#7552c4", Icon: "users", Pattern: "solid"},
	}
}

// DefaultSettings son valores razonables de partida (de lunes a viernes por la
// tarde, sábado por la mañana, domingo de descanso).
func DefaultSettings() PlanSettings {
	weekday := Window{Start: "16:00", End: "20:00"}
	return PlanSettings{
		CapacityMode: "both",
		Capacity:     map[string]int{"1": 180, "2": 180, "3": 180, "4": 180, "5": 150, "6": 240, "7": 0},
		Windows: map[string]Window{"1": weekday, "2": weekday, "3": weekday, "4": weekday, "5": weekday,
			"6": {Start: "09:30", End: "14:00"}, "7": {Start: "10:00", End: "13:00"}},
		RestDays:       []int{7},
		BlockMinutes:   50,
		ReviewMinutes:  25,
		BreakMinutes:   10,
		Retention:      0.9,
		FinalPhaseDays: 21,
		MinReviews:     3,
		Suggestions:    true,
		DayStart:       "07:00",
		DayEnd:         "23:00",
	}
}
