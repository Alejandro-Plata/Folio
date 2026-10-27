package social

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// URL y Key del proyecto de Supabase (la clave «anon»/publishable es pública
// por diseño: la seguridad la ponen las políticas por filas). Vacías = cuentas
// sin configurar.
var (
	URL = "https://fkhfmkzcigtxqophpxvk.supabase.co"
	Key = "sb_publishable_wVVrXRuCLbn9z95wCjyHug_syeLHJl5"
)

// ErrNotSignedIn se devuelve al pedir algo que necesita sesión.
var ErrNotSignedIn = errors.New("inicia sesión para usar los círculos")

type session struct {
	Access  string    `json:"access_token"`
	Refresh string    `json:"refresh_token"`
	Expires time.Time `json:"-"`
	User    User      `json:"user"`
}

// client es el acceso HTTP a Supabase con la sesión (renueva el token solo).
type client struct {
	base, key string
	http      *http.Client
	mu        sync.Mutex
	sess      *session
	onRefresh func(refresh string) // guarda el token de renovación nuevo
}

func newClient(base, key string) *client {
	return &client{base: strings.TrimRight(base, "/"), key: key, http: &http.Client{Timeout: 20 * time.Second}}
}

// apiError traduce los errores de GoTrue y PostgREST a mensajes para la persona.
type apiError struct {
	Status int
	Code   string
	Msg    string
}

func (e *apiError) Error() string { return e.Msg }

var authMessages = map[string]string{
	"invalid_credentials":        "Correo o contraseña incorrectos",
	"email_not_confirmed":        "Confirma tu correo con el enlace que te hemos enviado y vuelve a intentarlo",
	"user_already_exists":        "Ya hay una cuenta con ese correo: entra con él",
	"email_exists":               "Ya hay una cuenta con ese correo: entra con él",
	"weak_password":              "La contraseña es demasiado débil: usa al menos 8 caracteres",
	"over_email_send_rate_limit": "Se han enviado demasiados correos; espera unos minutos",
	"over_request_rate_limit":    "Demasiados intentos; espera unos minutos",
	"validation_failed":          "Revisa el correo y la contraseña",
	"refresh_token_not_found":    "La sesión ha caducado: vuelve a entrar",
	"session_not_found":          "La sesión ha caducado: vuelve a entrar",
	"bad_code_verifier":          "El inicio de sesión con Google no se ha completado; vuelve a intentarlo",
	"flow_state_not_found":       "El inicio de sesión con Google ha caducado; vuelve a intentarlo",
}

func parseError(status int, body []byte) error {
	var e struct {
		Code      any    `json:"code"`
		ErrorCode string `json:"error_code"`
		Error     string `json:"error"`
		Desc      string `json:"error_description"`
		Msg       string `json:"msg"`
		Message   string `json:"message"`
	}
	_ = json.Unmarshal(body, &e)
	code := e.ErrorCode
	if code == "" {
		if s, ok := e.Code.(string); ok {
			code = s
		}
	}
	if code == "" && e.Error == "invalid_grant" {
		code = "invalid_credentials"
		if strings.Contains(strings.ToLower(e.Desc), "refresh") {
			code = "refresh_token_not_found"
		}
	}
	msg := authMessages[code]
	if msg == "" {
		msg = firstNonEmpty(e.Message, e.Msg, e.Desc, e.Error)
	}
	if msg == "" {
		msg = fmt.Sprintf("el servidor respondió %d", status)
	}
	return &apiError{Status: status, Code: code, Msg: msg}
}

func firstNonEmpty(s ...string) string {
	for _, x := range s {
		if x != "" {
			return x
		}
	}
	return ""
}

// do hace una petición. auth: usar el token de la sesión (si no, la clave pública).
func (c *client) do(ctx context.Context, method, path string, body any, auth bool, out any, headers ...string) error {
	var token string
	if auth {
		t, err := c.token(ctx)
		if err != nil {
			return err
		}
		token = t
	} else {
		token = c.key
	}
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("apikey", c.key)
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("sin conexión con el servidor: %w", err)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if res.StatusCode >= 300 {
		return parseError(res.StatusCode, data)
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}

// ---------- Sesión ----------

func (c *client) setSession(s *session, expiresIn int) {
	if expiresIn <= 0 {
		expiresIn = 3600
	}
	s.Expires = time.Now().Add(time.Duration(expiresIn) * time.Second)
	c.mu.Lock()
	c.sess = s
	cb := c.onRefresh
	c.mu.Unlock()
	if cb != nil {
		cb(s.Refresh)
	}
}

type tokenResponse struct {
	session
	ExpiresIn int `json:"expires_in"`
}

func (c *client) grant(ctx context.Context, grantType string, body any) error {
	var tr tokenResponse
	if err := c.do(ctx, "POST", "/auth/v1/token?grant_type="+grantType, body, false, &tr); err != nil {
		return err
	}
	if tr.Access == "" || tr.Refresh == "" {
		return errors.New("el servidor no ha devuelto la sesión")
	}
	c.setSession(&tr.session, tr.ExpiresIn)
	return nil
}

// token devuelve un token de acceso válido (lo renueva si está a punto de caducar).
func (c *client) token(ctx context.Context) (string, error) {
	c.mu.Lock()
	s := c.sess
	c.mu.Unlock()
	if s == nil {
		return "", ErrNotSignedIn
	}
	if time.Until(s.Expires) > time.Minute {
		return s.Access, nil
	}
	if err := c.grant(ctx, "refresh_token", map[string]string{"refresh_token": s.Refresh}); err != nil {
		var ae *apiError
		if errors.As(err, &ae) && ae.Status >= 400 && ae.Status < 500 {
			c.clear()
		}
		return "", err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.sess.Access, nil
}

func (c *client) clear() {
	c.mu.Lock()
	c.sess = nil
	c.mu.Unlock()
}

func (c *client) user() *User {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.sess == nil {
		return nil
	}
	u := c.sess.User
	return &u
}

// restore abre la sesión con un token de renovación guardado.
func (c *client) restore(ctx context.Context, refresh string) error {
	return c.grant(ctx, "refresh_token", map[string]string{"refresh_token": refresh})
}

func (c *client) signIn(ctx context.Context, email, password string) error {
	return c.grant(ctx, "password", map[string]string{"email": strings.TrimSpace(email), "password": password})
}

// signUp crea la cuenta. Si el proyecto pide confirmar el correo, no hay sesión
// todavía (needsConfirm = true).
func (c *client) signUp(ctx context.Context, email, password, name string) (needsConfirm bool, err error) {
	var res struct {
		tokenResponse
		ID string `json:"id"`
	}
	body := map[string]any{"email": strings.TrimSpace(email), "password": password, "data": map[string]string{"full_name": strings.TrimSpace(name)}}
	if err := c.do(ctx, "POST", "/auth/v1/signup", body, false, &res); err != nil {
		return false, err
	}
	if res.Access == "" {
		return true, nil
	}
	c.setSession(&res.session, res.ExpiresIn)
	return false, nil
}

func (c *client) recover(ctx context.Context, email string) error {
	return c.do(ctx, "POST", "/auth/v1/recover", map[string]string{"email": strings.TrimSpace(email)}, false, nil)
}

func (c *client) signOut(ctx context.Context) {
	if _, err := c.token(ctx); err == nil {
		_ = c.do(ctx, "POST", "/auth/v1/logout", nil, true, nil)
	}
	c.clear()
}

// ---------- Google (OAuth con PKCE) ----------

func newVerifier() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func challenge(verifier string) string {
	h := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

// googleURL es la página de Supabase que lleva al inicio de sesión de Google y
// vuelve a redirect con ?code=.
func (c *client) googleURL(redirect, verifier string) string {
	q := url.Values{}
	q.Set("provider", "google")
	q.Set("redirect_to", redirect)
	q.Set("code_challenge", challenge(verifier))
	q.Set("code_challenge_method", "s256")
	return c.base + "/auth/v1/authorize?" + q.Encode()
}

func (c *client) exchange(ctx context.Context, code, verifier string) error {
	return c.grant(ctx, "pkce", map[string]string{"auth_code": code, "code_verifier": verifier})
}

// ---------- PostgREST ----------

func (c *client) get(ctx context.Context, path string, out any) error {
	return c.do(ctx, "GET", "/rest/v1/"+path, nil, true, out)
}

func (c *client) insert(ctx context.Context, table string, body, out any) error {
	return c.do(ctx, "POST", "/rest/v1/"+table, body, true, out, "Prefer", "return=representation")
}

func (c *client) patch(ctx context.Context, path string, body, out any) error {
	return c.do(ctx, "PATCH", "/rest/v1/"+path, body, true, out, "Prefer", "return=representation")
}

func (c *client) remove(ctx context.Context, path string) error {
	return c.do(ctx, "DELETE", "/rest/v1/"+path, nil, true, nil)
}

func (c *client) rpc(ctx context.Context, fn string, args, out any) error {
	if args == nil {
		args = map[string]any{}
	}
	return c.do(ctx, "POST", "/rest/v1/rpc/"+fn, args, true, out)
}
