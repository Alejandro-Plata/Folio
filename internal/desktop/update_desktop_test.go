package desktop

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReplaceExecutable(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "folio")
	src := filepath.Join(dir, "descarga")
	if err := os.WriteFile(exe, []byte("viejo"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(src, []byte("nuevo"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := replaceExecutable(src, exe); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(exe)
	st, _ := os.Stat(exe)
	if string(b) != "nuevo" || st.Mode().Perm()&0o100 == 0 {
		t.Fatalf("contenido %q, permisos %v", b, st.Mode())
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Fatal("la descarga debía borrarse")
	}
}
