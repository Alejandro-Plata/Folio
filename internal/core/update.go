package core

import (
	"context"
	"path/filepath"
	"runtime"

	"folio/internal/update"
)

// Actualizaciones: comprobar y descargar (instalar depende de cada plataforma).

func (s *Service) checker() *update.Checker {
	return &update.Checker{Current: s.opt.Version, OS: s.opt.OS, Arch: runtime.GOARCH}
}

// UpdateCheck consulta la última versión publicada.
func (s *Service) UpdateCheck() (update.Info, error) {
	return s.checker().Check(context.Background())
}

// UpdateDownload descarga y verifica la versión nueva; devuelve la ruta del
// archivo. Avisa del progreso con «update:progress» {done, total}.
func (s *Service) UpdateDownload() (string, error) {
	return s.checker().Download(context.Background(), filepath.Join(s.opt.ConfigDir, "updates"), func(done, total int64) {
		s.emit("update:progress", map[string]int64{"done": done, "total": total})
	})
}
