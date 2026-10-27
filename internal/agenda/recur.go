package agenda

import (
	"fmt"
	"slices"
	"strings"
	"time"
)

// ParseDate interpreta «AAAA-MM-DD» como día local a mediodía (así sumar días
// nunca cruza un cambio de hora y se queda en el día anterior).
func ParseDate(s string) (time.Time, error) {
	t, err := time.ParseInLocation(DateLayout, s, time.Local)
	if err != nil {
		return time.Time{}, fmt.Errorf("fecha no válida: %q", s)
	}
	return t.Add(12 * time.Hour), nil
}

func mustDate(s string) time.Time {
	t, err := ParseDate(s)
	if err != nil {
		panic(err)
	}
	return t
}

// FormatDate devuelve el día local de t.
func FormatDate(t time.Time) string { return t.Format(DateLayout) }

// AddDays suma n días a una fecha «AAAA-MM-DD».
func AddDays(date string, n int) string {
	t, err := ParseDate(date)
	if err != nil {
		return date
	}
	return FormatDate(t.AddDate(0, 0, n))
}

// DaysBetween devuelve los días de a hasta b (negativo si b es anterior).
func DaysBetween(a, b string) int {
	ta, err1 := ParseDate(a)
	tb, err2 := ParseDate(b)
	if err1 != nil || err2 != nil {
		return 0
	}
	return int(tb.Sub(ta).Round(24*time.Hour) / (24 * time.Hour))
}

// Weekday devuelve 1 = lunes … 7 = domingo.
func Weekday(date string) int {
	t, err := ParseDate(date)
	if err != nil {
		return 0
	}
	wd := int(t.Weekday())
	if wd == 0 {
		return 7
	}
	return wd
}

// MinutesOf convierte «HH:MM» en minutos desde medianoche (-1 si no es válida).
func MinutesOf(hhmm string) int {
	var h, m int
	if _, err := fmt.Sscanf(hhmm, "%d:%d", &h, &m); err != nil || h < 0 || h > 24 || m < 0 || m > 59 {
		return -1
	}
	return h*60 + m
}

// HHMM es la inversa de MinutesOf.
func HHMM(min int) string { return fmt.Sprintf("%02d:%02d", min/60, min%60) }

// occursOn indica si la serie de t tiene una ocurrencia en date.
func occursOn(t *Task, date string) bool {
	r := t.Repeat
	if r == nil {
		return t.Date == date
	}
	if date < t.Date || (r.Until != "" && date > r.Until) || slices.Contains(r.Except, date) {
		return false
	}
	n := max(1, r.Interval)
	switch r.Freq {
	case "daily":
		return DaysBetween(t.Date, date)%n == 0
	case "weekly":
		wds := r.Weekdays
		if len(wds) == 0 {
			wds = []int{Weekday(t.Date)}
		}
		if !slices.Contains(wds, Weekday(date)) {
			return false
		}
		// Semanas contadas desde el lunes de la semana de inicio
		startMonday := AddDays(t.Date, 1-Weekday(t.Date))
		return (DaysBetween(startMonday, date)/7)%n == 0
	case "monthly":
		s, d := mustDate(t.Date), mustDate(date)
		months := (d.Year()-s.Year())*12 + int(d.Month()-s.Month())
		if months%n != 0 {
			return false
		}
		// El día 31 cae el último día de los meses más cortos
		last := time.Date(d.Year(), d.Month()+1, 0, 12, 0, 0, 0, time.Local).Day()
		return d.Day() == min(s.Day(), last)
	}
	return false
}

// occurrences expande la serie t entre from y to (incluidos).
func occurrences(t *Task, from, to string) []Task {
	if t.Repeat == nil {
		if t.Date >= from && t.Date <= to {
			return []Task{*t}
		}
		return nil
	}
	start := max(from, t.Date)
	end := to
	if t.Repeat.Until != "" && t.Repeat.Until < end {
		end = t.Repeat.Until
	}
	var out []Task
	for d := start; d <= end; d = AddDays(d, 1) {
		if !occursOn(t, d) {
			continue
		}
		o := *t
		o.ID = OccurrenceID(t.ID, d)
		o.OccurrenceOf = t.ID
		o.Date = d
		o.Done = slices.Contains(t.Repeat.Done, d)
		out = append(out, o)
	}
	return out
}

// OccurrenceID identifica una ocurrencia concreta de una serie.
func OccurrenceID(seriesID, date string) string { return seriesID + "@" + date }

// SplitOccurrenceID separa «serie@fecha» (date vacío si no es una ocurrencia).
func SplitOccurrenceID(id string) (series, date string) {
	if i := strings.IndexByte(id, '@'); i > 0 {
		return id[:i], id[i+1:]
	}
	return id, ""
}
