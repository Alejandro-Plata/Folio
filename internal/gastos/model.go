// Package gastos guarda y analiza los movimientos del módulo «Gastos»: gastos
// e ingresos, categorías, presupuestos por categoría y mes, y los ajustes
// (saldo inicial, fecha y moneda).
//
// Las fechas son días locales «AAAA-MM-DD», como en internal/agenda, y los
// importes siempre van en céntimos (int64): nunca en coma flotante.
package gastos

const DateLayout = "2006-01-02"

type Kind string

const (
	KindExpense Kind = "expense"
	KindIncome  Kind = "income"
)

type Method string

const (
	MethodNone     Method = ""
	MethodMonthly  Method = "monthly"
	MethodBizum    Method = "bizum"
	MethodTransfer Method = "transfer"
	MethodCash     Method = "cash"
	MethodCard     Method = "card"
)

// Category es una categoría de gasto. Las 8 de serie (Fixed) no se pueden
// borrar; las que crea la persona llevan un newID().
type Category struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
	Icon  string `json:"icon"`
	Fixed bool   `json:"fixed"`
}

// Movement es un gasto o un ingreso. El importe siempre es positivo; el
// signo lo da Kind.
type Movement struct {
	ID           string `json:"id"`
	Kind         Kind   `json:"kind"`
	Date         string `json:"date"`
	Name         string `json:"name"`
	CategoryID   string `json:"categoryId,omitempty"`
	AmountCents  int64  `json:"amountCents"`
	Method       Method `json:"method,omitempty"`
	Counterparty string `json:"counterparty,omitempty"`
	Concept      string `json:"concept,omitempty"`
	Updated      string `json:"updated"`
}

// Budget es el límite previsto para una categoría en un mes, o en todos
// ("*"). ID es month+"|"+categoryId: lo pone el store antes de guardar y
// solo sirve para que la sincronización pueda fusionar la lista por id.
type Budget struct {
	ID         string `json:"id,omitempty"`
	Month      string `json:"month"`
	CategoryID string `json:"categoryId"`
	LimitCents int64  `json:"limitCents"`
}

type Settings struct {
	Currency     string `json:"currency"`
	OpeningCents int64  `json:"openingCents"`
	OpeningDate  string `json:"openingDate"`
}

// DefaultCategories son las 8 categorías de serie.
func DefaultCategories() []Category {
	return []Category{
		{ID: "compra", Name: "Compra", Color: "#2f74c0", Icon: "wallet", Fixed: true},
		{ID: "ocio", Name: "Ocio", Color: "#7552c4", Icon: "music", Fixed: true},
		{ID: "comunes", Name: "Gastos comunes", Color: "#a87700", Icon: "home", Fixed: true},
		{ID: "luz", Name: "Luz", Color: "#e0a400", Icon: "sun", Fixed: true},
		{ID: "agua", Name: "Agua", Color: "#1f9bb5", Icon: "cloud", Fixed: true},
		{ID: "gas", Name: "Gas", Color: "#d0652b", Icon: "flame", Fixed: true},
		{ID: "estudio", Name: "Estudio", Color: "#2e8b4e", Icon: "graduation", Fixed: true},
		{ID: "gimnasio", Name: "Gimnasio", Color: "#c33b3b", Icon: "activity", Fixed: true},
	}
}
