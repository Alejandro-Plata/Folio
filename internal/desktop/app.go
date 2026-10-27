// Package desktop es el núcleo de Folio en el escritorio: core.Service más lo
// que solo existe en un ordenador (dictado con whisper.cpp, llavero del
// sistema, unir PDF, instalar actualizaciones, abrir el navegador…). No sabe
// nada de ventanas: cmd/folio-core lo publica por stdio y la ventana (Electron)
// pone los diálogos del sistema y llama a las funciones que reciben rutas.
package desktop

import (
	"context"
	"fmt"
	"os/exec"
	goruntime "runtime"
	"strings"

	"folio/internal/core"
	"folio/internal/paths"
)

// App es lo que se publica a la interfaz: todos los métodos exportados (los de
// core.Service y los de este paquete) se pueden llamar por su nombre.
type App struct {
	*core.Service
	ctx       context.Context
	emit      func(name string, data ...any)
	dictation dictation
	folito    folito
}

// New abre el núcleo con las carpetas del usuario. emit envía eventos a la interfaz.
func New(ctx context.Context, version string, emit func(name string, data ...any)) (*App, error) {
	a := &App{ctx: ctx, emit: emit}
	svc, err := core.New(core.Options{
		ConfigDir: paths.ConfigDir(), Workspace: paths.DefaultWorkspace(), OS: goruntime.GOOS, Version: version,
		Emit:    emit,
		Secrets: keyringSecrets{},
	})
	if err != nil {
		return nil, err
	}
	a.Service = svc
	return a, nil
}

// Close guarda lo pendiente (versión «al cerrar»).
func (a *App) Close() {
	a.folito.stop()
	a.Shutdown()
}

// OpenURL abre una dirección web en el navegador del sistema.
func (a *App) OpenURL(url string) {
	if strings.HasPrefix(url, "http://") || strings.HasPrefix(url, "https://") || strings.HasPrefix(url, "mailto:") {
		_ = openURL(url)
	}
}

// OpenTopicFile abre un apunte adjunto con la aplicación predeterminada del sistema.
func (a *App) OpenTopicFile(rel string) error {
	p := a.AgendaTopicFilePath(rel)
	if p == "" {
		return fmt.Errorf("ruta de apuntes no válida")
	}
	return openURL(p)
}

func (a *App) OpenWorkspaceFolder() error { return openURL(a.Workspace()) }

// openURL abre una dirección o un archivo con el programa predeterminado.
func openURL(target string) error {
	var cmd *exec.Cmd
	switch goruntime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", target)
	case "darwin":
		cmd = exec.Command("open", target)
	default:
		cmd = exec.Command("xdg-open", target)
	}
	hideWindow(cmd)
	return cmd.Start()
}
