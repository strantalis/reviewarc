//go:build !darwin && !linux

package process

import "os/exec"

func configureCancellation(*exec.Cmd) {}
