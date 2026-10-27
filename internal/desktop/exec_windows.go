package desktop

import (
	"os/exec"
	"syscall"
)

// hideWindow evita que aparezca una consola al lanzar procesos auxiliares.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}

// stopProcess termina el proceso (en Windows no se graba con procesos externos).
func stopProcess(cmd *exec.Cmd) { _ = cmd.Process.Kill() }
