package cloudsync

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"path"
	"sort"
	"strings"
	"sync"
	"time"
)

// Drive es un proveedor para Google Drive (API REST v3) con el ámbito
// drive.file: Folio solo ve lo que crea él mismo, en una carpeta «Folio».
type Drive struct {
	// Token devuelve un token de acceso válido (cada plataforma sabe obtenerlo).
	Token func(ctx context.Context) (string, error)

	Client     *http.Client
	APIBase    string // por defecto https://www.googleapis.com
	RootName   string // por defecto «Folio»
	Backoff    time.Duration
	pageSize   int
	mu         sync.Mutex
	rootID     string
	ids        map[string]string // ruta → id (archivos y carpetas)
	folderPath map[string]bool
}

const (
	driveFolderMime = "application/vnd.google-apps.folder"
	driveFields     = "nextPageToken,files(id,name,mimeType,md5Checksum,size,modifiedTime)"
)

func (d *Drive) Name() string { return "Google Drive" }

func (d *Drive) base() string {
	if d.APIBase != "" {
		return strings.TrimRight(d.APIBase, "/")
	}
	return "https://www.googleapis.com"
}

func (d *Drive) client() *http.Client {
	if d.Client != nil {
		return d.Client
	}
	return &http.Client{Timeout: 60 * time.Second}
}

func (d *Drive) rootName() string {
	if d.RootName != "" {
		return d.RootName
	}
	return "Folio"
}

// call hace una petición con autenticación; reintenta con espera si Google limita el ritmo
// y vuelve a pedir el token una vez si ha caducado.
func (d *Drive) call(ctx context.Context, method, rawURL string, body []byte, contentType string) (*http.Response, []byte, error) {
	wait := d.Backoff
	if wait == 0 {
		wait = time.Second
	}
	refreshed := false
	var lastErr error
	for attempt := 0; attempt < 5; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return nil, nil, ctx.Err()
			case <-time.After(wait):
			}
			wait *= 2
		}
		tok, err := d.Token(ctx)
		if err != nil {
			return nil, nil, err
		}
		var rd io.Reader
		if body != nil {
			rd = bytes.NewReader(body)
		}
		req, err := http.NewRequestWithContext(ctx, method, rawURL, rd)
		if err != nil {
			return nil, nil, err
		}
		req.Header.Set("Authorization", "Bearer "+tok)
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		resp, err := d.client().Do(req)
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
		switch {
		case resp.StatusCode == http.StatusUnauthorized && !refreshed:
			refreshed = true // el siguiente intento pide otro token
			lastErr = errors.New("la sesión de Google ha caducado")
			continue
		case resp.StatusCode == http.StatusUnauthorized:
			return resp, data, errors.New("Google ha rechazado el acceso: vuelve a vincular la cuenta")
		case resp.StatusCode == http.StatusTooManyRequests, resp.StatusCode >= 500,
			resp.StatusCode == http.StatusForbidden && bytes.Contains(data, []byte("ateLimitExceeded")):
			lastErr = fmt.Errorf("Google responde %d", resp.StatusCode)
			continue
		}
		return resp, data, nil
	}
	return nil, nil, lastErr
}

func (d *Drive) apiURL(p string, q url.Values) string {
	u := d.base() + p
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	return u
}

type driveFile struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	MimeType string `json:"mimeType"`
	MD5      string `json:"md5Checksum"`
	Size     string `json:"size"`
	Modified string `json:"modifiedTime"`
}

func (d *Drive) children(ctx context.Context, folderID string) ([]driveFile, error) {
	var out []driveFile
	token := ""
	for {
		q := url.Values{"q": {fmt.Sprintf("'%s' in parents and trashed=false", folderID)}, "fields": {driveFields}, "pageSize": {"1000"}}
		if token != "" {
			q.Set("pageToken", token)
		}
		resp, data, err := d.call(ctx, "GET", d.apiURL("/drive/v3/files", q), nil, "")
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("Google Drive: respuesta %d al listar", resp.StatusCode)
		}
		var page struct {
			Files         []driveFile `json:"files"`
			NextPageToken string      `json:"nextPageToken"`
		}
		if err := json.Unmarshal(data, &page); err != nil {
			return nil, err
		}
		out = append(out, page.Files...)
		if page.NextPageToken == "" {
			return out, nil
		}
		token = page.NextPageToken
	}
}

// ensureRoot busca (o crea) la carpeta «Folio».
func (d *Drive) ensureRoot(ctx context.Context) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.rootID != "" {
		return d.rootID, nil
	}
	q := url.Values{
		"q":      {fmt.Sprintf("name='%s' and mimeType='%s' and trashed=false and appProperties has { key='folio' and value='root' }", d.rootName(), driveFolderMime)},
		"fields": {"files(id)"},
	}
	resp, data, err := d.call(ctx, "GET", d.apiURL("/drive/v3/files", q), nil, "")
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Google Drive: respuesta %d al buscar la carpeta", resp.StatusCode)
	}
	var found struct {
		Files []driveFile `json:"files"`
	}
	_ = json.Unmarshal(data, &found)
	if len(found.Files) > 0 {
		d.rootID = found.Files[0].ID
		return d.rootID, nil
	}
	id, err := d.createFolder(ctx, d.rootName(), "root", map[string]string{"folio": "root"})
	if err != nil {
		return "", err
	}
	d.rootID = id
	return id, nil
}

func (d *Drive) createFolder(ctx context.Context, name, parent string, props map[string]string) (string, error) {
	meta := map[string]any{"name": name, "mimeType": driveFolderMime, "parents": []string{parent}}
	if props != nil {
		meta["appProperties"] = props
	}
	body, _ := json.Marshal(meta)
	resp, data, err := d.call(ctx, "POST", d.apiURL("/drive/v3/files", url.Values{"fields": {"id"}}), body, "application/json")
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("no se pudo crear la carpeta %q en Google Drive (respuesta %d)", name, resp.StatusCode)
	}
	var f driveFile
	if err := json.Unmarshal(data, &f); err != nil || f.ID == "" {
		return "", errors.New("Google Drive no devolvió el identificador de la carpeta")
	}
	return f.ID, nil
}

func (d *Drive) List(ctx context.Context) ([]RemoteFile, error) {
	root, err := d.ensureRoot(ctx)
	if err != nil {
		return nil, err
	}
	ids := map[string]string{}
	folders := map[string]bool{"": true}
	var out []RemoteFile
	var walk func(id, prefix string) error
	walk = func(id, prefix string) error {
		list, err := d.children(ctx, id)
		if err != nil {
			return err
		}
		// Drive permite dos archivos con el mismo nombre: se queda el más reciente
		sort.SliceStable(list, func(i, j int) bool { return list[i].Modified > list[j].Modified })
		seen := map[string]bool{}
		for _, f := range list {
			rel := f.Name
			if prefix != "" {
				rel = prefix + "/" + f.Name
			}
			if seen[f.Name] {
				continue
			}
			seen[f.Name] = true
			ids[rel] = f.ID
			if f.MimeType == driveFolderMime {
				folders[rel] = true
				if err := walk(f.ID, rel); err != nil {
					return err
				}
				continue
			}
			var size int64
			fmt.Sscan(f.Size, &size)
			mod, _ := time.Parse(time.RFC3339Nano, f.Modified)
			out = append(out, RemoteFile{Path: rel, Rev: f.MD5, Size: size, Modified: mod})
		}
		return nil
	}
	if err := walk(root, ""); err != nil {
		return nil, err
	}
	d.mu.Lock()
	d.ids, d.folderPath = ids, folders
	d.mu.Unlock()
	return out, nil
}

func (d *Drive) idOf(rel string) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.ids[rel]
}

func (d *Drive) remember(rel, id string, folder bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.ids == nil {
		d.ids, d.folderPath = map[string]string{}, map[string]bool{"": true}
	}
	d.ids[rel] = id
	if folder {
		d.folderPath[rel] = true
	}
}

// ensureFolders crea las carpetas que faltan y devuelve el id de la carpeta de un archivo.
func (d *Drive) ensureFolders(ctx context.Context, rel string) (string, error) {
	parent, err := d.ensureRoot(ctx)
	if err != nil {
		return "", err
	}
	dir := path.Dir(rel)
	if dir == "." {
		return parent, nil
	}
	parts := strings.Split(dir, "/")
	for i := range parts {
		sub := strings.Join(parts[:i+1], "/")
		if id := d.idOf(sub); id != "" {
			parent = id
			continue
		}
		id, err := d.createFolder(ctx, parts[i], parent, nil)
		if err != nil {
			return "", err
		}
		d.remember(sub, id, true)
		parent = id
	}
	return parent, nil
}

func md5hex(b []byte) string {
	s := md5.Sum(b)
	return hex.EncodeToString(s[:])
}

func (d *Drive) Get(ctx context.Context, rel string) ([]byte, string, error) {
	id := d.idOf(rel)
	if id == "" {
		return nil, "", fmt.Errorf("no se encuentra %s en Google Drive", rel)
	}
	resp, data, err := d.call(ctx, "GET", d.apiURL("/drive/v3/files/"+id, url.Values{"alt": {"media"}}), nil, "")
	if err != nil {
		return nil, "", err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("no se pudo leer %s (respuesta %d)", rel, resp.StatusCode)
	}
	return data, md5hex(data), nil // la revisión de Drive es el MD5 del contenido
}

// currentRev lee la revisión (MD5) actual de un archivo; "" si ya no existe.
func (d *Drive) currentRev(ctx context.Context, id string) (string, error) {
	resp, data, err := d.call(ctx, "GET", d.apiURL("/drive/v3/files/"+id, url.Values{"fields": {"md5Checksum,trashed"}}), nil, "")
	if err != nil {
		return "", err
	}
	if resp.StatusCode == http.StatusNotFound {
		return "", nil
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Google Drive: respuesta %d", resp.StatusCode)
	}
	var f struct {
		MD5     string `json:"md5Checksum"`
		Trashed bool   `json:"trashed"`
	}
	_ = json.Unmarshal(data, &f)
	if f.Trashed {
		return "", nil
	}
	return f.MD5, nil
}

func (d *Drive) Put(ctx context.Context, rel string, data []byte, ifRev string) (string, error) {
	id := d.idOf(rel)
	if id != "" {
		if ifRev == CreateOnly {
			return "", ErrConflict
		}
		// Drive no tiene «If-Match»: se comprueba justo antes de escribir
		if ifRev != AnyRev {
			cur, err := d.currentRev(ctx, id)
			if err != nil {
				return "", err
			}
			if cur != ifRev {
				return "", ErrConflict
			}
		}
		resp, body, err := d.call(ctx, "PATCH",
			d.apiURL("/upload/drive/v3/files/"+id, url.Values{"uploadType": {"media"}, "fields": {"md5Checksum"}}), data, "application/octet-stream")
		if err != nil {
			return "", err
		}
		if resp.StatusCode == http.StatusNotFound {
			return "", ErrConflict
		}
		if resp.StatusCode != http.StatusOK {
			return "", fmt.Errorf("no se pudo guardar %s (respuesta %d)", rel, resp.StatusCode)
		}
		var f driveFile
		_ = json.Unmarshal(body, &f)
		if f.MD5 == "" {
			f.MD5 = md5hex(data)
		}
		return f.MD5, nil
	}
	if ifRev != CreateOnly && ifRev != AnyRev {
		return "", ErrConflict // el archivo que se esperaba ya no existe
	}
	parent, err := d.ensureFolders(ctx, rel)
	if err != nil {
		return "", err
	}
	meta, _ := json.Marshal(map[string]any{"name": path.Base(rel), "parents": []string{parent}})
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	h := textproto.MIMEHeader{"Content-Type": {"application/json; charset=UTF-8"}}
	pw, _ := mw.CreatePart(h)
	pw.Write(meta)
	pw, _ = mw.CreatePart(textproto.MIMEHeader{"Content-Type": {"application/octet-stream"}})
	pw.Write(data)
	mw.Close()
	resp, body, err := d.call(ctx, "POST",
		d.apiURL("/upload/drive/v3/files", url.Values{"uploadType": {"multipart"}, "fields": {"id,md5Checksum"}}),
		buf.Bytes(), "multipart/related; boundary="+mw.Boundary())
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("no se pudo crear %s (respuesta %d)", rel, resp.StatusCode)
	}
	var f driveFile
	if err := json.Unmarshal(body, &f); err != nil || f.ID == "" {
		return "", errors.New("Google Drive no devolvió el identificador del archivo")
	}
	d.remember(rel, f.ID, false)
	if f.MD5 == "" {
		f.MD5 = md5hex(data)
	}
	return f.MD5, nil
}

// Delete manda el archivo a la papelera de Drive, de donde se puede recuperar.
func (d *Drive) Delete(ctx context.Context, rel string, ifRev string) error {
	id := d.idOf(rel)
	if id == "" {
		return nil
	}
	if ifRev != AnyRev && ifRev != CreateOnly {
		cur, err := d.currentRev(ctx, id)
		if err != nil {
			return err
		}
		if cur == "" {
			return nil
		}
		if cur != ifRev {
			return ErrConflict
		}
	}
	resp, _, err := d.call(ctx, "PATCH", d.apiURL("/drive/v3/files/"+id, url.Values{"fields": {"id"}}), []byte(`{"trashed":true}`), "application/json")
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNotFound {
		return fmt.Errorf("no se pudo borrar %s (respuesta %d)", rel, resp.StatusCode)
	}
	d.mu.Lock()
	delete(d.ids, rel)
	d.mu.Unlock()
	return nil
}

// randomID genera identificadores para el Drive falso de las pruebas.
func randomID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
