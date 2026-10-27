package desktop

import (
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
)

var assetURL = regexp.MustCompile(`/files/([a-f0-9]{8,32})/([a-f0-9]{16}\.[a-z]{3,4})`)

// LocalizeAssets cambia las URL /files/... del HTML de impresión por rutas
// file:// del disco, para generar el PDF desde un archivo temporal.
func (a *App) LocalizeAssets(html string) string {
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
