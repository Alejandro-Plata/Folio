package desktop

import (
	"os/exec"
	"unsafe"

	"golang.org/x/sys/windows"
)

// guardChild no hace nada antes de arrancar en Windows (ver guardStarted).
func guardChild(*exec.Cmd) {}

// guardStarted mete el proceso hijo en un «job» que Windows cierra al terminar
// el núcleo, de cualquier forma que termine: el hijo muere con él (así
// llama-server no se queda ocupando memoria).
func guardStarted(cmd *exec.Cmd) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
		BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE},
	}
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		windows.CloseHandle(job)
		return
	}
	h, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err != nil {
		windows.CloseHandle(job)
		return
	}
	defer windows.CloseHandle(h)
	if windows.AssignProcessToJobObject(job, h) != nil {
		windows.CloseHandle(job)
	}
	// El job queda abierto a propósito: lo cierra Windows al terminar el núcleo
}
