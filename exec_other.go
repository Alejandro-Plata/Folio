//go:build !windows

package main

import (
	"os"
	"os/exec"
)

func hideWindow(*exec.Cmd) {}

// stopProcess pide al proceso que termine (pw-record y arecord cierran bien el WAV con SIGINT).
func stopProcess(cmd *exec.Cmd) { _ = cmd.Process.Signal(os.Interrupt) }
