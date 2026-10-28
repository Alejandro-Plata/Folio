package gastos

import (
	"testing"
	"time"
)

func openTest(t *testing.T) *Store {
	t.Helper()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s.now = func() time.Time { return time.Date(2026, 10, 15, 8, 0, 0, 0, time.Local) }
	return s
}

func mustSave(t *testing.T, s *Store, m Movement) Movement {
	t.Helper()
	saved, err := s.Save(m)
	if err != nil {
		t.Fatal(err)
	}
	return saved
}

func TestSaveAndRangeAcrossMonths(t *testing.T) {
	s := openTest(t)
	mustSave(t, s, Movement{Kind: KindExpense, Date: "2026-09-20", Name: "Cena", CategoryID: "ocio", AmountCents: 2500})
	mustSave(t, s, Movement{Kind: KindExpense, Date: "2026-10-05", Name: "Compra semanal", CategoryID: "compra", AmountCents: 6000})
	mustSave(t, s, Movement{Kind: KindIncome, Date: "2026-10-01", Name: "Nómina", Method: MethodMonthly, AmountCents: 150000})

	if n := len(s.Range("2026-10-01", "2026-10-31")); n != 2 {
		t.Fatalf("octubre: %d movimientos, se esperaban 2", n)
	}
	if n := len(s.Range("", "")); n != 3 {
		t.Fatalf("sin límites: %d movimientos, se esperaban 3", n)
	}
}

func TestSaveChangesMonthFile(t *testing.T) {
	s := openTest(t)
	m := mustSave(t, s, Movement{Kind: KindExpense, Date: "2026-10-05", Name: "Luz", CategoryID: "luz", AmountCents: 4000})

	m.Date = "2026-11-05"
	mustSave(t, s, m)

	if n := len(s.Range("2026-10-01", "2026-10-31")); n != 0 {
		t.Fatalf("octubre debería quedar vacío tras mover el movimiento, tiene %d", n)
	}
	if n := len(s.Range("2026-11-01", "2026-11-30")); n != 1 {
		t.Fatalf("noviembre debería tener el movimiento movido, tiene %d", n)
	}
}

func TestSaveValidation(t *testing.T) {
	s := openTest(t)
	if _, err := s.Save(Movement{Kind: KindExpense, Date: "2026-10-05", Name: "Sin categoría", AmountCents: 100}); err == nil {
		t.Fatal("un gasto sin categoría debería fallar")
	}
	if _, err := s.Save(Movement{Kind: KindExpense, Date: "2026-10-05", Name: "Importe cero", CategoryID: "ocio", AmountCents: 0}); err == nil {
		t.Fatal("un importe <= 0 debería fallar")
	}
	if _, err := s.Save(Movement{Kind: KindExpense, Date: "2026-10-05", Name: "Categoría rara", CategoryID: "nope", AmountCents: 100}); err == nil {
		t.Fatal("una categoría inexistente debería fallar")
	}
}

func TestBalanceWithOpeningBalance(t *testing.T) {
	s := openTest(t)
	if err := s.SaveSettings(Settings{Currency: "EUR", OpeningCents: 100000, OpeningDate: "2026-10-01"}); err != nil {
		t.Fatal(err)
	}
	mustSave(t, s, Movement{Kind: KindIncome, Date: "2026-10-02", Name: "Nómina", AmountCents: 150000})
	mustSave(t, s, Movement{Kind: KindExpense, Date: "2026-10-03", Name: "Compra", CategoryID: "compra", AmountCents: 20000})
	// Antes del saldo inicial: no debe contar.
	mustSave(t, s, Movement{Kind: KindExpense, Date: "2026-09-01", Name: "Antiguo", CategoryID: "compra", AmountCents: 999999})

	sum := Summarize(s, Filter{}, "2026-10-15")
	want := int64(100000 + 150000 - 20000)
	if sum.BalanceCents != want {
		t.Fatalf("saldo = %d, se esperaba %d", sum.BalanceCents, want)
	}
}

func TestBudgetSpecificMonthBeatsWildcard(t *testing.T) {
	s := openTest(t)
	if err := s.SetBudget(Budget{Month: "*", CategoryID: "ocio", LimitCents: 5000}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetBudget(Budget{Month: "2026-10", CategoryID: "ocio", LimitCents: 8000}); err != nil {
		t.Fatal(err)
	}
	mustSave(t, s, Movement{Kind: KindExpense, Date: "2026-10-10", Name: "Cine", CategoryID: "ocio", AmountCents: 4000})

	sum := Summarize(s, Filter{}, "2026-10-15")
	var line *BudgetLine
	for i := range sum.Budget {
		if sum.Budget[i].CategoryID == "ocio" {
			line = &sum.Budget[i]
		}
	}
	if line == nil {
		t.Fatal("falta la línea de presupuesto de ocio")
	}
	if line.LimitCents != 8000 {
		t.Fatalf("límite = %d, se esperaba el del mes concreto (8000)", line.LimitCents)
	}
	if line.SpentCents != 4000 || line.Ratio != 0.5 {
		t.Fatalf("gastado/ratio = %d/%v", line.SpentCents, line.Ratio)
	}
}

func TestTopSortedDescending(t *testing.T) {
	s := openTest(t)
	mustSave(t, s, Movement{Kind: KindExpense, Date: "2026-10-01", Name: "Pequeño", CategoryID: "ocio", AmountCents: 500})
	mustSave(t, s, Movement{Kind: KindExpense, Date: "2026-10-02", Name: "Grande", CategoryID: "ocio", AmountCents: 50000})
	mustSave(t, s, Movement{Kind: KindExpense, Date: "2026-10-03", Name: "Mediano", CategoryID: "ocio", AmountCents: 5000})

	sum := Summarize(s, Filter{}, "2026-10-15")
	if len(sum.Top) != 3 || sum.Top[0].Name != "Grande" || sum.Top[1].Name != "Mediano" || sum.Top[2].Name != "Pequeño" {
		t.Fatalf("orden de Top: %v", sum.Top)
	}
}

func TestQueryFiltersAccentInsensitiveAndAmountRange(t *testing.T) {
	s := openTest(t)
	mustSave(t, s, Movement{Kind: KindExpense, Date: "2026-10-01", Name: "Gimnasio Músculo", CategoryID: "gimnasio", AmountCents: 3000})
	mustSave(t, s, Movement{Kind: KindExpense, Date: "2026-10-02", Name: "Otra cosa", CategoryID: "ocio", AmountCents: 9000})

	out := Query(s, Filter{Query: "musculo"})
	if len(out) != 1 || out[0].Name != "Gimnasio Músculo" {
		t.Fatalf("búsqueda sin tildes: %v", out)
	}

	out = Query(s, Filter{MinCents: 5000, MaxCents: 10000})
	if len(out) != 1 || out[0].Name != "Otra cosa" {
		t.Fatalf("rango de importes: %v", out)
	}
}

func TestUndo(t *testing.T) {
	s := openTest(t)
	m := mustSave(t, s, Movement{Kind: KindExpense, Date: "2026-10-05", Name: "Temporal", CategoryID: "ocio", AmountCents: 1000})
	if err := s.Delete([]string{m.ID}); err != nil {
		t.Fatal(err)
	}
	if n := len(s.Range("", "")); n != 0 {
		t.Fatalf("tras borrar: %d movimientos", n)
	}
	ok, err := s.Undo()
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("Undo debería deshacer el borrado")
	}
	if n := len(s.Range("", "")); n != 1 {
		t.Fatalf("tras deshacer: %d movimientos, se esperaba 1", n)
	}
}
