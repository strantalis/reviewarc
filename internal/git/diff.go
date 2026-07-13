package git

import (
	"bytes"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"reviewarc/internal/domain"
)

var hunkHeader = regexp.MustCompile(`^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@`)

func ParsePatch(file domain.ChangedFile, patch []byte) (domain.DiffFile, error) {
	result := domain.DiffFile{File: file, Hunks: []domain.DiffHunk{}, Patch: string(patch)}
	if bytes.Contains(patch, []byte("GIT binary patch")) || bytes.Contains(patch, []byte("Binary files ")) {
		result.File.IsBinary = true
		return result, nil
	}
	var current *domain.DiffHunk
	oldLine, newLine, seenOld, seenNew := 0, 0, 0, 0
	finish := func() error {
		if current != nil && (seenOld != current.OldLines || seenNew != current.NewLines) {
			return fmt.Errorf("malformed diff hunk %q: expected -%d +%d lines, got -%d +%d", current.Header, current.OldLines, current.NewLines, seenOld, seenNew)
		}
		return nil
	}
	lines := bytes.Split(patch, []byte{'\n'})
	for index, rawLine := range lines {
		if index == len(lines)-1 && len(rawLine) == 0 {
			continue
		}
		line := string(rawLine)
		if strings.HasPrefix(line, "@@ ") {
			if err := finish(); err != nil {
				return domain.DiffFile{}, err
			}
			m := hunkHeader.FindStringSubmatch(line)
			if m == nil {
				return domain.DiffFile{}, fmt.Errorf("malformed diff hunk header %q", line)
			}
			oldStart, _ := strconv.Atoi(m[1])
			newStart, _ := strconv.Atoi(m[3])
			oldCount, newCount := 1, 1
			if m[2] != "" {
				oldCount, _ = strconv.Atoi(m[2])
			}
			if m[4] != "" {
				newCount, _ = strconv.Atoi(m[4])
			}
			result.Hunks = append(result.Hunks, domain.DiffHunk{Header: line, OldStart: oldStart, OldLines: oldCount, NewStart: newStart, NewLines: newCount, Lines: []domain.DiffLine{}})
			current = &result.Hunks[len(result.Hunks)-1]
			oldLine, newLine, seenOld, seenNew = oldStart, newStart, 0, 0
			continue
		}
		if current == nil {
			continue
		}
		if line == `\ No newline at end of file` {
			current.Lines = append(current.Lines, domain.DiffLine{Kind: domain.DiffNoNewline, Content: line})
			continue
		}
		if line == "" {
			return domain.DiffFile{}, errors.New("malformed empty patch line")
		}
		content := line[1:]
		switch line[0] {
		case ' ':
			o, n := oldLine, newLine
			current.Lines = append(current.Lines, domain.DiffLine{Kind: domain.DiffContext, Content: content, OldLine: &o, NewLine: &n})
			oldLine++
			newLine++
			seenOld++
			seenNew++
		case '-':
			o := oldLine
			current.Lines = append(current.Lines, domain.DiffLine{Kind: domain.DiffDelete, Content: content, OldLine: &o})
			oldLine++
			seenOld++
		case '+':
			n := newLine
			current.Lines = append(current.Lines, domain.DiffLine{Kind: domain.DiffAdd, Content: content, NewLine: &n})
			newLine++
			seenNew++
		default:
			return domain.DiffFile{}, fmt.Errorf("malformed patch line prefix %q", line[0])
		}
	}
	if err := finish(); err != nil {
		return domain.DiffFile{}, err
	}
	return result, nil
}
