package cloudsync

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	gosync "sync"
	"time"

	"folio/internal/fsutil"
)

// Report resume una sincronización.
type Report struct {
	Skipped       bool     `json:"skipped"` // ya había otra en curso
	Uploaded      int      `json:"uploaded"`
	Downloaded    int      `json:"downloaded"`
	Merged        int      `json:"merged"`
	DeletedLocal  int      `json:"deletedLocal"`
	DeletedRemote int      `json:"deletedRemote"`
	Changed       bool     `json:"changed"`       // algún archivo local ha cambiado
	DocsChanged   []string `json:"docsChanged"`   // documentos con archivos cambiados aquí
	AgendaChanged bool     `json:"agendaChanged"` // la agenda ha cambiado aquí
	GastosChanged bool     `json:"gastosChanged"` // Gastos ha cambiado aquí
	Extras        []Extra  `json:"-"`             // versiones de conflicto por guardar en el historial
	Conflicts     int      `json:"conflicts"`     // documentos con versión de conflicto
	Errors        []string `json:"errors"`
}

// Engine sincroniza el espacio `Root` con un proveedor.
type Engine struct {
	Root     string
	Provider Provider
	Device   string
	// Progress se llama tras cada archivo (hechos, total).
	Progress func(done, total int)
	Now      func() time.Time

	mu gosync.Mutex
}

// errSkip indica que un archivo se deja para la siguiente pasada.
var errSkip = errors.New("se deja para la siguiente sincronización")

// priority ordena los archivos: primero los que otros archivos referencian
// (imágenes y blobs de versiones), el meta.json de cada documento el último
// (así un documento no aparece a medias).
func priority(path string) int {
	switch Classify(path) {
	case KindImmutable:
		return 0
	case KindDocContent, KindDocText:
		return 1
	case KindVersionsIndex:
		return 2
	case KindDocMeta:
		return 3
	}
	return 1
}

func (e *Engine) now() time.Time {
	if e.Now != nil {
		return e.Now()
	}
	return time.Now()
}

// Sync hace una pasada completa. Solo una a la vez: si ya hay otra, vuelve sin hacer nada.
func (e *Engine) Sync(ctx context.Context) (*Report, error) {
	if !e.mu.TryLock() {
		return &Report{Skipped: true}, nil
	}
	defer e.mu.Unlock()

	rep := &Report{}
	st := loadState(e.Root)
	defer func() { _ = st.save(e.Root) }()

	local, err := scanLocal(e.Root, st)
	if err != nil {
		return rep, fmt.Errorf("no se pudieron leer los documentos: %w", err)
	}
	remoteList, err := e.Provider.List(ctx)
	if err != nil {
		return rep, fmt.Errorf("no se pudo leer la nube: %w", err)
	}
	remote := map[string]*RemoteFile{}
	for i := range remoteList {
		if !ignored(remoteList[i].Path) {
			remote[remoteList[i].Path] = &remoteList[i]
		}
	}

	paths := map[string]bool{}
	for p := range local {
		paths[p] = true
	}
	for p := range remote {
		paths[p] = true
	}
	for p := range st.Files {
		paths[p] = true
	}
	order := make([]string, 0, len(paths))
	for p := range paths {
		order = append(order, p)
	}
	sort.Slice(order, func(i, j int) bool {
		if pi, pj := priority(order[i]), priority(order[j]); pi != pj {
			return pi < pj
		}
		return order[i] < order[j]
	})

	docs := map[string]bool{}
	total, done, fails := len(order), 0, 0
	var retry []string
	step := func(p string, l *localFile, r *RemoteFile) {
		err := e.syncPath(ctx, st, rep, p, l, r, docs)
		switch {
		case err == nil, errors.Is(err, errSkip):
		case errors.Is(err, ErrConflict):
			retry = append(retry, p)
		default:
			rep.Errors = append(rep.Errors, fmt.Sprintf("%s: %v", p, err))
			fails++
		}
		done++
		if e.Progress != nil {
			e.Progress(done, total)
		}
		if done%25 == 0 {
			_ = st.save(e.Root)
		}
	}
	for _, p := range order {
		if ctx.Err() != nil {
			break
		}
		if fails >= 5 { // la conexión está mal: no se sigue insistiendo
			rep.Errors = append(rep.Errors, "demasiados errores seguidos; se reintentará más tarde")
			break
		}
		step(p, local[p], remote[p])
	}

	// Archivos que cambiaron en la nube mientras se subían: se vuelven a mirar (hasta 3 veces)
	for pass := 0; pass < 3 && len(retry) > 0 && ctx.Err() == nil; pass++ {
		list, err := e.Provider.List(ctx)
		if err != nil {
			break
		}
		fresh := map[string]*RemoteFile{}
		for i := range list {
			fresh[list[i].Path] = &list[i]
		}
		again := retry
		retry = nil
		total += len(again)
		for _, p := range again {
			var l *localFile
			if lf, err := e.localInfo(p); err == nil {
				l = lf
			}
			step(p, l, fresh[p])
		}
	}
	for _, p := range retry {
		rep.Errors = append(rep.Errors, fmt.Sprintf("%s: %v", p, ErrConflict))
	}
	for id := range docs {
		rep.DocsChanged = append(rep.DocsChanged, id)
	}
	sort.Strings(rep.DocsChanged)
	if err := st.save(e.Root); err != nil {
		rep.Errors = append(rep.Errors, "no se pudo guardar el estado de la sincronización: "+err.Error())
	}
	return rep, ctx.Err()
}

func (e *Engine) localInfo(rel string) (*localFile, error) {
	p := filepath.Join(e.Root, filepath.FromSlash(rel))
	info, err := os.Stat(p)
	if err != nil {
		return nil, err
	}
	h, err := hashFile(p)
	if err != nil {
		return nil, err
	}
	return &localFile{Hash: h, Size: info.Size(), Mod: info.ModTime().UnixNano()}, nil
}

// syncPath decide y hace lo que corresponde con un archivo (tabla de la guía, § I.3).
func (e *Engine) syncPath(ctx context.Context, st *state, rep *Report, p string, l *localFile, r *RemoteFile, docs map[string]bool) error {
	b := st.Files[p]
	localChanged := l != nil && (b == nil || l.Hash != b.Hash)
	remoteChanged := r != nil && (b == nil || r.Rev != b.Rev)

	switch {
	case l == nil && r == nil:
		delete(st.Files, p)
		return nil

	case l != nil && r != nil:
		switch {
		case !localChanged && !remoteChanged:
			return nil
		case localChanged && !remoteChanged:
			return e.upload(ctx, st, rep, p, l, b.Rev)
		case !localChanged && remoteChanged:
			return e.download(ctx, st, rep, p, l, docs)
		}
		return e.resolve(ctx, st, rep, p, l, r, b, docs)

	case l != nil: // solo en local
		if b == nil || localChanged {
			return e.upload(ctx, st, rep, p, l, CreateOnly)
		}
		// Borrado en la nube y sin cambios aquí: se borra también aquí
		return e.removeLocal(st, rep, p, docs)

	default: // solo en la nube
		if b == nil || remoteChanged {
			return e.download(ctx, st, rep, p, nil, docs)
		}
		// Borrado aquí y sin cambios en la nube: se borra también allí
		if err := e.Provider.Delete(ctx, p, r.Rev); err != nil {
			return err
		}
		delete(st.Files, p)
		_ = os.Remove(basePath(e.Root, p))
		rep.DeletedRemote++
		return nil
	}
}

func (e *Engine) readLocal(p string) ([]byte, error) {
	return os.ReadFile(filepath.Join(e.Root, filepath.FromSlash(p)))
}

func (e *Engine) record(st *state, p string, data []byte, rev string) {
	fs := &fileState{Hash: hashBytes(data), Rev: rev, Size: int64(len(data))}
	if info, err := os.Stat(filepath.Join(e.Root, filepath.FromSlash(p))); err == nil {
		fs.ModNano = info.ModTime().UnixNano()
	}
	st.Files[p] = fs
	if NeedsBase(p) {
		_ = fsutil.WriteFileAtomic(mustParent(basePath(e.Root, p)), data)
	}
}

func mustParent(p string) string {
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	return p
}

func (e *Engine) upload(ctx context.Context, st *state, rep *Report, p string, l *localFile, ifRev string) error {
	data, err := e.readLocal(p)
	if err != nil {
		return err
	}
	// Si el archivo cambió desde que se hizo el inventario, se deja para la próxima
	if hashBytes(data) != l.Hash {
		return errSkip
	}
	rev, err := e.Provider.Put(ctx, p, data, ifRev)
	if err != nil {
		return err
	}
	e.record(st, p, data, rev)
	rep.Uploaded++
	return nil
}

// writeLocal escribe un archivo bajado, salvo que el usuario lo haya tocado mientras tanto.
func (e *Engine) writeLocal(p string, current *localFile, data []byte) error {
	full := filepath.Join(e.Root, filepath.FromSlash(p))
	if cur, err := os.ReadFile(full); err == nil {
		if current == nil || hashBytes(cur) != current.Hash {
			return errSkip
		}
	} else if current != nil {
		return errSkip
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return err
	}
	return fsutil.WriteFileAtomic(full, data)
}

func (e *Engine) touched(p string, rep *Report, docs map[string]bool) {
	rep.Changed = true
	if id := DocID(p); id != "" {
		docs[id] = true
	}
	if strings.HasPrefix(p, "agenda/") {
		rep.AgendaChanged = true
	}
	if strings.HasPrefix(p, "gastos/") {
		rep.GastosChanged = true
	}
}

func (e *Engine) download(ctx context.Context, st *state, rep *Report, p string, l *localFile, docs map[string]bool) error {
	data, rev, err := e.Provider.Get(ctx, p)
	if err != nil {
		return err
	}
	if err := e.writeLocal(p, l, data); err != nil {
		return err
	}
	e.record(st, p, data, rev)
	e.touched(p, rep, docs)
	rep.Downloaded++
	return nil
}

func (e *Engine) removeLocal(st *state, rep *Report, p string, docs map[string]bool) error {
	full := filepath.Join(e.Root, filepath.FromSlash(p))
	if err := os.Remove(full); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	// Carpetas vacías (un documento borrado deja su carpeta)
	for dir := filepath.Dir(full); dir != e.Root && strings.HasPrefix(dir, e.Root); dir = filepath.Dir(dir) {
		if os.Remove(dir) != nil { // solo se quita si está vacía
			break
		}
	}
	delete(st.Files, p)
	_ = os.Remove(basePath(e.Root, p))
	e.touched(p, rep, docs)
	rep.DeletedLocal++
	return nil
}

// resolve fusiona un archivo que ha cambiado en los dos lados.
func (e *Engine) resolve(ctx context.Context, st *state, rep *Report, p string, l *localFile, r *RemoteFile, b *fileState, docs map[string]bool) error {
	localData, err := e.readLocal(p)
	if err != nil {
		return err
	}
	if hashBytes(localData) != l.Hash {
		return errSkip
	}
	remoteData, rev, err := e.Provider.Get(ctx, p)
	if err != nil {
		return err
	}
	if bytes.Equal(localData, remoteData) {
		e.record(st, p, localData, rev) // los dos lados llegaron al mismo contenido
		return nil
	}
	var base []byte
	if b != nil {
		base, _ = os.ReadFile(basePath(e.Root, p))
	}
	var localMod time.Time
	if info, err := os.Stat(filepath.Join(e.Root, filepath.FromSlash(p))); err == nil {
		localMod = info.ModTime()
	}
	merged, extras, err := Merge(MergeInput{
		Path: p, Base: base, Local: localData, Remote: remoteData,
		LocalMod: localMod, RemoteMod: r.Modified, Device: e.Device, Now: e.now(),
	})
	if err != nil {
		return err
	}
	if !bytes.Equal(merged, localData) {
		if err := e.writeLocal(p, l, merged); err != nil {
			return err
		}
		e.touched(p, rep, docs)
	}
	if !bytes.Equal(merged, remoteData) {
		newRev, err := e.Provider.Put(ctx, p, merged, rev)
		if err != nil {
			return err
		}
		rev = newRev
		rep.Uploaded++
	}
	e.record(st, p, merged, rev)
	rep.Merged++
	for _, x := range extras {
		switch x.Kind {
		case "version":
			rep.Conflicts++
			rep.Extras = append(rep.Extras, x)
		case "file":
			// Se guarda junto al original; en la próxima pasada se sube como archivo nuevo
			if err := e.writeLocal(x.Path, nil, x.Data); err == nil {
				e.touched(x.Path, rep, docs)
			}
		}
	}
	return nil
}
