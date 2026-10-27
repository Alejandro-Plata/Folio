package cloudsync

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// memProvider es una nube en memoria con revisiones que cambian en cada escritura.
type memProvider struct {
	mu    sync.Mutex
	files map[string]*memFile
	rev   int
	ops   int // operaciones de escritura/lectura hechas (para simular cortes)

	conflicts int // veces que se ha devuelto ErrConflict

	failAfter int            // si > 0, todas las operaciones tras ésta fallan
	beforePut func(p string) // se ejecuta antes de cada Put (simula otro dispositivo)
	clock     func() time.Time
}

type memFile struct {
	data []byte
	rev  string
	mod  time.Time
}

func newMem() *memProvider {
	return &memProvider{files: map[string]*memFile{}, clock: time.Now}
}

func (m *memProvider) Name() string { return "memoria" }

func (m *memProvider) count() error {
	m.ops++
	if m.failAfter > 0 && m.ops > m.failAfter {
		return errors.New("sin conexión")
	}
	return nil
}

func (m *memProvider) List(context.Context) ([]RemoteFile, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.count(); err != nil {
		return nil, err
	}
	var out []RemoteFile
	for p, f := range m.files {
		out = append(out, RemoteFile{Path: p, Rev: f.rev, Size: int64(len(f.data)), Modified: f.mod})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

func (m *memProvider) Get(_ context.Context, p string) ([]byte, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.count(); err != nil {
		return nil, "", err
	}
	f, ok := m.files[p]
	if !ok {
		return nil, "", errors.New("no existe " + p)
	}
	return append([]byte(nil), f.data...), f.rev, nil
}

func (m *memProvider) Put(_ context.Context, p string, data []byte, ifRev string) (string, error) {
	if m.beforePut != nil {
		m.beforePut(p) // el gancho se quita a sí mismo si solo debe actuar una vez
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.count(); err != nil {
		return "", err
	}
	cur, exists := m.files[p]
	switch {
	case ifRev == AnyRev:
	case ifRev == CreateOnly && exists:
		m.conflicts++
		return "", ErrConflict
	case ifRev != CreateOnly && (!exists || cur.rev != ifRev):
		m.conflicts++
		return "", ErrConflict
	}
	m.rev++
	f := &memFile{data: append([]byte(nil), data...), rev: "r" + strconv.Itoa(m.rev), mod: m.clock()}
	m.files[p] = f
	return f.rev, nil
}

func (m *memProvider) Delete(_ context.Context, p string, ifRev string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.count(); err != nil {
		return err
	}
	cur, ok := m.files[p]
	if !ok {
		return nil
	}
	if ifRev != AnyRev && cur.rev != ifRev {
		return ErrConflict
	}
	delete(m.files, p)
	return nil
}

func (m *memProvider) has(prefix string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for p := range m.files {
		if strings.HasPrefix(p, prefix) {
			return true
		}
	}
	return false
}
