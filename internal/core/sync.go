package core

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"

	"folio/internal/cloudsync"
)

// SyncConfig es la nube vinculada. Las credenciales (contraseña de WebDAV, tokens
// de Google) NO se guardan aquí: las guarda cada plataforma en su almacén seguro.
type SyncConfig struct {
	Provider   string `json:"provider"` // "" (sin vincular) | webdav | gdrive
	URL        string `json:"url"`      // WebDAV: carpeta remota completa
	User       string `json:"user"`     // WebDAV: usuario
	DeviceID   string `json:"deviceId"`
	DeviceName string `json:"deviceName"`
	LastSync   string `json:"lastSync"` // RFC 3339
	LastError  string `json:"lastError"`
}

type SyncStatus struct {
	Config  SyncConfig `json:"config"`
	Linked  bool       `json:"linked"`
	Running bool       `json:"running"`
}

func (s *Service) syncConfig() SyncConfig {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.settings.Sync
}

// updateSync cambia la configuración de la sincronización y la guarda.
func (s *Service) updateSync(change func(*SyncConfig)) (SyncConfig, error) {
	s.mu.Lock()
	change(&s.settings.Sync)
	cfg := s.settings
	s.mu.Unlock()
	if err := os.MkdirAll(s.opt.ConfigDir, 0o755); err != nil {
		return cfg.Sync, err
	}
	b, _ := json.MarshalIndent(cfg, "", "  ")
	return cfg.Sync, os.WriteFile(s.settingsPath(), b, 0o644)
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func defaultDeviceName(goos string) string {
	switch goos {
	case "android":
		return "Móvil Android"
	case "windows":
		return "Windows"
	}
	if h, err := os.Hostname(); err == nil && h != "" {
		return h
	}
	return "Linux"
}

// SyncStatus devuelve el estado de la sincronización.
func (s *Service) SyncStatus() SyncStatus {
	cfg := s.syncConfig()
	return SyncStatus{Config: cfg, Linked: cfg.Provider != "", Running: s.syncing.Load()}
}

// SyncConfigure vincula (o cambia) la nube. Si cambia el proveedor o la carpeta
// se olvida el estado anterior: la primera sincronización junta lo de las dos partes.
func (s *Service) SyncConfigure(cfg SyncConfig) (SyncConfig, error) {
	switch cfg.Provider {
	case "webdav":
		if err := cloudsync.ValidateURL(cfg.URL); err != nil {
			return SyncConfig{}, err
		}
		if strings.TrimSpace(cfg.User) == "" {
			return SyncConfig{}, errors.New("falta el usuario")
		}
	case "gdrive":
		cfg.URL, cfg.User = "", ""
	default:
		return SyncConfig{}, errors.New("proveedor de nube no válido")
	}
	old := s.syncConfig()
	changed := old.Provider != cfg.Provider || old.URL != cfg.URL || old.User != cfg.User
	if changed {
		if err := cloudsync.ResetState(s.st().Root()); err != nil {
			return SyncConfig{}, err
		}
	}
	return s.updateSync(func(c *SyncConfig) {
		c.Provider, c.URL, c.User = cfg.Provider, strings.TrimSpace(cfg.URL), strings.TrimSpace(cfg.User)
		if c.DeviceID == "" {
			c.DeviceID = randomHex(8)
		}
		name := strings.TrimSpace(cfg.DeviceName)
		if name == "" {
			name = c.DeviceName
		}
		if name == "" {
			name = defaultDeviceName(s.opt.OS)
		}
		c.DeviceName = name
		if changed {
			c.LastSync, c.LastError = "", ""
		}
	})
}

// SyncSetDeviceName cambia el nombre de este dispositivo (sale en las versiones de conflicto).
func (s *Service) SyncSetDeviceName(name string) error {
	_, err := s.updateSync(func(c *SyncConfig) { c.DeviceName = strings.TrimSpace(name) })
	return err
}

// SyncUnlink desvincula la nube. No borra nada, ni aquí ni en la nube.
func (s *Service) SyncUnlink() error {
	if err := cloudsync.ResetState(s.st().Root()); err != nil {
		return err
	}
	_, err := s.updateSync(func(c *SyncConfig) {
		c.Provider, c.URL, c.User, c.LastSync, c.LastError = "", "", "", "", ""
	})
	return err
}

func (s *Service) provider(cfg SyncConfig, secret string) (cloudsync.Provider, error) {
	switch cfg.Provider {
	case "webdav":
		if secret == "" {
			return nil, errors.New("falta la contraseña de la nube; vuelve a vincularla")
		}
		return &cloudsync.WebDAV{BaseURL: cfg.URL, User: cfg.User, Password: secret}, nil
	case "gdrive":
		if secret == "" {
			return nil, errors.New("falta el permiso de Google Drive; vuelve a vincular la cuenta")
		}
		return &cloudsync.Drive{Token: func(context.Context) (string, error) { return secret, nil }}, nil
	}
	return nil, errors.New("no hay ninguna nube vinculada")
}

// SyncTest comprueba la conexión (y crea la carpeta de Folio si no existe).
func (s *Service) SyncTest(cfg SyncConfig, secret string) error {
	if cfg.Provider == "webdav" {
		if err := cloudsync.ValidateURL(cfg.URL); err != nil {
			return err
		}
	}
	p, err := s.provider(cfg, secret)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, err = p.List(ctx)
	return err
}

// SyncResult es lo que la interfaz recibe al terminar una sincronización.
type SyncResult struct {
	cloudsync.Report
	At string `json:"at"`
}

// SyncNow sincroniza. `secret` es la contraseña (WebDAV) o el token de acceso
// (Google Drive), que la plataforma saca de su almacén seguro. La interfaz debe
// guardar antes lo que tenga pendiente.
func (s *Service) SyncNow(secret string) (SyncResult, error) {
	cfg := s.syncConfig()
	if cfg.Provider == "" {
		return SyncResult{}, errors.New("no hay ninguna nube vinculada")
	}
	if s.realAgenda.Load() != nil {
		return SyncResult{Report: cloudsync.Report{Skipped: true}}, nil // tutorial de la agenda en curso
	}
	prov, err := s.provider(cfg, secret)
	if err != nil {
		return SyncResult{}, err
	}
	if !s.syncing.CompareAndSwap(false, true) {
		return SyncResult{Report: cloudsync.Report{Skipped: true}}, nil
	}
	defer s.syncing.Store(false)
	s.emit("sync:start")

	eng := &cloudsync.Engine{
		Root: s.st().Root(), Provider: prov, Device: cfg.DeviceName,
		Progress: func(done, total int) { s.emit("sync:progress", done, total) },
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	rep, err := eng.Sync(ctx)
	res := SyncResult{Report: *rep, At: time.Now().Format(time.RFC3339)}
	if rep.Skipped {
		return res, nil
	}
	if err == nil && len(rep.Errors) > 0 {
		err = errors.New(rep.Errors[0])
	}

	if rep.Changed || len(rep.Extras) > 0 {
		// Los archivos han cambiado en disco: se vuelven a abrir los almacenes
		if rerr := s.openWorkspace(s.st().Root()); rerr != nil {
			err = rerr
		} else {
			for _, x := range rep.Extras {
				if x.Kind == "version" {
					_, _ = s.st().ImportVersion(x.DocID, x.Data, x.Label)
				}
			}
		}
	}
	_, _ = s.updateSync(func(c *SyncConfig) {
		if err == nil {
			c.LastSync, c.LastError = res.At, ""
		} else {
			c.LastError = err.Error()
		}
	})
	s.emit("sync:done", res)
	if rep.Changed {
		s.emit("sync:changed", map[string]any{"docs": rep.DocsChanged, "agenda": rep.AgendaChanged})
	}
	return res, err
}
