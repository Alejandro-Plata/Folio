package main

import (
	"context"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	goruntime "runtime"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ExportPDF genera un PDF a partir del HTML de impresión que prepara la
// interfaz, usando el motor de impresión de Chrome/Edge en modo headless.
// Edge viene instalado en todos los Windows 10/11, así que allí siempre funciona.
func (a *App) ExportPDF(title, html string) (string, error) {
	if findChromium() == "" {
		return "", errNoBrowser
	}
	out, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
		Title: "Exportar a PDF", DefaultFilename: safeFileName(title) + ".pdf",
		Filters: []wruntime.FileFilter{{DisplayName: "PDF (*.pdf)", Pattern: "*.pdf"}},
	})
	if err != nil || out == "" {
		return "", err
	}
	if !strings.HasSuffix(strings.ToLower(out), ".pdf") {
		out += ".pdf"
	}
	if err := renderPDF(a.localizeAssets(html), out); err != nil {
		return "", err
	}
	return out, nil
}

// renderPDF imprime el HTML (ya con las imágenes en rutas locales) a out.
func renderPDF(html, out string) error {
	browser := findChromium()
	if browser == "" {
		return errNoBrowser
	}
	tmp, err := os.MkdirTemp("", "folio-pdf-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)

	src := filepath.Join(tmp, "doc.html")
	if err := os.WriteFile(src, []byte(html), 0o644); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, browser,
		"--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
		"--disable-extensions", "--allow-file-access-from-files",
		"--user-data-dir="+filepath.Join(tmp, "profile"),
		"--no-pdf-header-footer", "--print-to-pdf-no-header",
		"--run-all-compositor-stages-before-draw", "--virtual-time-budget=8000",
		"--print-to-pdf="+out, fileURL(src))
	hideWindow(cmd)
	if b, err := cmd.CombinedOutput(); err != nil {
		if _, statErr := os.Stat(out); statErr != nil {
			return &pdfError{err: err, output: string(b)}
		}
	}
	return nil
}

type pdfError struct {
	err    error
	output string
}

func (e *pdfError) Error() string {
	msg := "no se pudo generar el PDF: " + e.err.Error()
	if o := strings.TrimSpace(e.output); o != "" {
		if len(o) > 400 {
			o = o[len(o)-400:]
		}
		msg += "\n" + o
	}
	return msg
}

var assetURL = regexp.MustCompile(`/files/([a-f0-9]{8,32})/([a-f0-9]{16}\.[a-z]{3,4})`)

// localizeAssets cambia las URL /files/... por rutas file:// del disco.
func (a *App) localizeAssets(html string) string {
	return assetURL.ReplaceAllStringFunc(html, func(m string) string {
		p, err := a.AssetPath(m)
		if err != nil {
			return m
		}
		return fileURL(p)
	})
}

func fileURL(p string) string {
	p = filepath.ToSlash(p)
	if !strings.HasPrefix(p, "/") {
		p = "/" + p // C:/Users/... -> /C:/Users/...
	}
	return (&url.URL{Scheme: "file", Path: p}).String()
}

func findChromium() string {
	var candidates []string
	switch goruntime.GOOS {
	case "windows":
		for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LocalAppData"} {
			base := os.Getenv(env)
			if base == "" {
				continue
			}
			candidates = append(candidates,
				filepath.Join(base, `Microsoft\Edge\Application\msedge.exe`),
				filepath.Join(base, `Google\Chrome\Application\chrome.exe`),
				filepath.Join(base, `Chromium\Application\chrome.exe`),
				filepath.Join(base, `BraveSoftware\Brave-Browser\Application\brave.exe`),
			)
		}
	case "darwin":
		candidates = []string{
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
		}
	default:
		for _, name := range []string{"google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "brave-browser"} {
			if p, err := exec.LookPath(name); err == nil {
				return p
			}
		}
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}
