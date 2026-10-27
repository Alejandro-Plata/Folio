package cloudsync

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestPKCE(t *testing.T) {
	v, c, s := NewPKCE()
	sum := sha256.Sum256([]byte(v))
	if c != base64.RawURLEncoding.EncodeToString(sum[:]) || len(v) < 43 || s == "" {
		t.Fatalf("PKCE incorrecto: %q %q %q", v, c, s)
	}
	v2, _, s2 := NewPKCE()
	if v2 == v || s2 == s {
		t.Fatal("los valores deben ser aleatorios")
	}
}

func TestGoogleOAuthFlow(t *testing.T) {
	var last url.Values
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		last = r.PostForm
		switch {
		case r.PostForm.Get("code") == "buen-codigo" && r.PostForm.Get("code_verifier") == "verif":
			w.Write([]byte(`{"access_token":"acc1","refresh_token":"ref1","expires_in":3600}`))
		case r.PostForm.Get("refresh_token") == "ref1":
			w.Write([]byte(`{"access_token":"acc2","expires_in":3600}`))
		default:
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"invalid_grant"}`))
		}
	}))
	defer srv.Close()
	g := &GoogleOAuth{ClientID: "cid", ClientSecret: "sec", TokenURL: srv.URL, AuthURL: "https://auth.example/o"}
	ctx := context.Background()

	u, err := g.AuthorizeURL("http://127.0.0.1:5000/oauth", "st", "chal")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"client_id=cid", "code_challenge=chal", "code_challenge_method=S256", "access_type=offline", "state=st",
		url.QueryEscape("https://www.googleapis.com/auth/drive.file")} {
		if !strings.Contains(u, want) {
			t.Errorf("la dirección no contiene %q: %s", want, u)
		}
	}
	tok, err := g.Exchange(ctx, "buen-codigo", "verif", "http://127.0.0.1:5000/oauth")
	if err != nil || tok.AccessToken != "acc1" || tok.RefreshToken != "ref1" || last.Get("client_secret") != "sec" {
		t.Fatalf("Exchange: %+v %v", tok, err)
	}
	tok, err = g.Refresh(ctx, "ref1")
	if err != nil || tok.AccessToken != "acc2" || tok.RefreshToken != "ref1" {
		t.Fatalf("Refresh: %+v %v", tok, err)
	}
	if _, err := g.Refresh(ctx, "retirado"); err == nil || !strings.Contains(err.Error(), "vuelve a vincular") {
		t.Fatalf("un permiso retirado debe pedir volver a vincular: %v", err)
	}
	if _, err := (&GoogleOAuth{}).AuthorizeURL("x", "s", "c"); err != ErrNoClientID {
		t.Fatalf("sin ID de cliente: %v", err)
	}
}
