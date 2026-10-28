package core

import "folio/internal/gastos"

// Funciones de Gastos que usa la interfaz (bindings de Wails).

func (s *Service) gs() *gastos.Store { return s.gastos.Load() }

// GastosInitData es todo lo que Gastos necesita al abrirse.
type GastosInitData struct {
	Today      string            `json:"today"`
	Categories []gastos.Category `json:"categories"`
	Budgets    []gastos.Budget   `json:"budgets"`
	Settings   gastos.Settings   `json:"settings"`
}

func (s *Service) GastosInit() GastosInitData {
	g := s.gs()
	return GastosInitData{Today: g.Today(), Categories: g.Categories(), Budgets: g.Budgets(), Settings: g.Settings()}
}

func (s *Service) GastosRange(from, to string) []gastos.Movement { return s.gs().Range(from, to) }

func (s *Service) GastosQuery(f gastos.Filter) []gastos.Movement { return gastos.Query(s.gs(), f) }

func (s *Service) GastosSummary(f gastos.Filter) gastos.Summary {
	g := s.gs()
	return gastos.Summarize(g, f, g.Today())
}

func (s *Service) GastosSave(m gastos.Movement) (gastos.Movement, error) { return s.gs().Save(m) }

func (s *Service) GastosDelete(ids []string) error { return s.gs().Delete(ids) }

func (s *Service) GastosUndo() (bool, error) { return s.gs().Undo() }

func (s *Service) GastosSaveCategory(c gastos.Category) (gastos.Category, error) {
	return s.gs().SaveCategory(c)
}

func (s *Service) GastosDeleteCategory(id string) error { return s.gs().DeleteCategory(id) }

func (s *Service) GastosSetBudget(b gastos.Budget) error { return s.gs().SetBudget(b) }

func (s *Service) GastosSaveSettings(v gastos.Settings) error { return s.gs().SaveSettings(v) }
