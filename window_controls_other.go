//go:build !darwin || !cgo

package main

import "context"

func configureNativeWindowChrome(context.Context) {}
