package desktop

import (
	"context"
	"errors"
	"fmt"
	"html"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/zalando/go-keyring"

	"folio/internal/cloudsync"
	"folio/internal/core"
)

// Sincronización en escritorio: las credenciales viven en el almacén del
// sistema (Administrador de credenciales de Windows, Secret Service en Linux),
// nunca en los ajustes ni en la nube.

const keyringService = "Folio"

var errNoKeyring = errors.New("no se pudo usar el almacén de contraseñas del sistema (en Linux hace falta un servicio de claves, como GNOME Keyring o KWallet)")

// secretKey identifica la credencial de la nube vinculada.
func secretKey(cfg core.SyncConfig) string {
	if cfg.Provider == "gdrive" {
		return "gdrive"
	}
	return "webdav:" + cfg.URL + "|" + cfg.User
}

// SyncSetSecret guarda la contraseña (WebDAV) de la nube configurada.
func (a *App) SyncSetSecret(secret string) error {
	cfg := a.SyncStatus().Config
	if cfg.Provider == "" {
		return errors.New("primero hay que configurar la nube")
	}
	if err := keyring.Set(keyringService, secretKey(cfg), secret); err != nil {
		return fmt.Errorf("%w: %v", errNoKeyring, err)
	}
	return nil
}

// SyncForgetSecret borra la credencial guardada (al desvincular).
func (a *App) SyncForgetSecret() {
	cfg := a.SyncStatus().Config
	_ = keyring.Delete(keyringService, secretKey(cfg))
	gdrive.Lock()
	gdrive.tok = cloudsync.Tokens{}
	gdrive.Unlock()
}

var gdrive struct {
	sync.Mutex
	tok cloudsync.Tokens // token de acceso en uso (caduca en una hora)
}

func googleOAuth() *cloudsync.GoogleOAuth {
	return &cloudsync.GoogleOAuth{ClientID: cloudsync.GoogleDesktopClientID, ClientSecret: cloudsync.GoogleDesktopClientSecret}
}

// secretForSync devuelve lo que necesita el núcleo: la contraseña, o un token de acceso de Google.
func (a *App) secretForSync(ctx context.Context, cfg core.SyncConfig) (string, error) {
	stored, err := keyring.Get(keyringService, secretKey(cfg))
	if err != nil {
		if errors.Is(err, keyring.ErrNotFound) {
			return "", errors.New("falta la credencial de la nube; vuelve a vincularla en Ajustes")
		}
		return "", fmt.Errorf("%w: %v", errNoKeyring, err)
	}
	if cfg.Provider != "gdrive" {
		return stored, nil
	}
	gdrive.Lock()
	defer gdrive.Unlock()
	if gdrive.tok.AccessToken != "" && time.Until(gdrive.tok.Expires) > 2*time.Minute {
		return gdrive.tok.AccessToken, nil
	}
	tok, err := googleOAuth().Refresh(ctx, stored)
	if err != nil {
		return "", err
	}
	gdrive.tok = tok
	return tok.AccessToken, nil
}

// SyncRun sincroniza con la nube vinculada (el núcleo recarga los almacenes si cambia algo).
func (a *App) SyncRun() (core.SyncResult, error) {
	cfg := a.SyncStatus().Config
	if cfg.Provider == "" {
		return core.SyncResult{}, errors.New("no hay ninguna nube vinculada")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	secret, err := a.secretForSync(ctx, cfg)
	cancel()
	if err != nil {
		return core.SyncResult{}, err
	}
	return a.SyncNow(secret)
}

// SyncTestStored comprueba la conexión con lo configurado y la credencial guardada.
func (a *App) SyncTestStored() error {
	cfg := a.SyncStatus().Config
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	secret, err := a.secretForSync(ctx, cfg)
	if err != nil {
		return err
	}
	return a.SyncTest(cfg, secret)
}

const oauthDonePage = `<!doctype html><meta charset="utf-8"><title>Folio</title>
<body style="font:16px system-ui;max-width:32em;margin:4em auto;padding:0 1em">
<h1>%s</h1><p>%s</p></body>`

// SyncLinkGoogle vincula Google Drive: abre el navegador, espera el permiso en
// 127.0.0.1 (flujo para apps instaladas con PKCE) y guarda el token de renovación.
func (a *App) SyncLinkGoogle() error {
	oauth := googleOAuth()
	verifier, challenge, state := cloudsync.NewPKCE()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	redirect := fmt.Sprintf("http://%s/oauth", ln.Addr().String())
	authURL, err := oauth.AuthorizeURL(redirect, state, challenge)
	if err != nil {
		ln.Close()
		return err
	}

	type result struct {
		code string
		err  error
	}
	done := make(chan result, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		q := r.URL.Query()
		switch {
		case q.Get("state") != state:
			fmt.Fprintf(w, oauthDonePage, "Algo ha ido mal", "La respuesta no corresponde a esta solicitud. Vuelve a intentarlo desde Folio.")
			return
		case q.Get("error") != "":
			fmt.Fprintf(w, oauthDonePage, "No se ha vinculado", html.EscapeString("Google ha respondido: "+q.Get("error")))
			done <- result{err: errors.New("no has dado permiso a Folio en Google")}
		default:
			fmt.Fprintf(w, oauthDonePage, "Folio está vinculado con Google Drive", "Ya puedes cerrar esta pestaña y volver a Folio.")
			done <- result{code: q.Get("code")}
		}
	})
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = srv.Serve(ln) }()
	defer srv.Close()

	_ = openURL(authURL)
	var res result
	select {
	case res = <-done:
	case <-time.After(3 * time.Minute):
		return errors.New("se agotó el tiempo esperando el permiso de Google")
	case <-a.ctx.Done():
		return a.ctx.Err()
	}
	if res.err != nil {
		return res.err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	tok, err := oauth.Exchange(ctx, res.code, verifier, redirect)
	if err != nil {
		return err
	}
	if tok.RefreshToken == "" {
		return errors.New("Google no ha entregado el permiso de renovación; retira el acceso de Folio en tu cuenta de Google y vuelve a intentarlo")
	}
	if _, err := a.SyncConfigure(core.SyncConfig{Provider: "gdrive"}); err != nil {
		return err
	}
	if err := keyring.Set(keyringService, "gdrive", tok.RefreshToken); err != nil {
		return fmt.Errorf("%w: %v", errNoKeyring, err)
	}
	gdrive.Lock()
	gdrive.tok = tok
	gdrive.Unlock()
	return nil
}
