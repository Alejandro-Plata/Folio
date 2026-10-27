package update

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestNewer(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"1.2.0", "1.1.9", true}, {"v1.10.0", "1.9.0", true}, {"1.0.0", "1.0.0", false},
		{"1.0", "1.0.1", false}, {"2.0.0", "abc123", true}, {"nada", "1.0.0", false}, {"1.3.0-beta", "1.2.0", true},
	}
	for _, c := range cases {
		if got := Newer(c.a, c.b); got != c.want {
			t.Errorf("Newer(%q, %q) = %v", c.a, c.b, got)
		}
	}
}

func TestAssetName(t *testing.T) {
	if !AssetName("windows", "amd64", "Folio-Setup-1.2.0.exe") || AssetName("windows", "amd64", "folio.exe") {
		t.Error("windows")
	}
	if !AssetName("android", "arm64", "Folio-1.2.0.apk") || AssetName("android", "arm64", "Folio-1.2.0-debug.apk") {
		t.Error("android")
	}
	if !AssetName("linux", "amd64", "folio-linux-amd64") || AssetName("linux", "amd64", "folio-linux-arm64") {
		t.Error("linux")
	}
}

// Servidor con la API de GitHub y los archivos de una versión.
func fakeGitHub(t *testing.T, files map[string][]byte) *httptest.Server {
	t.Helper()
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/repos/yo/folio/releases/latest" {
			var assets []ghAsset
			for name, b := range files {
				assets = append(assets, ghAsset{Name: name, URL: srv.URL + "/dl/" + name, Size: int64(len(b))})
			}
			_ = json.NewEncoder(w).Encode(ghRelease{Tag: "v1.2.0", Body: "Novedades", HTMLURL: "https://github.com/yo/folio/releases/v1.2.0", Assets: assets})
			return
		}
		if b, ok := files[strings.TrimPrefix(r.URL.Path, "/dl/")]; ok {
			_, _ = w.Write(b)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func setup(t *testing.T, srv *httptest.Server, key string) {
	oldRepo, oldBase, oldKey := Repo, APIBase, publicKey
	Repo, APIBase, publicKey = "yo/folio", srv.URL, key
	t.Cleanup(func() { Repo, APIBase, publicKey = oldRepo, oldBase, oldKey })
}

func sum(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

func TestCheckAndDownload(t *testing.T) {
	bin := []byte("binario nuevo de folio")
	sums := []byte(fmt.Sprintf("%s  folio-linux-amd64\n%s  Folio-Setup-1.2.0.exe\n", sum(bin), sum([]byte("x"))))
	srv := fakeGitHub(t, map[string][]byte{"folio-linux-amd64": bin, "SHA256SUMS": sums, "Folio-Setup-1.2.0.exe": []byte("x")})
	setup(t, srv, "")

	c := &Checker{Current: "1.1.0", OS: "linux", Arch: "amd64"}
	info, err := c.Check(context.Background())
	if err != nil || !info.Available || info.Latest != "1.2.0" || info.Asset != "folio-linux-amd64" || info.Notes != "Novedades" {
		t.Fatalf("check: %v %+v", err, info)
	}
	var lastDone int64
	path, err := c.Download(context.Background(), t.TempDir(), func(done, total int64) { lastDone = done })
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(path); string(b) != string(bin) || lastDone != int64(len(bin)) {
		t.Fatalf("descarga: %q %d", b, lastDone)
	}

	// Al día: no hay nada que instalar
	c2 := &Checker{Current: "1.2.0", OS: "linux", Arch: "amd64"}
	if info, _ := c2.Check(context.Background()); info.Available {
		t.Fatal("no debería haber actualización")
	}
}

func TestDownloadRejectsBadHash(t *testing.T) {
	sums := []byte(fmt.Sprintf("%s  folio-linux-amd64\n", sum([]byte("otro contenido"))))
	srv := fakeGitHub(t, map[string][]byte{"folio-linux-amd64": []byte("manipulado"), "SHA256SUMS": sums})
	setup(t, srv, "")
	c := &Checker{Current: "1.0.0", OS: "linux", Arch: "amd64"}
	dir := t.TempDir()
	if _, err := c.Download(context.Background(), dir, nil); err == nil || !strings.Contains(err.Error(), "SHA-256") {
		t.Fatalf("debía rechazarlo: %v", err)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatal("no debe quedar el archivo descargado")
	}
}

func TestSignature(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	bin := []byte("instalador")
	sums := []byte(sum(bin) + "  Folio-1.2.0.apk\n")
	good := base64.StdEncoding.EncodeToString(ed25519.Sign(priv, sums))
	key := base64.StdEncoding.EncodeToString(pub)

	srv := fakeGitHub(t, map[string][]byte{"Folio-1.2.0.apk": bin, "SHA256SUMS": sums, "SHA256SUMS.sig": []byte(good)})
	setup(t, srv, key)
	if _, err := (&Checker{Current: "1.0.0", OS: "android"}).Download(context.Background(), t.TempDir(), nil); err != nil {
		t.Fatalf("firma buena: %v", err)
	}

	_, other, _ := ed25519.GenerateKey(nil)
	bad := base64.StdEncoding.EncodeToString(ed25519.Sign(other, sums))
	srv2 := fakeGitHub(t, map[string][]byte{"Folio-1.2.0.apk": bin, "SHA256SUMS": sums, "SHA256SUMS.sig": []byte(bad)})
	setup(t, srv2, key)
	if _, err := (&Checker{Current: "1.0.0", OS: "android"}).Download(context.Background(), t.TempDir(), nil); err == nil || !strings.Contains(err.Error(), "firma") {
		t.Fatalf("firma mala: %v", err)
	}

	srv3 := fakeGitHub(t, map[string][]byte{"Folio-1.2.0.apk": bin, "SHA256SUMS": sums})
	setup(t, srv3, key)
	if _, err := (&Checker{Current: "1.0.0", OS: "android"}).Download(context.Background(), t.TempDir(), nil); err == nil {
		t.Fatal("sin firma debía rechazarse")
	}
}

func TestNotConfigured(t *testing.T) {
	old := Repo
	Repo = ""
	defer func() { Repo = old }()
	info, err := (&Checker{Current: "1.0.0", OS: "linux"}).Check(context.Background())
	if err != nil || info.Configured || info.Available {
		t.Fatalf("%v %+v", err, info)
	}
}
