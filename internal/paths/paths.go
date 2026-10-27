// Package paths resuelve las carpetas de usuario de forma portable (Linux y Windows).
package paths

import (
	"bufio"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const AppName = "Folio"

// ConfigDir devuelve la carpeta de configuración de la aplicación
// (~/.config/Folio en Linux, %AppData%\Folio en Windows).
func ConfigDir() string {
	base, err := os.UserConfigDir()
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, AppName)
}

// DefaultWorkspace devuelve la carpeta donde se guardan los documentos por defecto:
// la carpeta "Documentos" del usuario + /Folio.
func DefaultWorkspace() string {
	return filepath.Join(documentsDir(), AppName)
}

func documentsDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return os.TempDir()
	}
	if runtime.GOOS == "linux" {
		if dir := xdgUserDir(home, "XDG_DOCUMENTS_DIR"); dir != "" {
			return dir
		}
	}
	return filepath.Join(home, "Documents")
}

// xdgUserDir lee ~/.config/user-dirs.dirs, que respeta el idioma del sistema
// (por ejemplo ~/Documentos en un escritorio en español).
func xdgUserDir(home, key string) string {
	cfg := os.Getenv("XDG_CONFIG_HOME")
	if cfg == "" {
		cfg = filepath.Join(home, ".config")
	}
	f, err := os.Open(filepath.Join(cfg, "user-dirs.dirs"))
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if !strings.HasPrefix(line, key+"=") {
			continue
		}
		v := strings.Trim(strings.TrimPrefix(line, key+"="), `"`)
		v = strings.ReplaceAll(v, "$HOME", home)
		if v == home || v == "" {
			return ""
		}
		return v
	}
	return ""
}

// DataDir es la carpeta de datos grandes que no deben sincronizarse con el
// espacio de trabajo, como los modelos de dictado (~/.local/share/folio en
// Linux, %LocalAppData%\Folio en Windows).
func DataDir() string {
	if runtime.GOOS == "windows" {
		if base := os.Getenv("LOCALAPPDATA"); base != "" {
			return filepath.Join(base, AppName)
		}
		return ConfigDir()
	}
	base := os.Getenv("XDG_DATA_HOME")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return filepath.Join(os.TempDir(), "folio")
		}
		base = filepath.Join(home, ".local", "share")
	}
	return filepath.Join(base, "folio")
}
