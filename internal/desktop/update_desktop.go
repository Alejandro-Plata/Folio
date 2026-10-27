package desktop

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
)

// UpdateInstall descarga la versión nueva, la verifica y la deja instalada; la
// ventana se cierra (y en Linux se vuelve a abrir) cuando esta función vuelve.
// En Linux sustituye el lanzador autoextraíble (FOLIO_LAUNCHER, el archivo que
// se ejecuta desde el menú); en Windows lanza el instalador en silencio, que
// espera a que Folio se cierre.
func (a *App) UpdateInstall() error {
	path, err := a.UpdateDownload()
	if err != nil {
		return err
	}
	a.Shutdown() // guarda todo antes de cerrar
	switch goruntime.GOOS {
	case "windows":
		cmd := exec.Command(path, "/S")
		hideWindow(cmd)
		if err := cmd.Start(); err != nil {
			return fmt.Errorf("no se pudo abrir el instalador: %w", err)
		}
	case "linux":
		exe := os.Getenv("FOLIO_LAUNCHER")
		if exe == "" {
			return fmt.Errorf("esta copia de Folio no se abrió con su lanzador; descarga la versión nueva a mano")
		}
		if resolved, err := filepath.EvalSymlinks(exe); err == nil {
			exe = resolved
		}
		if err := replaceExecutable(path, exe); err != nil {
			return err
		}
	default:
		return fmt.Errorf("instalar actualizaciones no está disponible en %s", goruntime.GOOS)
	}
	return nil
}

// replaceExecutable copia el binario nuevo junto al actual y lo sustituye de golpe.
func replaceExecutable(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	tmp := filepath.Join(filepath.Dir(dst), ".folio-update")
	if err := os.WriteFile(tmp, data, 0o755); err != nil {
		return fmt.Errorf("no se puede escribir en %s: %w", filepath.Dir(dst), err)
	}
	if err := os.Rename(tmp, dst); err != nil {
		os.Remove(tmp)
		return err
	}
	_ = os.Remove(src)
	return nil
}
