package cloudsync

import (
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
	"time"
)

// IDs del cliente OAuth «App de escritorio» de Folio en Google Cloud. No son
// secretos en una app instalada (el flujo se protege con PKCE), pero el
// repositorio es público y Google desactiva los secretos que encuentra en
// GitHub: build.sh los pone al compilar desde ~/.config/folio-release/google-oauth.properties
// (docs/actualizaciones.md).
var (
	GoogleDesktopClientID     = ""
	GoogleDesktopClientSecret = ""
)

// GoogleScope es el ámbito mínimo: solo los archivos que crea Folio.
const GoogleScope = "https://www.googleapis.com/auth/drive.file"

// GoogleOAuth hace el flujo de «app instalada» con PKCE y redirección a localhost.
type GoogleOAuth struct {
	ClientID, ClientSecret string
	AuthURL, TokenURL      string // por defecto, los de Google
	Client                 *http.Client
}

// ErrNoClientID se devuelve si todavía no se han configurado los IDs de Google.
var ErrNoClientID = errors.New("falta configurar el ID de cliente de Google (ver docs/guia-android.md, apartado I.7)")

func (g *GoogleOAuth) authURL() string {
	if g.AuthURL != "" {
		return g.AuthURL
	}
	return "https://accounts.google.com/o/oauth2/v2/auth"
}

func (g *GoogleOAuth) tokenURL() string {
	if g.TokenURL != "" {
		return g.TokenURL
	}
	return "https://oauth2.googleapis.com/token"
}

func (g *GoogleOAuth) client() *http.Client {
	if g.Client != nil {
		return g.Client
	}
	return &http.Client{Timeout: 30 * time.Second}
}

// NewPKCE genera el par verificador/desafío y un «state» aleatorio.
func NewPKCE() (verifier, challenge, state string) {
	b := make([]byte, 48)
	_, _ = rand.Read(b)
	verifier = base64.RawURLEncoding.EncodeToString(b)
	sum := sha256.Sum256([]byte(verifier))
	challenge = base64.RawURLEncoding.EncodeToString(sum[:])
	s := make([]byte, 16)
	_, _ = rand.Read(s)
	return verifier, challenge, base64.RawURLEncoding.EncodeToString(s)
}

// AuthorizeURL es la dirección que se abre en el navegador.
func (g *GoogleOAuth) AuthorizeURL(redirect, state, challenge string) (string, error) {
	if g.ClientID == "" {
		return "", ErrNoClientID
	}
	q := url.Values{
		"client_id": {g.ClientID}, "redirect_uri": {redirect}, "response_type": {"code"}, "scope": {GoogleScope},
		"code_challenge": {challenge}, "code_challenge_method": {"S256"}, "state": {state},
		"access_type": {"offline"}, "prompt": {"consent"},
	}
	return g.authURL() + "?" + q.Encode(), nil
}

// Tokens son las credenciales que devuelve Google.
type Tokens struct {
	AccessToken  string
	RefreshToken string
	Expires      time.Time
}

func (g *GoogleOAuth) token(ctx context.Context, form url.Values) (Tokens, error) {
	form.Set("client_id", g.ClientID)
	if g.ClientSecret != "" {
		form.Set("client_secret", g.ClientSecret)
	}
	req, err := http.NewRequestWithContext(ctx, "POST", g.tokenURL(), strings.NewReader(form.Encode()))
	if err != nil {
		return Tokens{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := g.client().Do(req)
	if err != nil {
		return Tokens{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var out struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		Error        string `json:"error"`
		Description  string `json:"error_description"`
	}
	_ = json.Unmarshal(body, &out)
	if resp.StatusCode != http.StatusOK || out.AccessToken == "" {
		if out.Error == "invalid_grant" {
			return Tokens{}, errors.New("el permiso de Google ha caducado o se ha retirado: vuelve a vincular la cuenta")
		}
		return Tokens{}, fmt.Errorf("Google no ha dado acceso (%s %s)", out.Error, out.Description)
	}
	return Tokens{AccessToken: out.AccessToken, RefreshToken: out.RefreshToken, Expires: time.Now().Add(time.Duration(out.ExpiresIn) * time.Second)}, nil
}

// Exchange canjea el código de autorización por los tokens.
func (g *GoogleOAuth) Exchange(ctx context.Context, code, verifier, redirect string) (Tokens, error) {
	return g.token(ctx, url.Values{"grant_type": {"authorization_code"}, "code": {code}, "code_verifier": {verifier}, "redirect_uri": {redirect}})
}

// Refresh obtiene un token de acceso nuevo con el de renovación.
func (g *GoogleOAuth) Refresh(ctx context.Context, refreshToken string) (Tokens, error) {
	t, err := g.token(ctx, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refreshToken}})
	if err == nil && t.RefreshToken == "" {
		t.RefreshToken = refreshToken
	}
	return t, err
}
