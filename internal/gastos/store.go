package gastos

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"folio/internal/fsutil"
)

var ErrNotFound = errors.New("movimiento no encontrado")

const undoDepth = 50

// Store guarda Gastos en ‹espacio de trabajo›/gastos: JSON legibles, los
// movimientos partidos por mes (como agenda/tasks) y escritos de forma
// atómica. Copia el patrón de internal/agenda/store.go.
type Store struct {
	mu         sync.Mutex
	dir        string
	categories []Category
	budgets    []Budget
	settings   Settings
	movements  map[string]*Movement
	undo       []snapshot
	now        func() time.Time // reemplazable en los tests
}

type snapshot struct {
	movements  map[string]*Movement
	categories []Category
	budgets    []Budget
}

// Open abre (o crea) Gastos en dir.
func Open(dir string) (*Store, error) {
	s := &Store{dir: dir, movements: map[string]*Movement{}, now: time.Now}
	if err := os.MkdirAll(s.movementsDir(), 0o755); err != nil {
		return nil, err
	}

	s.categories = DefaultCategories()
	if _, err := os.Stat(s.path("categories.json")); err != nil {
		if err := fsutil.WriteJSON(s.path("categories.json"), s.categories); err != nil {
			return nil, err
		}
	} else {
		_ = fsutil.ReadJSON(s.path("categories.json"), &s.categories)
	}
	_ = fsutil.ReadJSON(s.path("budgets.json"), &s.budgets)
	_ = fsutil.ReadJSON(s.path("settings.json"), &s.settings)
	if s.settings.Currency == "" {
		s.settings.Currency = "EUR"
	}

	files, _ := filepath.Glob(filepath.Join(s.movementsDir(), "*.json"))
	for _, f := range files {
		var list []Movement
		if err := fsutil.ReadJSON(f, &list); err != nil {
			continue // un mes dañado no impide abrir el resto
		}
		for i := range list {
			m := list[i]
			s.movements[m.ID] = &m
		}
	}
	return s, nil
}

func (s *Store) path(name string) string { return filepath.Join(s.dir, name) }
func (s *Store) movementsDir() string    { return filepath.Join(s.dir, "movements") }

// Today es el día local actual.
func (s *Store) Today() string { return s.now().Format(DateLayout) }

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func monthOf(date string) string {
	if len(date) >= 7 {
		return date[:7]
	}
	return "sin-fecha"
}

// ---------- Persistencia ----------

func sortMovements(list []Movement) {
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].Date != list[j].Date {
			return list[i].Date > list[j].Date
		}
		if list[i].Updated != list[j].Updated {
			return list[i].Updated > list[j].Updated
		}
		return list[i].ID > list[j].ID
	})
}

// writeMonths reescribe los archivos de movimientos de los meses indicados.
func (s *Store) writeMonths(months map[string]bool) error {
	byMonth := map[string][]Movement{}
	for _, m := range s.movements {
		if mo := monthOf(m.Date); months[mo] {
			byMonth[mo] = append(byMonth[mo], *m)
		}
	}
	for mo := range months {
		p := filepath.Join(s.movementsDir(), mo+".json")
		list := byMonth[mo]
		if len(list) == 0 {
			_ = os.Remove(p)
			continue
		}
		sortMovements(list)
		if err := fsutil.WriteJSON(p, list); err != nil {
			return err
		}
	}
	return nil
}

// checkpoint guarda el estado para poder deshacer la operación que sigue.
func (s *Store) checkpoint() {
	snap := snapshot{movements: make(map[string]*Movement, len(s.movements)), categories: slices.Clone(s.categories), budgets: slices.Clone(s.budgets)}
	for k, v := range s.movements {
		c := *v
		snap.movements[k] = &c
	}
	s.undo = append(s.undo, snap)
	if len(s.undo) > undoDepth {
		s.undo = s.undo[len(s.undo)-undoDepth:]
	}
}

// Undo deshace la última operación sobre movimientos.
func (s *Store) Undo() (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.undo) == 0 {
		return false, nil
	}
	snap := s.undo[len(s.undo)-1]
	s.undo = s.undo[:len(s.undo)-1]
	months := map[string]bool{}
	for _, m := range s.movements {
		months[monthOf(m.Date)] = true
	}
	for _, m := range snap.movements {
		months[monthOf(m.Date)] = true
	}
	s.movements, s.categories, s.budgets = snap.movements, snap.categories, snap.budgets
	if err := s.writeMonths(months); err != nil {
		return true, err
	}
	if err := fsutil.WriteJSON(s.path("categories.json"), s.categories); err != nil {
		return true, err
	}
	return true, fsutil.WriteJSON(s.path("budgets.json"), s.budgets)
}

// ---------- Movimientos ----------

// Range devuelve los movimientos entre from y to (vacíos = sin límite),
// ordenados por fecha descendente y, a igualdad, por última modificación.
func (s *Store) Range(from, to string) []Movement {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []Movement
	for _, m := range s.movements {
		if (from == "" || m.Date >= from) && (to == "" || m.Date <= to) {
			out = append(out, *m)
		}
	}
	sortMovements(out)
	return out
}

func (s *Store) normalize(m *Movement) error {
	if m.Kind != KindExpense && m.Kind != KindIncome {
		return errors.New("tipo de movimiento no válido")
	}
	if _, err := time.Parse(DateLayout, m.Date); err != nil {
		return fmt.Errorf("fecha no válida: %q", m.Date)
	}
	if m.AmountCents <= 0 {
		return errors.New("el importe tiene que ser mayor que cero")
	}
	m.Name = strings.TrimSpace(m.Name)
	if m.Name == "" {
		return errors.New("el movimiento necesita un nombre")
	}
	if m.Kind == KindExpense {
		if m.CategoryID == "" {
			return errors.New("el gasto necesita una categoría")
		}
		found := false
		for _, c := range s.categories {
			if c.ID == m.CategoryID {
				found = true
				break
			}
		}
		if !found {
			return errors.New("categoría no encontrada")
		}
	} else {
		m.CategoryID = ""
	}
	m.Updated = s.now().Format(time.RFC3339)
	return nil
}

// Save crea o actualiza un movimiento. Si cambia de mes, se mueve de archivo.
func (s *Store) Save(m Movement) (Movement, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.checkpoint()
	months := map[string]bool{}
	if m.ID == "" {
		m.ID = newID()
	} else if old, ok := s.movements[m.ID]; ok {
		months[monthOf(old.Date)] = true
	} else {
		s.undo = s.undo[:len(s.undo)-1]
		return Movement{}, ErrNotFound
	}
	if err := s.normalize(&m); err != nil {
		s.undo = s.undo[:len(s.undo)-1]
		return Movement{}, err
	}
	c := m
	s.movements[m.ID] = &c
	months[monthOf(m.Date)] = true
	if err := s.writeMonths(months); err != nil {
		return Movement{}, err
	}
	return m, nil
}

// Delete borra movimientos por id.
func (s *Store) Delete(ids []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.checkpoint()
	months := map[string]bool{}
	for _, id := range ids {
		if old, ok := s.movements[id]; ok {
			months[monthOf(old.Date)] = true
			delete(s.movements, id)
		}
	}
	return s.writeMonths(months)
}

// ---------- Categorías ----------

func (s *Store) Categories() []Category {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.categories)
}

// SaveCategory crea o actualiza una categoría. Fixed no se puede cambiar
// desde la interfaz: lo conserva el store.
func (s *Store) SaveCategory(c Category) (Category, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" {
		return Category{}, errors.New("la categoría necesita un nombre")
	}
	if c.ID == "" {
		c.ID = newID()
	}
	for i, old := range s.categories {
		if old.ID == c.ID {
			c.Fixed = old.Fixed
			s.categories[i] = c
			return c, fsutil.WriteJSON(s.path("categories.json"), s.categories)
		}
	}
	c.Fixed = false
	s.categories = append(s.categories, c)
	return c, fsutil.WriteJSON(s.path("categories.json"), s.categories)
}

// DeleteCategory falla si la categoría es de serie o tiene movimientos.
func (s *Store) DeleteCategory(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	idx := -1
	for i, c := range s.categories {
		if c.ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		return errors.New("categoría no encontrada")
	}
	if s.categories[idx].Fixed {
		return errors.New("las categorías de serie no se pueden borrar")
	}
	for _, m := range s.movements {
		if m.CategoryID == id {
			return errors.New("la categoría tiene movimientos: no se puede borrar")
		}
	}
	s.categories = slices.Delete(s.categories, idx, idx+1)
	return fsutil.WriteJSON(s.path("categories.json"), s.categories)
}

// ---------- Presupuestos ----------

func (s *Store) Budgets() []Budget {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.budgets)
}

// SetBudget guarda el límite de una categoría en un mes (o "*" para todos).
// LimitCents == 0 lo elimina.
func (s *Store) SetBudget(b Budget) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if b.CategoryID == "" || b.Month == "" {
		return errors.New("el presupuesto necesita categoría y mes")
	}
	b.ID = b.Month + "|" + b.CategoryID
	idx := -1
	for i, x := range s.budgets {
		if x.Month == b.Month && x.CategoryID == b.CategoryID {
			idx = i
			break
		}
	}
	switch {
	case b.LimitCents == 0 && idx >= 0:
		s.budgets = slices.Delete(s.budgets, idx, idx+1)
	case b.LimitCents == 0:
		return fsutil.WriteJSON(s.path("budgets.json"), s.budgets)
	case idx >= 0:
		s.budgets[idx] = b
	default:
		s.budgets = append(s.budgets, b)
	}
	return fsutil.WriteJSON(s.path("budgets.json"), s.budgets)
}

// ---------- Ajustes ----------

func (s *Store) Settings() Settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.settings
}

func (s *Store) SaveSettings(v Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if v.Currency == "" {
		v.Currency = "EUR"
	}
	s.settings = v
	return fsutil.WriteJSON(s.path("settings.json"), v)
}
