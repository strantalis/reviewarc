package git

import "testing"

func TestValidatePath(t *testing.T) {
	valid := []string{"src/main.go", "space dir/naive file.ts", "unicode/naïve.go"}
	for _, p := range valid {
		if err := ValidatePath(p); err != nil {
			t.Errorf("ValidatePath(%q): %v", p, err)
		}
	}
	invalid := []string{"", ".", "/etc/passwd", "../secret", "a/../b", "a//b", `a\b`, `C:\temp\x`, "a\nfile", "a\x00b"}
	for _, p := range invalid {
		if err := ValidatePath(p); err == nil {
			t.Errorf("ValidatePath(%q) unexpectedly succeeded", p)
		}
	}
}
