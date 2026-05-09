//go:build windows

package admin

import (
	"os/exec"
	"syscall"
)

func applyDetachedFlags(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: 0x00000008, // DETACHED_PROCESS
	}
}
