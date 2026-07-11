package git

import (
	"errors"
	"path"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"reviewarc/internal/domain"
)

var ErrUnsafePath = errors.New("unsafe repository path")

// ValidatePath accepts canonical Git tree paths, never host filesystem paths.
func ValidatePath(value string) error {
	if value == "" || !utf8.ValidString(value) || strings.Contains(value, "\\") || path.IsAbs(value) || filepath.VolumeName(value) != "" {
		return ErrUnsafePath
	}
	if path.Clean(value) != value || value == "." {
		return ErrUnsafePath
	}
	for _, part := range strings.Split(value, "/") {
		if part == "" || part == "." || part == ".." {
			return ErrUnsafePath
		}
		for _, r := range part {
			if r == 0 || r < 0x20 || r == 0x7f {
				return ErrUnsafePath
			}
		}
	}
	return nil
}

func validateRepository(ref domain.RepositoryRef) error {
	if !strings.EqualFold(ref.Host, "github.com") || !validOwner(ref.Owner) || !validRepo(ref.Name) {
		return errors.New("invalid GitHub repository identity")
	}
	return nil
}

func validOwner(s string) bool {
	if len(s) == 0 || len(s) > 39 || s[0] == '-' || s[len(s)-1] == '-' {
		return false
	}
	for _, r := range s {
		if !asciiAlphaNum(r) && r != '-' {
			return false
		}
	}
	return true
}

func validRepo(s string) bool {
	if len(s) == 0 || len(s) > 100 || s == "." || s == ".." {
		return false
	}
	for _, r := range s {
		if !asciiAlphaNum(r) && r != '-' && r != '_' && r != '.' {
			return false
		}
	}
	return true
}

func asciiAlphaNum(r rune) bool {
	return r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9'
}
