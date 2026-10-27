package agenda

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	fsrs "github.com/open-spaced-repetition/go-fsrs/v3"

	"folio/internal/fsutil"
)

// ---------- Apuntes adjuntos ----------

const notesDir = "apuntes"

// filePath convierte la ruta guardada en un tema en una ruta absoluta, sin salir de apuntes/.
func (s *Store) filePath(rel string) string {
	clean := filepath.Clean(filepath.FromSlash(rel))
	if !strings.HasPrefix(clean, notesDir+string(filepath.Separator)) {
		return ""
	}
	return filepath.Join(s.dir, clean)
}

// FilePath devuelve la ruta absoluta de un apunte adjunto ("" si la ruta no es de apuntes/).
func (s *Store) FilePath(rel string) string { return s.filePath(rel) }

// AttachFiles copia los archivos a apuntes/ y los adjunta al tema.
func (s *Store) AttachFiles(topicID string, paths []string) (Topic, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slicesIndexTopic(s.topics, topicID)
	if i < 0 {
		return Topic{}, errors.New("tema no encontrado")
	}
	if err := os.MkdirAll(filepath.Join(s.dir, notesDir), 0o755); err != nil {
		return Topic{}, err
	}
	for _, p := range paths {
		id := newID()
		name := filepath.Base(p)
		rel := notesDir + "/" + id + "-" + safeName(name)
		size, err := copyFile(p, filepath.Join(s.dir, filepath.FromSlash(rel)))
		if err != nil {
			return Topic{}, err
		}
		s.topics[i].Files = append(s.topics[i].Files, TopicFile{ID: id, Name: name, Path: rel, Size: size, Added: s.Today()})
	}
	return s.topics[i], fsutil.WriteJSON(s.path("topics.json"), s.topics)
}

// RemoveTopicFile quita un apunte del tema y borra su copia.
func (s *Store) RemoveTopicFile(topicID, fileID string) (Topic, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slicesIndexTopic(s.topics, topicID)
	if i < 0 {
		return Topic{}, errors.New("tema no encontrado")
	}
	t := &s.topics[i]
	for j, f := range t.Files {
		if f.ID == fileID {
			_ = os.Remove(s.filePath(f.Path))
			t.Files = append(t.Files[:j:j], t.Files[j+1:]...)
			break
		}
	}
	return *t, fsutil.WriteJSON(s.path("topics.json"), s.topics)
}

func slicesIndexTopic(list []Topic, id string) int {
	for i := range list {
		if list[i].ID == id {
			return i
		}
	}
	return -1
}

func safeName(s string) string {
	s = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`\/:*?"<>|`, r) || r < 32 {
			return '-'
		}
		return r
	}, s)
	if len(s) > 120 {
		ext := filepath.Ext(s)
		s = s[:120-len(ext)] + ext
	}
	return s
}

func copyFile(src, dst string) (int64, error) {
	in, err := os.Open(src)
	if err != nil {
		return 0, err
	}
	defer in.Close()
	// Nombre oculto mientras se copia: la sincronización ignora los archivos que empiezan por «.»
	tmp := filepath.Join(filepath.Dir(dst), "."+filepath.Base(dst)+".tmp")
	out, err := os.Create(tmp)
	if err != nil {
		return 0, err
	}
	n, err := io.Copy(out, in)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(tmp)
		return 0, err
	}
	return n, os.Rename(tmp, dst)
}

// ---------- Curva del olvido ----------

// Forecast resume la memoria de un tema en una fecha: cuánto se recuerda, cómo
// cae el recuerdo si no se repasa y cuándo tocaría el siguiente repaso según
// la valoración que se dé hoy.
type Forecast struct {
	TopicID    string         `json:"topicId"`
	New        bool           `json:"new"` // aún no estudiado
	Reps       int            `json:"reps"`
	Lapses     int            `json:"lapses"`
	LastReview string         `json:"lastReview,omitempty"`
	Due        string         `json:"due,omitempty"`
	Retention  float64        `json:"retention"` // probabilidad de recordarlo en esa fecha
	Target     float64        `json:"target"`    // retención con la que se programan los repasos
	Curve      []float64      `json:"curve"`     // recuerdo estimado desde el último repaso, día a día
	CurveFrom  string         `json:"curveFrom,omitempty"`
	Next       map[int]string `json:"next"` // valoración (1–4) → fecha del siguiente repaso
}

// Forecast calcula la previsión de un tema para la fecha dada.
func (s *Store) Forecast(topicID, date string) (Forecast, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slicesIndexTopic(s.topics, topicID)
	if i < 0 {
		return Forecast{}, errors.New("tema no encontrado")
	}
	when, err := ParseDate(date)
	if err != nil {
		return Forecast{}, err
	}
	card := s.topics[i].Memory
	f := s.fsrs()
	out := Forecast{TopicID: topicID, New: card.State == fsrs.New, Reps: int(card.Reps), Lapses: int(card.Lapses), Target: s.settings.Retention, Next: map[int]string{}}
	if out.Target <= 0 {
		out.Target = fsrs.DefaultParam().RequestRetention
	}
	if !out.New {
		out.LastReview = FormatDate(card.LastReview)
		out.Due = FormatDate(card.Due)
		out.Retention = f.GetRetrievability(card, when)
		// La curva va del último repaso hasta pasada la fecha prevista (o la consultada)
		end := card.Due
		if when.After(end) {
			end = when
		}
		days := int(end.Sub(card.LastReview).Hours()/24) + 7
		days = max(14, min(days, 120))
		out.CurveFrom = out.LastReview
		for d := 0; d <= days; d++ {
			out.Curve = append(out.Curve, f.GetRetrievability(card, card.LastReview.Add(time.Duration(d)*24*time.Hour)))
		}
	}
	for r, info := range f.Repeat(card, when) {
		out.Next[int(r)] = FormatDate(info.Card.Due)
	}
	return out, nil
}
