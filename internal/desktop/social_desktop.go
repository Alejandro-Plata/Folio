package desktop

import (
	"context"
	"errors"
	"fmt"
	"html"
	"net"
	"net/http"
	"time"

	"github.com/zalando/go-keyring"

	"folio/internal/social"
)

// keyringSecrets guarda la sesión de la cuenta en el llavero del sistema.
type keyringSecrets struct{}

func (keyringSecrets) Get(k string) (string, error) {
	v, err := keyring.Get(keyringService, k)
	if errors.Is(err, keyring.ErrNotFound) {
		return "", nil
	}
	return v, err
}
func (keyringSecrets) Set(k, v string) error { return keyring.Set(keyringService, k, v) }
func (keyringSecrets) Delete(k string) error {
	if err := keyring.Delete(keyringService, k); err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return err
	}
	return nil
}

// Puerto fijo para volver del inicio de sesión con Google: tiene que estar en
// la lista de URL de redirección del proyecto de Supabase (docs/supabase.md).
const googleCallback = "127.0.0.1:47863"

// SocialSignInGoogle abre el navegador para entrar con Google y espera la vuelta.
func (a *App) SocialSignInGoogle() (social.Snapshot, error) {
	ln, err := net.Listen("tcp", googleCallback)
	if err != nil {
		return social.Snapshot{}, fmt.Errorf("no se puede esperar la respuesta de Google (¿otro inicio de sesión abierto?): %w", err)
	}
	authURL, err := a.SocialGoogleURL("http://" + googleCallback + "/auth/callback")
	if err != nil {
		ln.Close()
		return social.Snapshot{}, err
	}
	type result struct {
		code string
		err  error
	}
	done := make(chan result, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/auth/callback", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		q := r.URL.Query()
		if e := q.Get("error_description"); e != "" || q.Get("code") == "" {
			fmt.Fprintf(w, oauthDonePage, "No se ha iniciado sesión", html.EscapeString(e))
			done <- result{err: errors.New("no se ha completado el inicio de sesión con Google")}
			return
		}
		fmt.Fprintf(w, oauthDonePage, "Has entrado en Folio", "Ya puedes cerrar esta pestaña y volver a Folio.")
		done <- result{code: q.Get("code")}
	})
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = srv.Serve(ln) }()
	defer srv.Close()

	_ = openURL(authURL)
	var res result
	select {
	case res = <-done:
	case <-time.After(5 * time.Minute):
		return social.Snapshot{}, errors.New("se agotó el tiempo esperando a Google")
	case <-a.ctx.Done():
		return social.Snapshot{}, context.Canceled
	}
	if res.err != nil {
		return social.Snapshot{}, res.err
	}
	return a.SocialGoogleFinish(res.code)
}
