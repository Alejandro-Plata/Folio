//go:build !linux && !windows

package desktop

import "os/exec"

func guardChild(*exec.Cmd)   {}
func guardStarted(*exec.Cmd) {}
