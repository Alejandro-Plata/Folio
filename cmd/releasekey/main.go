// releasekey genera la clave de firma de las versiones y firma SHA256SUMS.
//
//	go run ./cmd/releasekey gen                 crea la clave (una sola vez)
//	go run ./cmd/releasekey sign SHA256SUMS     escribe SHA256SUMS.sig
//
// La clave privada queda fuera del repositorio, en ~/.config/folio-release/
// (o $FOLIO_RELEASE_KEY). La pública se escribe en internal/update/publickey.txt
// y va dentro de la app: solo se instalan versiones firmadas con su pareja.
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func keyPath() string {
	if p := os.Getenv("FOLIO_RELEASE_KEY"); p != "" {
		return p
	}
	dir, _ := os.UserConfigDir()
	return filepath.Join(dir, "folio-release", "release.key")
}

func main() {
	if len(os.Args) < 2 {
		fail("uso: releasekey gen | sign <archivo>")
	}
	switch os.Args[1] {
	case "gen":
		p := keyPath()
		if _, err := os.Stat(p); err == nil {
			fail("ya existe " + p + ": bórrala a mano si de verdad quieres otra (las apps instaladas dejarán de aceptar actualizaciones)")
		}
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		check(err)
		check(os.MkdirAll(filepath.Dir(p), 0o700))
		check(os.WriteFile(p, []byte(base64.StdEncoding.EncodeToString(priv)+"\n"), 0o600))
		check(os.WriteFile(filepath.Join("internal", "update", "publickey.txt"), []byte(base64.StdEncoding.EncodeToString(pub)+"\n"), 0o644))
		fmt.Println("Clave privada:", p, "(guárdala con copia de seguridad; no la subas a ningún sitio)")
		fmt.Println("Clave pública: internal/update/publickey.txt (esta sí va en el repositorio)")
	case "sign":
		if len(os.Args) < 3 {
			fail("uso: releasekey sign <archivo>")
		}
		raw, err := os.ReadFile(keyPath())
		if err != nil {
			fail("no encuentro la clave privada (" + keyPath() + "): créala con «releasekey gen»")
		}
		priv, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
		if err != nil || len(priv) != ed25519.PrivateKeySize {
			fail("la clave privada no es válida")
		}
		data, err := os.ReadFile(os.Args[2])
		check(err)
		sig := ed25519.Sign(ed25519.PrivateKey(priv), data)
		check(os.WriteFile(os.Args[2]+".sig", []byte(base64.StdEncoding.EncodeToString(sig)+"\n"), 0o644))
		fmt.Println("Firmado:", os.Args[2]+".sig")
	default:
		fail("orden desconocida: " + os.Args[1])
	}
}

func check(err error) {
	if err != nil {
		fail(err.Error())
	}
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(1)
}
