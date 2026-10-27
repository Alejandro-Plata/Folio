package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// UpdateInstall descarga la versión nueva, la verifica y la instala:
// en Linux sustituye el ejecutable y vuelve a abrir Folio; en Windows lanza el
// instalador en silencio (espera a que Folio se cierre) y cierra Folio.
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
		exe, err := os.Executable()
		if err != nil {
			return err
		}
		if exe, err = filepath.EvalSymlinks(exe); err != nil {
			return err
		}
		if err := replaceExecutable(path, exe); err != nil {
			return err
		}
		// Se abre la nueva versión cuando esta haya soltado el bloqueo de instancia única
		restart := exec.Command("sh", "-c", `sleep 1; exec "$0"`, exe)
		restart.Stdout, restart.Stderr = nil, nil
		if err := restart.Start(); err != nil {
			return err
		}
	default:
		return fmt.Errorf("instalar actualizaciones no está disponible en %s", goruntime.GOOS)
	}
	wruntime.Quit(a.ctx)
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
