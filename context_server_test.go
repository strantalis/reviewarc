package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestContextServerRejectsIncompleteOrRelativeAuthority(t *testing.T) {
	for _, args := range [][]string{
		nil,
		{"--data-root", "/tmp/root", "--bundle", "/tmp/bundle"},
		{"--data-root", "/tmp/root", "--bundle", "/tmp/bundle", "--digest", strings.Repeat("z", 64)},
		{"--data-root", "relative", "--bundle", "/tmp/bundle", "--digest", strings.Repeat("0", 64)},
		{"--data-root", "/tmp/root", "--bundle", "/tmp/bundle", "--digest", strings.Repeat("0", 64), "extra"},
	} {
		var stdout, stderr bytes.Buffer
		if code := runContextServer(args, strings.NewReader(""), &stdout, &stderr); code != 2 {
			t.Fatalf("args=%v code=%d stderr=%q", args, code, stderr.String())
		}
		if stdout.Len() != 0 {
			t.Fatalf("args=%v wrote non-protocol stdout %q", args, stdout.String())
		}
	}
}
