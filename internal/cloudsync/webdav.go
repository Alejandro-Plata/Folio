package cloudsync

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"sync"
	"time"
)

// WebDAV es un proveedor para Nextcloud, ownCloud, Synology y cualquier servidor
// WebDAV. BaseURL es la carpeta remota de Folio, por ejemplo
// https://nube.ejemplo.es/remote.php/dav/files/USUARIO/Folio
// y Password debe ser una contraseña de aplicación.
type WebDAV struct {
	BaseURL  string
	User     string
	Password string
	Client   *http.Client
	// Backoff es la espera inicial entre reintentos (se duplica cada vez).
	Backoff time.Duration

	mu       sync.Mutex
	madeDirs map[string]bool
}

func (w *WebDAV) Name() string { return "WebDAV" }

func (w *WebDAV) client() *http.Client {
	if w.Client != nil {
		return w.Client
	}
	return &http.Client{Timeout: 30 * time.Second}
}

func (w *WebDAV) base() string { return strings.TrimRight(w.BaseURL, "/") }

// urlFor construye la URL de una ruta relativa, codificando cada tramo.
func (w *WebDAV) urlFor(rel string) string {
	if rel == "" {
		return w.base()
	}
	parts := strings.Split(rel, "/")
	for i, p := range parts {
		parts[i] = url.PathEscape(p)
	}
	return w.base() + "/" + strings.Join(parts, "/")
}

// ValidateURL rechaza http:// salvo en el propio equipo: la contraseña no puede viajar sin cifrar.
func ValidateURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return errors.New("la dirección del servidor no es válida")
	}
	host := u.Hostname()
	if u.Scheme == "https" || (u.Scheme == "http" && (host == "localhost" || host == "127.0.0.1" || host == "::1")) {
		return nil
	}
	return errors.New("la dirección debe empezar por https:// para que la contraseña viaje cifrada")
}

// do hace una petición con hasta 3 intentos ante errores de red o respuestas 5xx.
func (w *WebDAV) do(ctx context.Context, method, rawURL string, body []byte, headers map[string]string) (*http.Response, []byte, error) {
	wait := w.Backoff
	if wait == 0 {
		wait = 500 * time.Millisecond
	}
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return nil, nil, ctx.Err()
			case <-time.After(wait):
			}
			wait *= 2
		}
		var rd io.Reader
		if body != nil {
			rd = bytes.NewReader(body)
		}
		req, err := http.NewRequestWithContext(ctx, method, rawURL, rd)
		if err != nil {
			return nil, nil, err
		}
		req.SetBasicAuth(w.User, w.Password)
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		resp, err := w.client().Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		data, rerr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if rerr != nil {
			lastErr = rerr
			continue
		}
		if resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("el servidor respondió %d", resp.StatusCode)
			continue
		}
		if resp.StatusCode == http.StatusUnauthorized {
			return resp, data, errors.New("usuario o contraseña incorrectos (usa una contraseña de aplicación)")
		}
		return resp, data, nil
	}
	return nil, nil, lastErr
}

type multistatus struct {
	Responses []struct {
		Href      string `xml:"href"`
		Propstats []struct {
			Status string `xml:"status"`
			Prop   struct {
				Etag     string `xml:"getetag"`
				Length   int64  `xml:"getcontentlength"`
				Modified string `xml:"getlastmodified"`
				Type     struct {
					Collection *struct{} `xml:"collection"`
				} `xml:"resourcetype"`
			} `xml:"prop"`
		} `xml:"propstat"`
	} `xml:"response"`
}

const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:getcontentlength/><d:getlastmodified/><d:resourcetype/></d:prop></d:propfind>`

type davEntry struct {
	rel     string
	dir     bool
	etag    string
	size    int64
	modTime time.Time
}

// propfind lista una carpeta (Depth 1) o un archivo (Depth 0). 404 → nil, false.
func (w *WebDAV) propfind(ctx context.Context, rel string, depth string) ([]davEntry, bool, error) {
	resp, data, err := w.do(ctx, "PROPFIND", w.urlFor(rel), []byte(propfindBody),
		map[string]string{"Depth": depth, "Content-Type": "application/xml; charset=utf-8"})
	if err != nil {
		return nil, false, err
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil, false, nil
	}
	if resp.StatusCode != http.StatusMultiStatus {
		return nil, false, fmt.Errorf("PROPFIND %s: respuesta %d", rel, resp.StatusCode)
	}
	var ms multistatus
	if err := xml.Unmarshal(data, &ms); err != nil {
		return nil, false, fmt.Errorf("respuesta WebDAV no válida: %w", err)
	}
	baseURL, _ := url.Parse(w.base())
	basePath := strings.TrimRight(baseURL.Path, "/")
	var out []davEntry
	for _, r := range ms.Responses {
		href, err := url.Parse(strings.TrimSpace(r.Href))
		if err != nil {
			continue
		}
		p := href.Path // ya decodificada
		p = strings.TrimRight(p, "/")
		relPath := strings.TrimPrefix(p, basePath)
		relPath = strings.TrimPrefix(relPath, "/")
		e := davEntry{rel: relPath}
		for _, ps := range r.Propstats {
			if !strings.Contains(ps.Status, " 200") {
				continue
			}
			e.etag = ps.Prop.Etag
			e.size = ps.Prop.Length
			e.dir = ps.Prop.Type.Collection != nil
			if t, err := http.ParseTime(ps.Prop.Modified); err == nil {
				e.modTime = t
			}
		}
		out = append(out, e)
	}
	return out, true, nil
}

func (w *WebDAV) List(ctx context.Context) ([]RemoteFile, error) {
	var files []RemoteFile
	var walk func(dir string) error
	walk = func(dir string) error {
		entries, found, err := w.propfind(ctx, dir, "1")
		if err != nil {
			return err
		}
		if !found {
			if dir == "" { // la carpeta de Folio todavía no existe
				return w.mkcol(ctx, "")
			}
			return nil
		}
		for _, e := range entries {
			if e.rel == dir || e.rel == "" {
				continue // la propia carpeta
			}
			if e.dir {
				if err := walk(e.rel); err != nil {
					return err
				}
				continue
			}
			files = append(files, RemoteFile{Path: e.rel, Rev: e.etag, Size: e.size, Modified: e.modTime})
		}
		return nil
	}
	return files, walk("")
}

func (w *WebDAV) mkcol(ctx context.Context, rel string) error {
	resp, _, err := w.do(ctx, "MKCOL", w.urlFor(rel), nil, nil)
	if err != nil {
		return err
	}
	switch resp.StatusCode {
	case http.StatusCreated, http.StatusMethodNotAllowed, http.StatusOK: // 405: ya existe
		return nil
	}
	return fmt.Errorf("no se pudo crear la carpeta %q (respuesta %d)", rel, resp.StatusCode)
}

// ensureDirs crea las carpetas que faltan por encima de un archivo.
func (w *WebDAV) ensureDirs(ctx context.Context, rel string) error {
	dir := path.Dir(rel)
	if dir == "." {
		return nil
	}
	w.mu.Lock()
	if w.madeDirs == nil {
		w.madeDirs = map[string]bool{}
	}
	w.mu.Unlock()
	parts := strings.Split(dir, "/")
	for i := range parts {
		sub := strings.Join(parts[:i+1], "/")
		w.mu.Lock()
		done := w.madeDirs[sub]
		w.mu.Unlock()
		if done {
			continue
		}
		if err := w.mkcol(ctx, sub); err != nil {
			return err
		}
		w.mu.Lock()
		w.madeDirs[sub] = true
		w.mu.Unlock()
	}
	return nil
}

func (w *WebDAV) Get(ctx context.Context, rel string) ([]byte, string, error) {
	resp, data, err := w.do(ctx, "GET", w.urlFor(rel), nil, nil)
	if err != nil {
		return nil, "", err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("no se pudo leer %s (respuesta %d)", rel, resp.StatusCode)
	}
	rev := resp.Header.Get("ETag")
	if rev == "" {
		rev = w.etagOf(ctx, rel)
	}
	return data, rev, nil
}

func (w *WebDAV) etagOf(ctx context.Context, rel string) string {
	entries, found, err := w.propfind(ctx, rel, "0")
	if err != nil || !found || len(entries) == 0 {
		return ""
	}
	return entries[0].etag
}

func (w *WebDAV) Put(ctx context.Context, rel string, data []byte, ifRev string) (string, error) {
	if err := w.ensureDirs(ctx, rel); err != nil {
		return "", err
	}
	headers := map[string]string{"Content-Type": "application/octet-stream"}
	switch ifRev {
	case AnyRev:
	case CreateOnly:
		headers["If-None-Match"] = "*"
	default:
		headers["If-Match"] = ifRev
	}
	resp, _, err := w.do(ctx, "PUT", w.urlFor(rel), data, headers)
	if err != nil {
		return "", err
	}
	switch resp.StatusCode {
	case http.StatusCreated, http.StatusNoContent, http.StatusOK:
	case http.StatusPreconditionFailed:
		return "", ErrConflict
	case http.StatusConflict: // faltaba una carpeta (alguien la borró): se vuelve a crear
		w.mu.Lock()
		w.madeDirs = nil
		w.mu.Unlock()
		return "", fmt.Errorf("no se pudo guardar %s (respuesta %d)", rel, resp.StatusCode)
	default:
		return "", fmt.Errorf("no se pudo guardar %s (respuesta %d)", rel, resp.StatusCode)
	}
	rev := resp.Header.Get("ETag")
	if rev == "" {
		rev = resp.Header.Get("OC-ETag")
	}
	if rev == "" {
		rev = w.etagOf(ctx, rel)
	}
	return rev, nil
}

func (w *WebDAV) Delete(ctx context.Context, rel string, ifRev string) error {
	headers := map[string]string{}
	if ifRev != AnyRev && ifRev != CreateOnly {
		headers["If-Match"] = ifRev
	}
	resp, _, err := w.do(ctx, "DELETE", w.urlFor(rel), nil, headers)
	if err != nil {
		return err
	}
	switch resp.StatusCode {
	case http.StatusNotFound, http.StatusNoContent, http.StatusOK, http.StatusAccepted:
		return nil
	case http.StatusPreconditionFailed:
		return ErrConflict
	}
	return fmt.Errorf("no se pudo borrar %s (respuesta %d)", rel, resp.StatusCode)
}

// Test comprueba la conexión y las credenciales (y crea la carpeta si no existe).
func (w *WebDAV) Test(ctx context.Context) error {
	_, err := w.List(ctx)
	return err
}
