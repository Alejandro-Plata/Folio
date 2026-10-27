package social

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"folio/internal/fsutil"
)

// Secrets guarda el token de renovación en el almacén seguro de la plataforma
// (llavero del sistema o EncryptedSharedPreferences). Nunca va a los ajustes.
type Secrets interface {
	Get(key string) (string, error)
	Set(key, value string) error
	Delete(key string) error
}

const secretKey = "supabase-refresh"

// Ventana de eventos que se descarga y se guarda en caché.
const (
	pastDays   = 60
	futureDays = 400
)

// Service es la parte compartida de Folio.
type Service struct {
	c       *client
	secrets Secrets
	dir     string // caché
	now     func() time.Time

	mu       sync.Mutex
	snap     Snapshot
	verifier string // del inicio de sesión con Google en curso
}

// New prepara el servicio y carga la caché. Si no hay URL ni clave, todo
// responde «sin configurar».
func New(cacheDir string, secrets Secrets) *Service {
	s := &Service{secrets: secrets, dir: cacheDir, now: time.Now}
	if URL != "" && Key != "" {
		s.c = newClient(URL, Key)
		s.c.onRefresh = s.saveRefresh
	}
	_ = fsutil.ReadJSON(s.cachePath(), &s.snap)
	s.snap.Configured = s.c != nil
	s.snap.SignedIn = false // hasta que Restore lo confirme
	return s
}

func (s *Service) cachePath() string { return filepath.Join(s.dir, "social.json") }

func (s *Service) saveRefresh(token string) {
	if s.secrets != nil && token != "" {
		_ = s.secrets.Set(secretKey, token)
	}
}

func (s *Service) ready() error {
	if s.c == nil {
		return errors.New("las cuentas no están configuradas en esta copia de Folio")
	}
	return nil
}

// Snapshot devuelve lo que hay en memoria (o en caché, sin conexión).
func (s *Service) Snapshot() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.snap
	out.Configured = s.c != nil
	out.SignedIn = s.c != nil && s.c.user() != nil
	return out
}

// Restore abre la sesión guardada (al arrancar). Sin conexión se queda con la caché.
func (s *Service) Restore(ctx context.Context) (Snapshot, error) {
	if s.c == nil || s.secrets == nil {
		return s.Snapshot(), nil
	}
	tok, err := s.secrets.Get(secretKey)
	if err != nil || tok == "" {
		return s.Snapshot(), nil
	}
	if err := s.c.restore(ctx, tok); err != nil {
		var ae *apiError
		if errors.As(err, &ae) {
			// Token revocado o caducado: se cierra la sesión local
			s.forget()
		}
		return s.Snapshot(), err
	}
	return s.Refresh(ctx)
}

func (s *Service) forget() {
	if s.secrets != nil {
		_ = s.secrets.Delete(secretKey)
	}
	s.mu.Lock()
	s.snap = Snapshot{Configured: s.c != nil}
	s.mu.Unlock()
	_ = os.Remove(s.cachePath())
}

// ---------- Cuenta ----------

func (s *Service) SignIn(ctx context.Context, email, password string) (Snapshot, error) {
	if err := s.ready(); err != nil {
		return Snapshot{}, err
	}
	if err := s.c.signIn(ctx, email, password); err != nil {
		return s.Snapshot(), err
	}
	return s.Refresh(ctx)
}

// SignUp crea la cuenta; needsConfirm indica que hay que confirmar el correo antes de entrar.
func (s *Service) SignUp(ctx context.Context, email, password, name string) (needsConfirm bool, snap Snapshot, err error) {
	if err := s.ready(); err != nil {
		return false, Snapshot{}, err
	}
	if len(password) < 8 {
		return false, s.Snapshot(), errors.New("la contraseña debe tener al menos 8 caracteres")
	}
	needs, err := s.c.signUp(ctx, email, password, name)
	if err != nil || needs {
		return needs, s.Snapshot(), err
	}
	snap, err = s.Refresh(ctx)
	return false, snap, err
}

func (s *Service) Recover(ctx context.Context, email string) error {
	if err := s.ready(); err != nil {
		return err
	}
	return s.c.recover(ctx, email)
}

// GoogleURL prepara el inicio de sesión con Google: devuelve la página que hay
// que abrir en el navegador; al volver a redirect con ?code=, se llama a GoogleFinish.
func (s *Service) GoogleURL(redirect string) (string, error) {
	if err := s.ready(); err != nil {
		return "", err
	}
	v := newVerifier()
	s.mu.Lock()
	s.verifier = v
	s.mu.Unlock()
	return s.c.googleURL(redirect, v), nil
}

func (s *Service) GoogleFinish(ctx context.Context, code string) (Snapshot, error) {
	if err := s.ready(); err != nil {
		return Snapshot{}, err
	}
	s.mu.Lock()
	v := s.verifier
	s.verifier = ""
	s.mu.Unlock()
	if v == "" {
		return s.Snapshot(), errors.New("el inicio de sesión con Google ha caducado; vuelve a intentarlo")
	}
	if err := s.c.exchange(ctx, code, v); err != nil {
		return s.Snapshot(), err
	}
	return s.Refresh(ctx)
}

func (s *Service) SignOut(ctx context.Context) {
	if s.c != nil {
		s.c.signOut(ctx)
	}
	s.forget()
}

func (s *Service) UpdateProfile(ctx context.Context, name, color string) (Snapshot, error) {
	u, err := s.me()
	if err != nil {
		return Snapshot{}, err
	}
	body := map[string]string{"name": strings.TrimSpace(name)}
	if color != "" {
		body["color"] = color
	}
	if err := s.c.patch(ctx, "profiles?id=eq."+u.ID, body, nil); err != nil {
		return s.Snapshot(), err
	}
	return s.Refresh(ctx)
}

func (s *Service) DeleteAccount(ctx context.Context) error {
	if _, err := s.me(); err != nil {
		return err
	}
	if err := s.c.rpc(ctx, "delete_my_account", nil, nil); err != nil {
		return err
	}
	s.c.clear()
	s.forget()
	return nil
}

func (s *Service) me() (*User, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	u := s.c.user()
	if u == nil {
		return nil, ErrNotSignedIn
	}
	return u, nil
}

// ---------- Descarga ----------

// Refresh descarga perfil, círculos, eventos y citas y los guarda en caché.
func (s *Service) Refresh(ctx context.Context) (Snapshot, error) {
	u, err := s.me()
	if err != nil {
		return s.Snapshot(), err
	}
	today := s.now()
	from := today.AddDate(0, 0, -pastDays).Format("2006-01-02")
	to := today.AddDate(0, 0, futureDays).Format("2006-01-02")
	var (
		profiles  []Profile
		circles   []Circle
		events    []Event
		proposals []Proposal
	)
	if err := s.c.get(ctx, "profiles?select=id,name,email,color&id=eq."+u.ID, &profiles); err != nil {
		return s.markError(err)
	}
	if err := s.c.get(ctx, "circles?select=id,name,kind,color,owner,created_at,circle_members(user_id,role,joined_at,profiles(id,name,email,color))&order=created_at", &circles); err != nil {
		return s.markError(err)
	}
	if err := s.c.get(ctx, "shared_events?select=*&date=gte."+from+"&date=lte."+to+"&order=date,start", &events); err != nil {
		return s.markError(err)
	}
	since := today.AddDate(0, 0, -30).UTC().Format(time.RFC3339)
	if err := s.c.get(ctx, "date_proposals?select=*,date_options(*)&or=(status.eq.open,updated_at.gte."+url.QueryEscape(since)+")&order=created_at.desc", &proposals); err != nil {
		return s.markError(err)
	}
	for i := range circles {
		sort.Slice(circles[i].Members, func(a, b int) bool { return circles[i].Members[a].JoinedAt < circles[i].Members[b].JoinedAt })
	}
	for i := range proposals {
		sort.Slice(proposals[i].Options, func(a, b int) bool { return proposals[i].Options[a].CreatedAt < proposals[i].Options[b].CreatedAt })
	}
	s.mu.Lock()
	s.snap = Snapshot{Configured: true, SignedIn: true, User: u, Circles: circles, Events: events, Proposals: proposals, LastSync: s.now()}
	if len(profiles) == 1 {
		s.snap.Profile = &profiles[0]
	}
	snap := s.snap
	s.mu.Unlock()
	_ = os.MkdirAll(s.dir, 0o755)
	_ = fsutil.WriteJSON(s.cachePath(), snap)
	return snap, nil
}

func (s *Service) markError(err error) (Snapshot, error) {
	s.mu.Lock()
	s.snap.Error = err.Error()
	s.mu.Unlock()
	return s.Snapshot(), err
}

// Events devuelve los eventos compartidos de la caché entre dos fechas.
func (s *Service) Events(from, to string) []Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []Event
	for _, e := range s.snap.Events {
		if e.Date >= from && e.Date <= to {
			out = append(out, e)
		}
	}
	return out
}

// Circle busca un círculo en la caché.
func (s *Service) Circle(id string) *Circle {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.snap.Circles {
		if s.snap.Circles[i].ID == id {
			c := s.snap.Circles[i]
			return &c
		}
	}
	return nil
}

// Me es el identificador de la persona con sesión ("" sin sesión).
func (s *Service) Me() string {
	if s.c == nil {
		return ""
	}
	if u := s.c.user(); u != nil {
		return u.ID
	}
	return ""
}

// ---------- Círculos ----------

func (s *Service) CreateCircle(ctx context.Context, name, kind, color string) (Snapshot, error) {
	if _, err := s.me(); err != nil {
		return Snapshot{}, err
	}
	if kind != "friends" && kind != "couple" {
		return s.Snapshot(), errors.New("tipo de círculo no válido")
	}
	body := map[string]string{"name": strings.TrimSpace(name), "kind": kind}
	if color != "" {
		body["color"] = color
	}
	if err := s.c.insert(ctx, "circles", body, nil); err != nil {
		return s.Snapshot(), err
	}
	return s.Refresh(ctx)
}

func (s *Service) UpdateCircle(ctx context.Context, id, name, color string) (Snapshot, error) {
	if _, err := s.me(); err != nil {
		return Snapshot{}, err
	}
	if err := s.c.patch(ctx, "circles?id=eq."+id, map[string]string{"name": strings.TrimSpace(name), "color": color}, nil); err != nil {
		return s.Snapshot(), err
	}
	return s.Refresh(ctx)
}

func (s *Service) DeleteCircle(ctx context.Context, id string) (Snapshot, error) {
	if _, err := s.me(); err != nil {
		return Snapshot{}, err
	}
	if err := s.c.remove(ctx, "circles?id=eq."+id); err != nil {
		return s.Snapshot(), err
	}
	return s.Refresh(ctx)
}

func (s *Service) Invite(ctx context.Context, circleID string) (string, error) {
	if _, err := s.me(); err != nil {
		return "", err
	}
	var code string
	err := s.c.rpc(ctx, "create_invite", map[string]string{"c": circleID}, &code)
	return code, err
}

func (s *Service) Join(ctx context.Context, code string) (Snapshot, error) {
	if _, err := s.me(); err != nil {
		return Snapshot{}, err
	}
	if err := s.c.rpc(ctx, "join_circle", map[string]string{"invite": code}, nil); err != nil {
		return s.Snapshot(), err
	}
	return s.Refresh(ctx)
}

func (s *Service) Leave(ctx context.Context, circleID string) (Snapshot, error) {
	if _, err := s.me(); err != nil {
		return Snapshot{}, err
	}
	if err := s.c.rpc(ctx, "leave_circle", map[string]string{"c": circleID}, nil); err != nil {
		return s.Snapshot(), err
	}
	return s.Refresh(ctx)
}

func (s *Service) RemoveMember(ctx context.Context, circleID, userID string) (Snapshot, error) {
	if _, err := s.me(); err != nil {
		return Snapshot{}, err
	}
	if err := s.c.rpc(ctx, "remove_member", map[string]string{"c": circleID, "member": userID}, nil); err != nil {
		return s.Snapshot(), err
	}
	return s.Refresh(ctx)
}

// ---------- Eventos ----------

// SaveEvent crea (sin ID) o modifica un evento compartido.
func (s *Service) SaveEvent(ctx context.Context, e Event) (Event, error) {
	u, err := s.me()
	if err != nil {
		return Event{}, err
	}
	if strings.TrimSpace(e.Title) == "" {
		return Event{}, errors.New("el evento necesita un título")
	}
	if e.Start != nil && *e.Start == "" {
		e.Start = nil
	}
	body := map[string]any{"circle_id": e.CircleID, "title": strings.TrimSpace(e.Title), "notes": e.Notes, "date": e.Date, "start": e.Start, "minutes": e.Minutes}
	var out []Event
	if e.ID == "" {
		body["created_by"] = u.ID
		err = s.c.insert(ctx, "shared_events", body, &out)
	} else {
		err = s.c.patch(ctx, "shared_events?id=eq."+e.ID, body, &out)
	}
	if err != nil {
		return Event{}, err
	}
	if len(out) != 1 {
		return Event{}, errors.New("no tienes permiso para cambiar ese evento")
	}
	s.upsertCached(out[0])
	return out[0], nil
}

func (s *Service) DeleteEvent(ctx context.Context, id string) error {
	if _, err := s.me(); err != nil {
		return err
	}
	if err := s.c.remove(ctx, "shared_events?id=eq."+id); err != nil {
		return err
	}
	s.mu.Lock()
	for i, e := range s.snap.Events {
		if e.ID == id {
			s.snap.Events = append(s.snap.Events[:i:i], s.snap.Events[i+1:]...)
			break
		}
	}
	s.mu.Unlock()
	return nil
}

func (s *Service) upsertCached(e Event) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.snap.Events {
		if s.snap.Events[i].ID == e.ID {
			s.snap.Events[i] = e
			return
		}
	}
	s.snap.Events = append(s.snap.Events, e)
}

// ---------- Citas ----------

// ProposeDate propone una cita con una o varias opciones de día y hora.
func (s *Service) ProposeDate(ctx context.Context, circleID, title, notes string, options []Option) (Snapshot, error) {
	u, err := s.me()
	if err != nil {
		return Snapshot{}, err
	}
	if len(options) == 0 {
		return s.Snapshot(), errors.New("propón al menos un día")
	}
	if c := s.Circle(circleID); c != nil && c.Kind != "couple" {
		return s.Snapshot(), errors.New("las citas son para círculos de pareja")
	}
	if strings.TrimSpace(title) == "" {
		title = "Cita"
	}
	var created []Proposal
	if err := s.c.insert(ctx, "date_proposals", map[string]string{"circle_id": circleID, "title": strings.TrimSpace(title), "notes": notes, "proposed_by": u.ID}, &created); err != nil {
		return s.Snapshot(), err
	}
	if len(created) != 1 {
		return s.Snapshot(), errors.New("no se ha podido crear la cita")
	}
	if err := s.addOptions(ctx, created[0].ID, u.ID, options); err != nil {
		_ = s.c.remove(ctx, "date_proposals?id=eq."+created[0].ID)
		return s.Snapshot(), err
	}
	return s.Refresh(ctx)
}

// Counter añade otras opciones a una cita abierta («¿y si mejor…?»).
func (s *Service) Counter(ctx context.Context, proposalID string, options []Option) (Snapshot, error) {
	u, err := s.me()
	if err != nil {
		return Snapshot{}, err
	}
	if len(options) == 0 {
		return s.Snapshot(), errors.New("propón al menos un día")
	}
	if err := s.addOptions(ctx, proposalID, u.ID, options); err != nil {
		return s.Snapshot(), err
	}
	return s.Refresh(ctx)
}

func (s *Service) addOptions(ctx context.Context, proposalID, me string, options []Option) error {
	rows := make([]map[string]any, 0, len(options))
	for _, o := range options {
		if o.Date == "" {
			return errors.New("cada opción necesita un día")
		}
		if o.Start != nil && *o.Start == "" {
			o.Start = nil
		}
		if o.Minutes <= 0 {
			o.Minutes = 120
		}
		rows = append(rows, map[string]any{"proposal_id": proposalID, "date": o.Date, "start": o.Start, "minutes": o.Minutes, "proposed_by": me})
	}
	return s.c.insert(ctx, "date_options", rows, nil)
}

// Accept elige una opción: se crea el evento en el círculo de pareja.
func (s *Service) Accept(ctx context.Context, optionID string) (Snapshot, error) {
	if _, err := s.me(); err != nil {
		return Snapshot{}, err
	}
	if err := s.c.rpc(ctx, "accept_date", map[string]string{"option_id": optionID}, nil); err != nil {
		return s.Snapshot(), err
	}
	return s.Refresh(ctx)
}

// Close rechaza (quien la recibe) o anula (quien la propuso) una cita abierta.
func (s *Service) Close(ctx context.Context, proposalID, status string) (Snapshot, error) {
	if _, err := s.me(); err != nil {
		return Snapshot{}, err
	}
	if status != "declined" && status != "cancelled" {
		return s.Snapshot(), fmt.Errorf("estado no válido: %s", status)
	}
	if err := s.c.patch(ctx, "date_proposals?id=eq."+proposalID, map[string]string{"status": status}, nil); err != nil {
		return s.Snapshot(), err
	}
	return s.Refresh(ctx)
}
