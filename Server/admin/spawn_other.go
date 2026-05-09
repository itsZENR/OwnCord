//go:build !windows

package admin

import "os/exec"

func applyDetachedFlags(_ *exec.Cmd) {}
