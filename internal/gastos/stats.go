package gastos

import (
	"sort"
	"strings"
	"time"
)

// Filter acota una consulta de movimientos.
type Filter struct {
	From        string   `json:"from"` // YYYY-MM-DD; vacíos = sin límite
	To          string   `json:"to"`
	Kind        Kind     `json:"kind"` // "" = ambos
	CategoryIDs []string `json:"categoryIds"`
	Methods     []Method `json:"methods"`
	Query       string   `json:"query"` // en Name, Counterparty y Concept, sin distinguir mayúsculas ni tildes
	MinCents    int64    `json:"minCents"`
	MaxCents    int64    `json:"maxCents"` // 0 = sin máximo
	Sort        string   `json:"sort"`     // "date" | "amount"
}

type CategoryTotal struct {
	CategoryID string  `json:"categoryId"`
	Cents      int64   `json:"cents"`
	Count      int     `json:"count"`
	Share      float64 `json:"share"`
}

type MonthPoint struct {
	Month   string `json:"month"`
	Expense int64  `json:"expense"`
	Income  int64  `json:"income"`
}

type BudgetLine struct {
	CategoryID string  `json:"categoryId"`
	LimitCents int64   `json:"limitCents"`
	SpentCents int64   `json:"spentCents"`
	Ratio      float64 `json:"ratio"` // spent/limit
}

type Summary struct {
	BalanceCents int64           `json:"balanceCents"` // OpeningCents + Σingresos − Σgastos (desde OpeningDate hasta hoy)
	IncomeCents  int64           `json:"incomeCents"`  // del periodo filtrado
	ExpenseCents int64           `json:"expenseCents"`
	ByCategory   []CategoryTotal `json:"byCategory"` // gastos, de mayor a menor
	Top          []Movement      `json:"top"`        // 10 gastos de mayor importe del periodo
	Trend        []MonthPoint    `json:"trend"`      // los últimos 12 meses, terminando en el mes de To (o en el actual)
	Budget       []BudgetLine    `json:"budget"`     // mes de To (o el actual)
}

// fold quita mayúsculas y tildes para comparar texto sin distinguirlas.
func fold(s string) string {
	s = strings.ToLower(s)
	for _, r := range [][2]string{{"á", "a"}, {"é", "e"}, {"í", "i"}, {"ó", "o"}, {"ú", "u"}, {"ü", "u"}, {"ñ", "n"}} {
		s = strings.ReplaceAll(s, r[0], r[1])
	}
	return s
}

func addMonthsYM(ym string, n int) string {
	t, err := time.Parse("2006-01", ym)
	if err != nil {
		return ym
	}
	return t.AddDate(0, n, 0).Format("2006-01")
}

// Query devuelve los movimientos que cumplen el filtro, ordenados por fecha
// (o por importe si Sort == "amount"), siempre de mayor a menor.
func Query(s *Store, f Filter) []Movement {
	list := s.Range(f.From, f.To)
	catSet := map[string]bool{}
	for _, id := range f.CategoryIDs {
		catSet[id] = true
	}
	methodSet := map[Method]bool{}
	for _, m := range f.Methods {
		methodSet[m] = true
	}
	q := fold(strings.TrimSpace(f.Query))
	out := make([]Movement, 0, len(list))
	for _, m := range list {
		switch {
		case f.Kind != "" && m.Kind != f.Kind:
			continue
		case len(catSet) > 0 && !catSet[m.CategoryID]:
			continue
		case len(methodSet) > 0 && !methodSet[m.Method]:
			continue
		case f.MinCents > 0 && m.AmountCents < f.MinCents:
			continue
		case f.MaxCents > 0 && m.AmountCents > f.MaxCents:
			continue
		case q != "" && !strings.Contains(fold(m.Name), q) && !strings.Contains(fold(m.Counterparty), q) && !strings.Contains(fold(m.Concept), q):
			continue
		}
		out = append(out, m)
	}
	if f.Sort == "amount" {
		sort.SliceStable(out, func(i, j int) bool { return out[i].AmountCents > out[j].AmountCents })
	}
	return out
}

// Summarize calcula el resumen (saldo, totales, gráficas y presupuesto) para
// el filtro dado. today decide el mes de la tendencia y el presupuesto
// cuando el filtro no fija un «hasta».
func Summarize(s *Store, f Filter, today string) Summary {
	all := s.Range("", "")
	var out Summary

	set := s.Settings()
	out.BalanceCents = set.OpeningCents
	for _, m := range all {
		if set.OpeningDate != "" && m.Date < set.OpeningDate {
			continue
		}
		if m.Date > today {
			continue
		}
		if m.Kind == KindIncome {
			out.BalanceCents += m.AmountCents
		} else {
			out.BalanceCents -= m.AmountCents
		}
	}

	filtered := Query(s, f)
	catTotals := map[string]*CategoryTotal{}
	var catOrder []string
	for _, m := range filtered {
		switch m.Kind {
		case KindIncome:
			out.IncomeCents += m.AmountCents
		case KindExpense:
			out.ExpenseCents += m.AmountCents
			ct, ok := catTotals[m.CategoryID]
			if !ok {
				ct = &CategoryTotal{CategoryID: m.CategoryID}
				catTotals[m.CategoryID] = ct
				catOrder = append(catOrder, m.CategoryID)
			}
			ct.Cents += m.AmountCents
			ct.Count++
		}
	}
	for _, id := range catOrder {
		ct := *catTotals[id]
		if out.ExpenseCents > 0 {
			ct.Share = float64(ct.Cents) / float64(out.ExpenseCents)
		}
		out.ByCategory = append(out.ByCategory, ct)
	}
	sort.SliceStable(out.ByCategory, func(i, j int) bool { return out.ByCategory[i].Cents > out.ByCategory[j].Cents })

	for _, m := range filtered {
		if m.Kind == KindExpense {
			out.Top = append(out.Top, m)
		}
	}
	sort.SliceStable(out.Top, func(i, j int) bool { return out.Top[i].AmountCents > out.Top[j].AmountCents })
	if len(out.Top) > 10 {
		out.Top = out.Top[:10]
	}

	endMonth := today[:7]
	if len(f.To) >= 7 {
		endMonth = f.To[:7]
	}
	startMonth := addMonthsYM(endMonth, -11)
	byMonth := map[string]*MonthPoint{}
	for _, m := range all {
		mo := monthOf(m.Date)
		if mo < startMonth || mo > endMonth {
			continue
		}
		mp, ok := byMonth[mo]
		if !ok {
			mp = &MonthPoint{Month: mo}
			byMonth[mo] = mp
		}
		if m.Kind == KindIncome {
			mp.Income += m.AmountCents
		} else {
			mp.Expense += m.AmountCents
		}
	}
	for mo := startMonth; mo <= endMonth; mo = addMonthsYM(mo, 1) {
		if mp, ok := byMonth[mo]; ok {
			out.Trend = append(out.Trend, *mp)
		} else {
			out.Trend = append(out.Trend, MonthPoint{Month: mo})
		}
	}

	budgetMonth := endMonth
	spent := map[string]int64{}
	for _, m := range all {
		if m.Kind == KindExpense && monthOf(m.Date) == budgetMonth {
			spent[m.CategoryID] += m.AmountCents
		}
	}
	specific := map[string]Budget{}
	wildcard := map[string]Budget{}
	for _, b := range s.Budgets() {
		if b.Month == budgetMonth {
			specific[b.CategoryID] = b
		} else if b.Month == "*" {
			wildcard[b.CategoryID] = b
		}
	}
	catIDs := map[string]bool{}
	for id := range specific {
		catIDs[id] = true
	}
	for id := range wildcard {
		catIDs[id] = true
	}
	var budgetOrder []string
	for id := range catIDs {
		budgetOrder = append(budgetOrder, id)
	}
	sort.Strings(budgetOrder)
	for _, id := range budgetOrder {
		b, ok := specific[id]
		if !ok {
			b = wildcard[id]
		}
		sp := spent[id]
		var ratio float64
		if b.LimitCents > 0 {
			ratio = float64(sp) / float64(b.LimitCents)
		}
		out.Budget = append(out.Budget, BudgetLine{CategoryID: id, LimitCents: b.LimitCents, SpentCents: sp, Ratio: ratio})
	}

	return out
}
