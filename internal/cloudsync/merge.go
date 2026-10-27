package cloudsync

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Kind es el tipo de archivo del espacio de trabajo, que decide cómo se fusiona.
type Kind int

const (
	KindOther Kind = iota
	KindImmutable
	KindVersionsIndex
	KindDocMeta
	KindDocContent
	KindDocText
	KindTasks
	KindSessions
	KindTopics
	KindTypes
	KindTemplates
	KindAgendaSettings
)

var (
	reImmutable = regexp.MustCompile(`^(docs/[^/]+/(files/[^/]+|versions/[^/]+\.json\.gz)|agenda/apuntes/[^/]+)$`)
	reDocFile   = regexp.MustCompile(`^docs/([^/]+)/(meta\.json|content\.json|content\.txt|versions/index\.json)$`)
	reTasks     = regexp.MustCompile(`^agenda/tasks/[^/]+\.json$`)
	reSessions  = regexp.MustCompile(`^agenda/sessions/[^/]+\.jsonl$`)
)

// Classify devuelve el tipo de un archivo según su ruta relativa.
func Classify(path string) Kind {
	switch {
	case reImmutable.MatchString(path):
		return KindImmutable
	case reTasks.MatchString(path):
		return KindTasks
	case reSessions.MatchString(path):
		return KindSessions
	case path == "agenda/topics.json":
		return KindTopics
	case path == "agenda/types.json":
		return KindTypes
	case path == "agenda/templates.json":
		return KindTemplates
	case path == "agenda/settings.json":
		return KindAgendaSettings
	}
	if m := reDocFile.FindStringSubmatch(path); m != nil {
		switch m[2] {
		case "meta.json":
			return KindDocMeta
		case "content.json":
			return KindDocContent
		case "content.txt":
			return KindDocText
		default:
			return KindVersionsIndex
		}
	}
	return KindOther
}

// NeedsBase indica si de ese archivo se guarda una copia de la última versión
// sincronizada (hace falta para fusionar a tres bandas).
func NeedsBase(path string) bool {
	switch Classify(path) {
	case KindVersionsIndex, KindDocMeta, KindTasks, KindSessions, KindTopics, KindTypes, KindTemplates, KindAgendaSettings:
		return true
	}
	return false
}

// DocID devuelve el identificador del documento al que pertenece una ruta ("" si no es de un documento).
func DocID(path string) string {
	parts := strings.Split(path, "/")
	if len(parts) >= 3 && parts[0] == "docs" {
		return parts[1]
	}
	return ""
}

// MergeInput son los tres lados de una fusión.
type MergeInput struct {
	Path                string
	Base, Local, Remote []byte    // Base es nil si nunca se ha sincronizado
	LocalMod, RemoteMod time.Time // última modificación de cada lado
	Device              string    // nombre de este dispositivo (para etiquetar conflictos)
	Now                 time.Time
}

// Extra es un efecto adicional de una fusión que debe aplicar quien llama.
type Extra struct {
	Kind  string // "version": guardar Data como versión del documento DocID; "file": escribir Data en Path
	DocID string
	Path  string
	Data  []byte
	Label string
}

// Merge fusiona los dos lados de un archivo que han cambiado a la vez.
func Merge(in MergeInput) ([]byte, []Extra, error) {
	switch Classify(in.Path) {
	case KindImmutable:
		// El nombre es el hash del contenido: da igual cuál se quede
		return in.Local, nil, nil
	case KindVersionsIndex:
		return mergeJSONArray(in, "id", func(o map[string]any) string { return str(o["created"]) }, mergeOpts{prefer: preferLocal}, false)
	case KindDocMeta:
		return mergeJSONObject(in, preferByUpdated(in, "meta"), true)
	case KindDocContent, KindDocText:
		return mergeWholeFile(in)
	case KindTasks:
		return mergeJSONArray(in, "id", func(o map[string]any) string {
			return str(o["date"]) + " " + str(o["start"]) + " " + str(o["id"])
		}, taskOpts(), true)
	case KindSessions:
		return mergeJSONLines(in)
	case KindTopics:
		return mergeJSONArray(in, "id", nil, topicOpts(), true)
	case KindTypes:
		return mergeJSONArray(in, "id", nil, mergeOpts{prefer: preferLocal}, true)
	case KindTemplates:
		return mergeJSONArray(in, "id", nil, mergeOpts{prefer: preferLocal}, true)
	case KindAgendaSettings:
		return mergeJSONObject(in, mergeOpts{prefer: preferNewerFile(in)}, true)
	}
	return mergeWholeFile(in)
}

// ---------- Archivos completos: gana el más reciente, el otro se conserva ----------

func mergeWholeFile(in MergeInput) ([]byte, []Extra, error) {
	localWins := !in.RemoteMod.After(in.LocalMod) // empate: gana el local
	winner, loser := in.Local, in.Remote
	loserName := "otro dispositivo"
	if !localWins {
		winner, loser = in.Remote, in.Local
		loserName = in.Device
		if loserName == "" {
			loserName = "este dispositivo"
		}
	}
	if bytes.Equal(winner, loser) {
		return winner, nil, nil
	}
	switch Classify(in.Path) {
	case KindDocContent:
		label := fmt.Sprintf("Conflicto · versión de %s (%s)", loserName, in.Now.Format("2/1/2006 15:04"))
		return winner, []Extra{{Kind: "version", DocID: DocID(in.Path), Path: in.Path, Data: loser, Label: label}}, nil
	case KindDocText:
		return winner, nil, nil // acompaña a content.json
	}
	ext := ""
	name := in.Path
	if i := strings.LastIndex(name, "."); i > strings.LastIndex(name, "/") {
		ext = name[i:]
		name = name[:i]
	}
	copyPath := fmt.Sprintf("%s (conflicto %s)%s", name, loserName, ext)
	return winner, []Extra{{Kind: "file", Path: copyPath, Data: loser}}, nil
}

// ---------- JSON: fusión a tres bandas campo a campo ----------

type side int

const (
	sideLocal side = iota
	sideRemote
)

type mergeOpts struct {
	// prefer decide qué lado gana cuando los dos han cambiado el mismo valor.
	prefer func(l, r any) side
	// rules son reglas especiales por nombre de campo.
	rules map[string]func(b, l, r any) (any, bool)
}

func preferLocal(_, _ any) side { return sideLocal }

func preferNewerFile(in MergeInput) func(l, r any) side {
	return func(_, _ any) side {
		if in.RemoteMod.After(in.LocalMod) {
			return sideRemote
		}
		return sideLocal
	}
}

// preferByUpdated compara el campo «updated» de un objeto (o de su sección `section`).
func preferByUpdated(in MergeInput, section string) mergeOpts {
	pick := func(raw []byte) time.Time {
		v, _ := decodeJSON(raw)
		m, _ := v.(map[string]any)
		if section != "" {
			m, _ = m[section].(map[string]any)
		}
		return parseTime(str(m["updated"]))
	}
	lt, rt := pick(in.Local), pick(in.Remote)
	return mergeOpts{prefer: func(_, _ any) side {
		if rt.After(lt) {
			return sideRemote
		}
		return sideLocal
	}, rules: map[string]func(b, l, r any) (any, bool){"updated": laterTime}}
}

func taskOpts() mergeOpts {
	return mergeOpts{rules: map[string]func(b, l, r any) (any, bool){
		"except":  mergeStringSets,
		"done":    mergeStringSets, // en la serie es una lista de fechas; en la tarea, un booleano
		"updated": laterTime,
	}}
}

func topicOpts() mergeOpts {
	return mergeOpts{prefer: preferLocal, rules: map[string]func(b, l, r any) (any, bool){
		"memory":  freshestMemory,
		"studied": earliestDate,
	}}
}

func laterTime(_, l, r any) (any, bool) {
	if parseTime(str(r)).After(parseTime(str(l))) {
		return r, true
	}
	return l, true
}

func earliestDate(_, l, r any) (any, bool) {
	ls, rs := str(l), str(r)
	switch {
	case ls == "":
		return r, true
	case rs == "" || ls <= rs:
		return l, true
	}
	return r, true
}

// freshestMemory elige el estado de memoria (FSRS) con el repaso más reciente; a igualdad, el de más repasos.
func freshestMemory(_, l, r any) (any, bool) {
	lm, _ := l.(map[string]any)
	rm, _ := r.(map[string]any)
	lt, rt := parseTime(str(lm["LastReview"])), parseTime(str(rm["LastReview"]))
	switch {
	case rt.After(lt):
		return r, true
	case lt.After(rt):
		return l, true
	}
	if num(rm["Reps"]) > num(lm["Reps"]) {
		return r, true
	}
	return l, true
}

// mergeStringSets fusiona listas de cadenas como conjuntos a tres bandas:
// se conserva lo que sigue en los dos lados y lo que cada lado ha añadido.
func mergeStringSets(b, l, r any) (any, bool) {
	toSet := func(v any) (map[string]bool, bool) {
		out := map[string]bool{}
		if v == nil {
			return out, true
		}
		arr, ok := v.([]any)
		if !ok {
			return nil, false
		}
		for _, x := range arr {
			s, ok := x.(string)
			if !ok {
				return nil, false
			}
			out[s] = true
		}
		return out, true
	}
	bs, ok1 := toSet(b)
	ls, ok2 := toSet(l)
	rs, ok3 := toSet(r)
	if !ok1 || !ok2 || !ok3 {
		return nil, false // no son listas de cadenas: se usa la regla general
	}
	set := map[string]bool{}
	for s := range ls {
		if rs[s] || !bs[s] {
			set[s] = true
		}
	}
	for s := range rs {
		if ls[s] || !bs[s] {
			set[s] = true
		}
	}
	out := make([]any, 0, len(set))
	for s := range set {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].(string) < out[j].(string) })
	return out, true
}

// merge3 fusiona tres valores JSON: lo que no ha cambiado en un lado se toma del otro;
// los objetos se fusionan campo a campo; un conflicto real lo decide opts.
func merge3(b, l, r any, o mergeOpts, key string) any {
	if reflect.DeepEqual(l, r) {
		return l
	}
	if rule, ok := o.rules[key]; ok {
		if v, handled := rule(b, l, r); handled {
			return v
		}
	}
	if reflect.DeepEqual(l, b) {
		return r
	}
	if reflect.DeepEqual(r, b) {
		return l
	}
	lm, lok := l.(map[string]any)
	rm, rok := r.(map[string]any)
	if lok && rok {
		bm, _ := b.(map[string]any)
		out := map[string]any{}
		keys := map[string]bool{}
		for k := range lm {
			keys[k] = true
		}
		for k := range rm {
			keys[k] = true
		}
		for k := range keys {
			lv, lhas := lm[k]
			rv, rhas := rm[k]
			bv, bhas := bm[k]
			switch {
			case lhas && rhas:
				out[k] = merge3(bv, lv, rv, o, k)
			case lhas: // el otro lado lo ha quitado
				if bhas && reflect.DeepEqual(lv, bv) {
					continue
				}
				out[k] = lv
			default:
				if bhas && reflect.DeepEqual(rv, bv) {
					continue
				}
				out[k] = rv
			}
		}
		return out
	}
	if o.prefer != nil && o.prefer(l, r) == sideRemote {
		return r
	}
	return l
}

// mergeByID fusiona listas de objetos identificados por `idKey`.
func mergeByID(b, l, r []any, idKey string, o mergeOpts) []any {
	index := func(list []any) (map[string]map[string]any, []string) {
		m := map[string]map[string]any{}
		var order []string
		for _, x := range list {
			obj, ok := x.(map[string]any)
			if !ok {
				continue
			}
			id := str(obj[idKey])
			if _, dup := m[id]; !dup {
				order = append(order, id)
			}
			m[id] = obj
		}
		return m, order
	}
	bm, _ := index(b)
	lm, lorder := index(l)
	rm, rorder := index(r)
	var out []any
	seen := map[string]bool{}
	emit := func(id string) {
		if seen[id] {
			return
		}
		seen[id] = true
		lv, lhas := lm[id]
		rv, rhas := rm[id]
		bv, bhas := bm[id]
		switch {
		case lhas && rhas:
			oo := o
			if o.prefer == nil {
				// Gana la modificación más reciente de la propia tarea
				lu, ru := parseTime(str(lv["updated"])), parseTime(str(rv["updated"]))
				oo.prefer = func(_, _ any) side {
					if ru.After(lu) {
						return sideRemote
					}
					return sideLocal
				}
			}
			var base any
			if bhas {
				base = bv
			}
			out = append(out, merge3(base, lv, rv, oo, ""))
		case lhas:
			if bhas && reflect.DeepEqual(lv, bv) {
				return // el otro lado lo ha borrado y aquí no se tocó
			}
			out = append(out, lv)
		case rhas:
			if bhas && reflect.DeepEqual(rv, bv) {
				return
			}
			out = append(out, rv)
		}
	}
	for _, id := range lorder {
		emit(id)
	}
	for _, id := range rorder {
		emit(id)
	}
	return out
}

func mergeJSONArray(in MergeInput, idKey string, sortKey func(map[string]any) string, o mergeOpts, indent bool) ([]byte, []Extra, error) {
	b, l, r, err := decodeThree[[]any](in)
	if err != nil {
		return nil, nil, err
	}
	merged := mergeByID(b, l, r, idKey, o)
	if sortKey != nil {
		sort.SliceStable(merged, func(i, j int) bool {
			return sortKey(merged[i].(map[string]any)) < sortKey(merged[j].(map[string]any))
		})
	}
	return encodeJSON(merged, indent), nil, nil
}

func mergeJSONObject(in MergeInput, o mergeOpts, indent bool) ([]byte, []Extra, error) {
	b, l, r, err := decodeThree[map[string]any](in)
	if err != nil {
		return nil, nil, err
	}
	var base any
	if b != nil {
		base = b
	}
	return encodeJSON(merge3(base, l, r, o, ""), indent), nil, nil
}

// mergeJSONLines fusiona archivos de una línea JSON por registro (las sesiones).
func mergeJSONLines(in MergeInput) ([]byte, []Extra, error) {
	parse := func(raw []byte) ([]any, error) {
		var out []any
		for _, line := range bytes.Split(raw, []byte("\n")) {
			if len(bytes.TrimSpace(line)) == 0 {
				continue
			}
			v, err := decodeJSON(line)
			if err != nil {
				return nil, err
			}
			out = append(out, v)
		}
		return out, nil
	}
	b, err1 := parse(in.Base)
	l, err2 := parse(in.Local)
	r, err3 := parse(in.Remote)
	if err1 != nil || err2 != nil || err3 != nil {
		return nil, nil, fmt.Errorf("%s no es un archivo de líneas JSON válido", in.Path)
	}
	merged := mergeByID(b, l, r, "id", mergeOpts{prefer: preferLocal})
	sort.SliceStable(merged, func(i, j int) bool {
		a, c := merged[i].(map[string]any), merged[j].(map[string]any)
		return str(a["date"])+str(a["id"]) < str(c["date"])+str(c["id"])
	})
	var buf bytes.Buffer
	for _, v := range merged {
		line, _ := json.Marshal(v)
		buf.Write(line)
		buf.WriteByte('\n')
	}
	return buf.Bytes(), nil, nil
}

// ---------- Utilidades ----------

func decodeJSON(raw []byte) (any, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil, nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber() // los números no pasan por float64: no cambian al volver a escribirlos
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	return v, nil
}

func decodeThree[T any](in MergeInput) (b, l, r T, err error) {
	for i, raw := range [][]byte{in.Base, in.Local, in.Remote} {
		v, derr := decodeJSON(raw)
		if derr != nil {
			err = fmt.Errorf("%s no es un JSON válido: %w", in.Path, derr)
			return
		}
		t, _ := v.(T)
		switch i {
		case 0:
			b = t
		case 1:
			l = t
		default:
			r = t
		}
	}
	return
}

func encodeJSON(v any, indent bool) []byte {
	var out []byte
	if indent {
		out, _ = json.MarshalIndent(v, "", "  ")
	} else {
		out, _ = json.Marshal(v)
	}
	return out
}

func str(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case json.Number:
		return x.String()
	case nil:
		return ""
	}
	return fmt.Sprint(v)
}

func num(v any) float64 {
	if n, ok := v.(json.Number); ok {
		f, _ := n.Float64()
		return f
	}
	return 0
}

func parseTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return time.Time{}
	}
	return t
}
