package core

import (
	"os"
	"path/filepath"
	"strings"

	"folio/internal/agenda"
)

// Funciones de la agenda que usa la interfaz (bindings de Wails).

func (s *Service) ag() *agenda.Store { return s.agenda.Load() }

// AgendaInit devuelve todo lo que la agenda necesita al abrirse.
type AgendaInitData struct {
	Today     string                `json:"today"`
	Types     []agenda.TaskType     `json:"types"`
	Settings  agenda.PlanSettings   `json:"settings"`
	Topics    []agenda.Topic        `json:"topics"`
	Templates []agenda.WeekTemplate `json:"templates"`
}

func (s *Service) AgendaInit() AgendaInitData {
	ag := s.ag()
	return AgendaInitData{Today: ag.Today(), Types: ag.Types(), Settings: ag.Settings(), Topics: ag.Topics(), Templates: ag.Templates()}
}

func (s *Service) AgendaRange(from, to string) []agenda.Task { return s.ag().Range(from, to) }

// Las tareas con círculo (o con ID «c:…») son eventos compartidos: se guardan
// en el servidor. Pasar una tarea de privada a un círculo, o al revés, la mueve.
func (s *Service) AgendaSaveTask(t agenda.Task, scope string) (agenda.Task, error) {
	switch {
	case t.Circle != nil && t.Circle.ID != "":
		out, err := s.saveCircleTask(t)
		if err == nil && t.ID != "" && !isCircleID(t.ID) {
			err = s.ag().DeleteTasks([]string{t.ID}, "all")
		}
		return out, err
	case isCircleID(t.ID):
		eventID := strings.TrimPrefix(t.ID, circlePrefix)
		t.ID, t.Circle = "", nil
		out, err := s.ag().SaveTask(t, "")
		if err == nil {
			err = s.social.DeleteEvent(ctx(), eventID)
		}
		return out, err
	}
	return s.ag().SaveTask(t, scope)
}
func (s *Service) AgendaSaveTasks(list []agenda.Task) ([]agenda.Task, error) {
	var local, out []agenda.Task
	for _, t := range list {
		if t.Circle != nil && t.Circle.ID != "" {
			c, err := s.saveCircleTask(t)
			if err != nil {
				return out, err
			}
			out = append(out, c)
		} else {
			local = append(local, t)
		}
	}
	if len(local) == 0 {
		return out, nil
	}
	saved, err := s.ag().SaveTasks(local)
	return append(out, saved...), err
}
func (s *Service) AgendaDeleteTasks(ids []string, scope string) error {
	var local []string
	for _, id := range ids {
		if isCircleID(id) {
			if err := s.social.DeleteEvent(ctx(), strings.TrimPrefix(id, circlePrefix)); err != nil {
				return err
			}
		} else {
			local = append(local, id)
		}
	}
	if len(local) == 0 {
		return nil
	}
	return s.ag().DeleteTasks(local, scope)
}
func (s *Service) AgendaMoveTasks(ids []string, days int) error {
	var local []string
	for _, id := range ids {
		if !isCircleID(id) {
			local = append(local, id)
			continue
		}
		e, ok := s.cachedEvent(strings.TrimPrefix(id, circlePrefix))
		if !ok {
			continue
		}
		e.Date = agenda.AddDays(e.Date, days)
		if _, err := s.social.SaveEvent(ctx(), e); err != nil {
			return err
		}
	}
	if len(local) == 0 {
		return nil
	}
	return s.ag().MoveTasks(local, days)
}

// Los eventos de un círculo no se marcan como hechos (son de todos).
func (s *Service) AgendaSetDone(id string, done bool) error {
	if isCircleID(id) {
		return nil
	}
	return s.ag().SetDone(id, done)
}
func (s *Service) AgendaUndo() (bool, error) { return s.ag().Undo() }

func (s *Service) AgendaSetTypes(list []agenda.TaskType) error   { return s.ag().SetTypes(list) }
func (s *Service) AgendaSetSettings(p agenda.PlanSettings) error { return s.ag().SetSettings(p) }
func (s *Service) AgendaSetTemplates(list []agenda.WeekTemplate) error {
	return s.ag().SetTemplates(list)
}
func (s *Service) AgendaApplyTemplate(id string, mondays []string) ([]agenda.Task, error) {
	return s.ag().ApplyTemplate(id, mondays)
}

func (s *Service) AgendaSetTopics(list []agenda.Topic) ([]agenda.Topic, error) {
	return s.ag().SetTopics(list)
}
func (s *Service) AgendaLogSession(se agenda.Session) (agenda.Session, error) {
	return s.ag().LogSession(se)
}
func (s *Service) AgendaDeleteSession(id string) error { return s.ag().DeleteSession(id) }
func (s *Service) AgendaSessions(from, to string) []agenda.Session {
	return s.ag().Sessions(from, to)
}
func (s *Service) AgendaRetrievability(date string) map[string]float64 {
	return s.ag().Retrievability(date)
}
func (s *Service) AgendaPlan() (agenda.PlanReport, error) { return s.ag().Plan() }

// AgendaPractice cambia a una agenda de práctica vacía (start = true) para el
// tutorial, o la borra y vuelve a la agenda real (start = false). La agenda
// real no se toca en ningún momento.
func (s *Service) AgendaPractice(start bool) error {
	dir := filepath.Join(s.opt.ConfigDir, "agenda-practica")
	if start {
		if s.realAgenda.Load() == nil {
			s.realAgenda.Store(s.agenda.Load())
		}
		_ = os.RemoveAll(dir)
		practice, err := agenda.Open(dir)
		if err != nil {
			return err
		}
		s.agenda.Store(practice)
		return nil
	}
	if real := s.realAgenda.Swap(nil); real != nil {
		s.agenda.Store(real)
	}
	return os.RemoveAll(dir)
}

// Apuntes adjuntos a los temas y previsión de la curva del olvido.
func (s *Service) AgendaAttachFiles(topicID string, paths []string) (agenda.Topic, error) {
	return s.ag().AttachFiles(topicID, paths)
}
func (s *Service) AgendaRemoveTopicFile(topicID, fileID string) (agenda.Topic, error) {
	return s.ag().RemoveTopicFile(topicID, fileID)
}
func (s *Service) AgendaTopicFilePath(rel string) string { return s.ag().FilePath(rel) }
func (s *Service) AgendaForecast(topicID, date string) (agenda.Forecast, error) {
	return s.ag().Forecast(topicID, date)
}
