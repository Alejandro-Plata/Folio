// Package mobile expone el núcleo de Folio a Android con gomobile: un
// despachador genérico (Call) y un canal de eventos hacia Java. Solo usa
// tipos que gomobile admite (cadenas, bool, error); todo lo demás va en JSON.
package mobile

import (
	"encoding/json"
	"errors"
	"sync"

	"folio/internal/core"
)

// EventSink lo implementa Java para recibir eventos del núcleo.
type EventSink interface {
	Emit(name string, payloadJSON string)
}

// SecretStore lo implementa Java (EncryptedSharedPreferences) para guardar la
// sesión de la cuenta. Get devuelve "" si no hay nada.
type SecretStore interface {
	Get(key string) string
	Set(key, value string)
	Delete(key string)
}

var (
	mu      sync.Mutex
	svc     *core.Service
	sink    EventSink
	secrets SecretStore
)

// SetSecretStore registra el almacén seguro (llamar antes de Start).
func SetSecretStore(s SecretStore) {
	mu.Lock()
	secrets = s
	mu.Unlock()
}

// secretsAdapter adapta SecretStore (sin errores, por gomobile) a social.Secrets.
type secretsAdapter struct{ s SecretStore }

func (a secretsAdapter) Get(k string) (string, error) { return a.s.Get(k), nil }
func (a secretsAdapter) Set(k, v string) error        { a.s.Set(k, v); return nil }
func (a secretsAdapter) Delete(k string) error        { a.s.Delete(k); return nil }

// SetEventSink registra el receptor de eventos (llamar antes de Start).
func SetEventSink(s EventSink) {
	mu.Lock()
	sink = s
	mu.Unlock()
}

// Start abre el núcleo con las carpetas privadas de la app.
func Start(configDir, workspaceDir, version string) error {
	mu.Lock()
	defer mu.Unlock()
	if svc != nil {
		return nil
	}
	opt := core.Options{
		ConfigDir: configDir, Workspace: workspaceDir, OS: "android", Version: version,
		Emit: func(name string, data ...any) {
			mu.Lock()
			out := sink
			mu.Unlock()
			if out == nil {
				return
			}
			b, _ := json.Marshal(data)
			out.Emit(name, string(b))
		},
	}
	if secrets != nil {
		opt.Secrets = secretsAdapter{secrets}
	}
	s, err := core.New(opt)
	if err != nil {
		return err
	}
	svc = s
	return nil
}

func current() (*core.Service, error) {
	mu.Lock()
	defer mu.Unlock()
	if svc == nil {
		return nil, errors.New("el núcleo no está iniciado")
	}
	return svc, nil
}

// Call ejecuta una función del núcleo con los argumentos en un array JSON y
// devuelve el resultado en JSON.
func Call(method, argsJSON string) (string, error) {
	s, err := current()
	if err != nil {
		return "", err
	}
	return core.Dispatch(s, method, argsJSON)
}

// AssetPath traduce «/files/<doc>/<archivo>» a la ruta del archivo (para el WebView).
func AssetPath(url string) (string, error) {
	s, err := current()
	if err != nil {
		return "", err
	}
	return s.AssetPath(url)
}

// Stop guarda lo pendiente (versión «al cerrar»).
func Stop() {
	if s, err := current(); err == nil {
		s.Shutdown()
	}
}
