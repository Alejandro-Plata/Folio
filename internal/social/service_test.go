package social

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// memSecrets es un almacén de secretos en memoria.
type memSecrets struct {
	mu sync.Mutex
	m  map[string]string
}

func (m *memSecrets) Get(k string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.m[k], nil
}
func (m *memSecrets) Set(k, v string) error { m.mu.Lock(); defer m.mu.Unlock(); m.m[k] = v; return nil }
func (m *memSecrets) Delete(k string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.m, k)
	return nil
}

// fakeSupabase imita lo justo de GoTrue y PostgREST para un usuario.
type fakeSupabase struct {
	t         *testing.T
	mu        sync.Mutex
	refreshN  int
	expiresIn int
	confirm   bool // signup sin sesión (pide confirmar el correo)
	circles   []map[string]any
	events    []map[string]any
	proposals []map[string]any
	options   []map[string]any
	calls     []string
	verifier  string
}

func (f *fakeSupabase) tokens(w http.ResponseWriter) {
	f.refreshN++
	_ = json.NewEncoder(w).Encode(map[string]any{
		"access_token": fmt.Sprintf("acc-%d", f.refreshN), "refresh_token": fmt.Sprintf("ref-%d", f.refreshN),
		"expires_in": f.expiresIn, "user": map[string]string{"id": "u1", "email": "ana@example.com"},
	})
}

func (f *fakeSupabase) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if r.Header.Get("apikey") != "clave-publica" {
		w.WriteHeader(401)
		return
	}
	body, _ := io.ReadAll(r.Body)
	var in map[string]any
	_ = json.Unmarshal(body, &in)
	f.calls = append(f.calls, r.Method+" "+r.URL.Path)
	authed := strings.HasPrefix(r.Header.Get("Authorization"), "Bearer acc-")
	switch {
	case r.URL.Path == "/auth/v1/token":
		switch r.URL.Query().Get("grant_type") {
		case "password":
			if in["password"] != "contraseña-buena" {
				w.WriteHeader(400)
				_, _ = w.Write([]byte(`{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}`))
				return
			}
		case "refresh_token":
			if in["refresh_token"] != fmt.Sprintf("ref-%d", f.refreshN) {
				w.WriteHeader(400)
				_, _ = w.Write([]byte(`{"error_code":"refresh_token_not_found","msg":"Invalid Refresh Token"}`))
				return
			}
		case "pkce":
			if in["auth_code"] != "codigo-google" || challenge(in["code_verifier"].(string)) != f.verifier {
				w.WriteHeader(400)
				_, _ = w.Write([]byte(`{"error_code":"bad_code_verifier"}`))
				return
			}
		}
		f.tokens(w)
	case r.URL.Path == "/auth/v1/signup":
		if f.confirm {
			_, _ = w.Write([]byte(`{"id":"u1","email":"ana@example.com"}`))
			return
		}
		f.tokens(w)
	case r.URL.Path == "/auth/v1/recover", r.URL.Path == "/auth/v1/logout":
		w.WriteHeader(200)
	case !authed:
		w.WriteHeader(401)
		_, _ = w.Write([]byte(`{"message":"JWT expired"}`))
	case r.URL.Path == "/rest/v1/profiles":
		_, _ = w.Write([]byte(`[{"id":"u1","name":"Ana","email":"ana@example.com","color":"#2f74c0"}]`))
	case r.URL.Path == "/rest/v1/circles" && r.Method == "GET":
		_ = json.NewEncoder(w).Encode(f.circles)
	case r.URL.Path == "/rest/v1/circles" && r.Method == "POST":
		c := map[string]any{"id": fmt.Sprintf("c%d", len(f.circles)+1), "name": in["name"], "kind": in["kind"], "color": "#7d3c98", "owner": "u1",
			"circle_members": []map[string]any{{"user_id": "u1", "role": "owner", "joined_at": "2026-10-27", "profiles": map[string]string{"id": "u1", "name": "Ana"}}}}
		f.circles = append(f.circles, c)
		_ = json.NewEncoder(w).Encode([]any{c})
	case r.URL.Path == "/rest/v1/rpc/join_circle":
		c := f.circles[0]
		c["circle_members"] = append(c["circle_members"].([]map[string]any), map[string]any{"user_id": "u2", "role": "member", "joined_at": "2026-10-28", "profiles": map[string]string{"id": "u2", "name": "Luis"}})
		_, _ = w.Write([]byte(`"c1"`))
	case r.URL.Path == "/rest/v1/rpc/create_invite":
		_, _ = w.Write([]byte(`"ABCD2345"`))
	case r.URL.Path == "/rest/v1/shared_events" && r.Method == "GET":
		_ = json.NewEncoder(w).Encode(f.events)
	case r.URL.Path == "/rest/v1/shared_events" && r.Method == "POST":
		in["id"] = fmt.Sprintf("e%d", len(f.events)+1)
		f.events = append(f.events, in)
		_ = json.NewEncoder(w).Encode([]any{in})
	case r.URL.Path == "/rest/v1/shared_events" && r.Method == "PATCH":
		id := strings.TrimPrefix(r.URL.Query().Get("id"), "eq.")
		for _, e := range f.events {
			if e["id"] == id {
				for k, v := range in {
					e[k] = v
				}
				_ = json.NewEncoder(w).Encode([]any{e})
				return
			}
		}
		_, _ = w.Write([]byte(`[]`))
	case r.URL.Path == "/rest/v1/date_proposals" && r.Method == "GET":
		out := []map[string]any{}
		for _, p := range f.proposals {
			q := map[string]any{}
			for k, v := range p {
				q[k] = v
			}
			opts := []map[string]any{}
			for _, o := range f.options {
				if o["proposal_id"] == p["id"] {
					opts = append(opts, o)
				}
			}
			q["date_options"] = opts
			out = append(out, q)
		}
		_ = json.NewEncoder(w).Encode(out)
	case r.URL.Path == "/rest/v1/date_proposals" && r.Method == "POST":
		in["id"] = "p1"
		in["status"] = "open"
		f.proposals = append(f.proposals, in)
		_ = json.NewEncoder(w).Encode([]any{in})
	case r.URL.Path == "/rest/v1/date_options":
		var rows []map[string]any
		_ = json.Unmarshal(body, &rows)
		for i, o := range rows {
			o["id"] = fmt.Sprintf("o%d", len(f.options)+i+1)
		}
		f.options = append(f.options, rows...)
		w.WriteHeader(201)
	case r.URL.Path == "/rest/v1/rpc/accept_date":
		if in["option_id"] == "o1" {
			w.WriteHeader(400)
			_, _ = w.Write([]byte(`{"code":"P0001","message":"La otra persona tiene que elegir entre tus propuestas"}`))
			return
		}
		f.proposals[0]["status"] = "accepted"
		f.events = append(f.events, map[string]any{"id": "e-cita", "circle_id": "c1", "title": "Cine", "date": "2026-11-07", "start": "19:00", "minutes": 150, "proposal_id": "p1"})
		_, _ = w.Write([]byte(`"e-cita"`))
	default:
		f.t.Errorf("petición inesperada: %s %s", r.Method, r.URL)
		w.WriteHeader(404)
	}
}

func newTest(t *testing.T) (*Service, *fakeSupabase, *memSecrets) {
	t.Helper()
	f := &fakeSupabase{t: t, expiresIn: 3600}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	oldURL, oldKey := URL, Key
	URL, Key = srv.URL, "clave-publica"
	t.Cleanup(func() { URL, Key = oldURL, oldKey })
	sec := &memSecrets{m: map[string]string{}}
	s := New(t.TempDir(), sec)
	s.now = func() time.Time { return time.Date(2026, 10, 27, 10, 0, 0, 0, time.UTC) }
	return s, f, sec
}

func TestNotConfigured(t *testing.T) {
	oldURL, oldKey := URL, Key
	URL, Key = "", ""
	defer func() { URL, Key = oldURL, oldKey }()
	s := New(t.TempDir(), nil)
	if snap := s.Snapshot(); snap.Configured || snap.SignedIn {
		t.Fatalf("%+v", snap)
	}
	if _, err := s.SignIn(context.Background(), "a@b.c", "x"); err == nil || !strings.Contains(err.Error(), "no están configuradas") {
		t.Fatal(err)
	}
}

func TestSignInRestoreAndRotation(t *testing.T) {
	ctx := context.Background()
	s, f, sec := newTest(t)
	if _, err := s.SignIn(ctx, "ana@example.com", "mala"); err == nil || err.Error() != "Correo o contraseña incorrectos" {
		t.Fatalf("error traducido: %v", err)
	}
	snap, err := s.SignIn(ctx, "ana@example.com", "contraseña-buena")
	if err != nil || !snap.SignedIn || snap.Profile == nil || snap.Profile.Name != "Ana" {
		t.Fatalf("%v %+v", err, snap)
	}
	if sec.m[secretKey] != "ref-1" {
		t.Fatalf("token guardado: %q", sec.m[secretKey])
	}

	// Otro arranque: la sesión se abre con el token guardado y se rota
	s2 := New(s.dir, sec)
	snap, err = s2.Restore(ctx)
	if err != nil || !snap.SignedIn || sec.m[secretKey] != "ref-2" {
		t.Fatalf("restore: %v %+v %q", err, snap, sec.m[secretKey])
	}

	// Token de acceso a punto de caducar: se renueva solo antes de la petición
	f.expiresIn = 30
	if _, err := s2.SignIn(ctx, "ana@example.com", "contraseña-buena"); err != nil {
		t.Fatal(err)
	}
	before := f.refreshN
	if _, err := s2.Refresh(ctx); err != nil {
		t.Fatal(err)
	}
	if f.refreshN <= before || sec.m[secretKey] != fmt.Sprintf("ref-%d", f.refreshN) {
		t.Fatalf("no se renovó: %d → %d (%q)", before, f.refreshN, sec.m[secretKey])
	}

	// Token revocado en el servidor: se cierra la sesión local
	sec.m[secretKey] = "ref-viejo"
	s3 := New(s.dir, sec)
	if _, err := s3.Restore(ctx); err == nil || s3.Snapshot().SignedIn || sec.m[secretKey] != "" {
		t.Fatalf("debía cerrar la sesión: %v", err)
	}
}

func TestSignUpNeedsConfirmation(t *testing.T) {
	s, f, _ := newTest(t)
	f.confirm = true
	if _, _, err := s.SignUp(context.Background(), "ana@example.com", "corta", "Ana"); err == nil {
		t.Fatal("contraseña corta")
	}
	needs, snap, err := s.SignUp(context.Background(), "ana@example.com", "una-buena-clave", "Ana")
	if err != nil || !needs || snap.SignedIn {
		t.Fatalf("%v %v %+v", err, needs, snap)
	}
}

func TestGooglePKCE(t *testing.T) {
	s, f, _ := newTest(t)
	u, err := s.GoogleURL("http://127.0.0.1:47863/auth/callback")
	if err != nil || !strings.Contains(u, "provider=google") || !strings.Contains(u, "code_challenge_method=s256") || !strings.Contains(u, "redirect_to=http%3A%2F%2F127.0.0.1%3A47863%2Fauth%2Fcallback") {
		t.Fatalf("%v %s", err, u)
	}
	f.verifier = challenge(s.verifier)
	snap, err := s.GoogleFinish(context.Background(), "codigo-google")
	if err != nil || !snap.SignedIn {
		t.Fatalf("%v %+v", err, snap)
	}
	if _, err := s.GoogleFinish(context.Background(), "codigo-google"); err == nil {
		t.Fatal("el verificador solo sirve una vez")
	}
}

func TestCircleEventsAndDates(t *testing.T) {
	ctx := context.Background()
	s, _, _ := newTest(t)
	if _, err := s.Refresh(ctx); err != ErrNotSignedIn {
		t.Fatalf("sin sesión: %v", err)
	}
	if _, err := s.SignIn(ctx, "ana@example.com", "contraseña-buena"); err != nil {
		t.Fatal(err)
	}
	snap, err := s.CreateCircle(ctx, "Luis y Ana", "couple", "")
	if err != nil || len(snap.Circles) != 1 || snap.Circles[0].Kind != "couple" || snap.Circles[0].Members[0].Profile.Name != "Ana" {
		t.Fatalf("%v %+v", err, snap.Circles)
	}
	code, err := s.Invite(ctx, "c1")
	if err != nil || code != "ABCD2345" {
		t.Fatal(err, code)
	}
	snap, _ = s.Join(ctx, code)
	if len(snap.Circles[0].Members) != 2 {
		t.Fatalf("miembros: %+v", snap.Circles[0].Members)
	}

	start := "18:00"
	ev, err := s.SaveEvent(ctx, Event{CircleID: "c1", Title: "Cena", Date: "2026-11-01", Start: &start, Minutes: 90})
	if err != nil || ev.ID == "" {
		t.Fatal(err)
	}
	ev.Title = "Cena en casa"
	if ev, err = s.SaveEvent(ctx, ev); err != nil || ev.Title != "Cena en casa" {
		t.Fatal(err, ev)
	}
	if got := s.Events("2026-11-01", "2026-11-01"); len(got) != 1 || got[0].Title != "Cena en casa" {
		t.Fatalf("caché: %+v", got)
	}

	t1, t2 := "19:00", ""
	snap, err = s.ProposeDate(ctx, "c1", "Cine", "", []Option{{Date: "2026-11-06", Start: &t1}, {Date: "2026-11-07", Start: &t2}})
	if err != nil || len(snap.Proposals) != 1 || len(snap.Proposals[0].Options) != 2 || snap.Proposals[0].Options[1].Start != nil || snap.Proposals[0].Options[0].Minutes != 120 {
		t.Fatalf("%v %+v", err, snap.Proposals)
	}
	if _, err := s.Accept(ctx, "o1"); err == nil || err.Error() != "La otra persona tiene que elegir entre tus propuestas" {
		t.Fatalf("mensaje del servidor: %v", err)
	}
	snap, err = s.Accept(ctx, "o2")
	if err != nil || snap.Proposals[0].Status != "accepted" || len(s.Events("2026-11-07", "2026-11-07")) != 1 {
		t.Fatalf("%v %+v", err, snap)
	}

	// La caché sirve sin conexión en el siguiente arranque
	s2 := New(s.dir, nil)
	if c := s2.Snapshot(); len(c.Circles) != 1 || len(c.Events) != 2 || c.SignedIn {
		t.Fatalf("caché: %+v", c)
	}
}
