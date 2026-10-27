package desktop

import (
	"os/exec"
	"syscall"
)

// guardChild hace que el proceso hijo muera con el núcleo aunque este termine de
// golpe (así llama-server no se queda ocupando memoria). Va antes de Start.
func guardChild(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Pdeathsig = syscall.SIGKILL
}

// guardStarted no hace nada en Linux: basta con Pdeathsig.
func guardStarted(*exec.Cmd) {}
