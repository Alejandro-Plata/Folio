// Package update busca versiones nuevas de Folio en GitHub Releases, descarga
// el archivo de la plataforma y comprueba su suma SHA-256 (y la firma de la
// lista de sumas, si la app lleva clave pública). Instalarlo depende de cada
// plataforma y lo hace quien llama.
package update

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Repo es el repositorio de GitHub donde se publican las versiones
// («usuario/folio»). Vacío = actualizaciones sin configurar.
var Repo = "Alejandro-Plata/Folio"

// APIBase se cambia en los tests.
var APIBase = "https://api.github.com"

// Clave pública (ed25519, base64) con la que se firma SHA256SUMS. La genera
// `go run ./cmd/releasekey gen`; vacía = solo se comprueba la suma SHA-256.
//
//go:embed publickey.txt
var publicKey string

// Info describe la última versión publicada frente a la instalada.
type Info struct {
	Configured bool   `json:"configured"`
	Current    string `json:"current"`
	Latest     string `json:"latest"`
	Available  bool   `json:"available"`
	Notes      string `json:"notes"`
	Page       string `json:"page"`  // página de la versión en GitHub
	Asset      string `json:"asset"` // nombre del archivo para esta plataforma
	Size       int64  `json:"size"`
	Published  string `json:"published"`
}

type ghAsset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
	Size int64  `json:"size"`
}

type ghRelease struct {
	Tag        string    `json:"tag_name"`
	Body       string    `json:"body"`
	HTMLURL    string    `json:"html_url"`
	Draft      bool      `json:"draft"`
	Prerelease bool      `json:"prerelease"`
	Published  time.Time `json:"published_at"`
	Assets     []ghAsset `json:"assets"`
}

// Checker consulta y descarga versiones para una plataforma.
type Checker struct {
	Current string // versión instalada
	OS      string // linux, windows, android
	Arch    string
	Client  *http.Client

	release *ghRelease
}

func (c *Checker) client() *http.Client {
	if c.Client != nil {
		return c.Client
	}
	return &http.Client{Timeout: 30 * time.Second}
}

// AssetName indica qué archivo de la versión corresponde a la plataforma.
func AssetName(goos, arch, name string) bool {
	n := strings.ToLower(name)
	switch goos {
	case "windows":
		return strings.HasPrefix(n, "folio-setup-") && strings.HasSuffix(n, ".exe")
	case "android":
		return strings.HasSuffix(n, ".apk") && !strings.Contains(n, "debug")
	case "linux":
		return n == "folio-linux-"+arch
	}
	return false
}

// Check pregunta a GitHub por la última versión.
func (c *Checker) Check(ctx context.Context) (Info, error) {
	info := Info{Configured: Repo != "", Current: c.Current}
	if Repo == "" {
		return info, nil
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s/repos/%s/releases/latest", APIBase, Repo), nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	res, err := c.client().Do(req)
	if err != nil {
		return info, fmt.Errorf("no se pudo consultar GitHub: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return info, errors.New("todavía no hay ninguna versión publicada")
	}
	if res.StatusCode != http.StatusOK {
		return info, fmt.Errorf("GitHub respondió %s", res.Status)
	}
	var rel ghRelease
	if err := json.NewDecoder(res.Body).Decode(&rel); err != nil {
		return info, err
	}
	c.release = &rel
	info.Latest = strings.TrimPrefix(rel.Tag, "v")
	info.Notes = rel.Body
	info.Page = rel.HTMLURL
	info.Published = rel.Published.Format("2006-01-02")
	if a := c.asset(); a != nil {
		info.Asset, info.Size = a.Name, a.Size
	}
	info.Available = info.Asset != "" && Newer(info.Latest, c.Current)
	return info, nil
}

func (c *Checker) asset() *ghAsset {
	if c.release == nil {
		return nil
	}
	for i, a := range c.release.Assets {
		if AssetName(c.OS, c.Arch, a.Name) {
			return &c.release.Assets[i]
		}
	}
	return nil
}

func (c *Checker) assetNamed(name string) *ghAsset {
	for i, a := range c.release.Assets {
		if a.Name == name {
			return &c.release.Assets[i]
		}
	}
	return nil
}

// Download baja el archivo de la plataforma a dir y lo verifica. progress
// recibe los bytes descargados y el total.
func (c *Checker) Download(ctx context.Context, dir string, progress func(done, total int64)) (string, error) {
	if c.release == nil {
		if _, err := c.Check(ctx); err != nil {
			return "", err
		}
	}
	a := c.asset()
	if a == nil {
		return "", errors.New("esta versión no trae archivo para tu sistema")
	}
	sumsAsset := c.assetNamed("SHA256SUMS")
	if sumsAsset == nil {
		return "", errors.New("la versión no incluye SHA256SUMS: no se puede comprobar la descarga")
	}
	sums, err := c.fetchSmall(ctx, sumsAsset.URL)
	if err != nil {
		return "", err
	}
	if key := strings.TrimSpace(publicKey); key != "" {
		sigAsset := c.assetNamed("SHA256SUMS.sig")
		if sigAsset == nil {
			return "", errors.New("la versión no está firmada")
		}
		sig, err := c.fetchSmall(ctx, sigAsset.URL)
		if err != nil {
			return "", err
		}
		if err := Verify(key, sums, strings.TrimSpace(string(sig))); err != nil {
			return "", err
		}
	}
	want, ok := ParseSums(sums)[a.Name]
	if !ok {
		return "", fmt.Errorf("SHA256SUMS no incluye %s", a.Name)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	dst := filepath.Join(dir, a.Name)
	if err := c.fetchTo(ctx, a.URL, dst, a.Size, want, progress); err != nil {
		return "", err
	}
	return dst, nil
}

func (c *Checker) fetchSmall(ctx context.Context, url string) ([]byte, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	res, err := c.client().Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("descarga: %s", res.Status)
	}
	return io.ReadAll(io.LimitReader(res.Body, 1<<20))
}

func (c *Checker) fetchTo(ctx context.Context, url, dst string, size int64, wantHex string, progress func(done, total int64)) error {
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	// Sin límite de tiempo total: el instalador puede tardar en bajar
	cl := *c.client()
	cl.Timeout = 0
	res, err := cl.Do(req)
	if err != nil {
		return fmt.Errorf("no se pudo descargar: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("descarga: %s", res.Status)
	}
	if size <= 0 {
		size = res.ContentLength
	}
	tmp := dst + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	h := sha256.New()
	var done int64
	buf := make([]byte, 64*1024)
	last := time.Time{}
	for {
		n, rerr := res.Body.Read(buf)
		if n > 0 {
			if _, err := f.Write(buf[:n]); err != nil {
				f.Close()
				return err
			}
			h.Write(buf[:n])
			done += int64(n)
			if progress != nil && time.Since(last) > 150*time.Millisecond {
				progress(done, size)
				last = time.Now()
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			f.Close()
			os.Remove(tmp)
			return fmt.Errorf("descarga interrumpida: %w", rerr)
		}
	}
	if err := f.Close(); err != nil {
		return err
	}
	if progress != nil {
		progress(done, size)
	}
	if got := hex.EncodeToString(h.Sum(nil)); !strings.EqualFold(got, wantHex) {
		os.Remove(tmp)
		return errors.New("el archivo descargado no coincide con su suma SHA-256; no se instalará")
	}
	return os.Rename(tmp, dst)
}

// ParseSums lee un SHA256SUMS («hash  nombre» por línea, como sha256sum).
func ParseSums(b []byte) map[string]string {
	out := map[string]string{}
	sc := bufio.NewScanner(strings.NewReader(string(b)))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) == 2 {
			out[strings.TrimPrefix(f[1], "*")] = strings.ToLower(f[0])
		}
	}
	return out
}

// Verify comprueba la firma ed25519 (base64) de data con la clave pública (base64).
func Verify(pubB64 string, data []byte, sigB64 string) error {
	pub, err := base64.StdEncoding.DecodeString(strings.TrimSpace(pubB64))
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return errors.New("clave pública de actualizaciones no válida")
	}
	sig, err := base64.StdEncoding.DecodeString(sigB64)
	if err != nil || !ed25519.Verify(ed25519.PublicKey(pub), data, sig) {
		return errors.New("la firma de la versión no es válida; no se instalará")
	}
	return nil
}

// Newer indica si la versión a es posterior a b. Una versión instalada que no
// es un número (compilación de desarrollo) siempre se puede actualizar.
func Newer(a, b string) bool {
	pa, okA := parse(a)
	pb, okB := parse(b)
	if !okA {
		return false
	}
	if !okB {
		return true
	}
	for i := range 3 {
		if pa[i] != pb[i] {
			return pa[i] > pb[i]
		}
	}
	return false
}

func parse(v string) ([3]int, bool) {
	var out [3]int
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if i := strings.IndexAny(v, "-+ "); i >= 0 {
		v = v[:i]
	}
	parts := strings.Split(v, ".")
	if len(parts) == 0 || len(parts) > 3 {
		return out, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return out, false
		}
		out[i] = n
	}
	return out, true
}
