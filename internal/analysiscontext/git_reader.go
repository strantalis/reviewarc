package analysiscontext

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"reviewarc/internal/domain"
	gitcache "reviewarc/internal/git"
	processpkg "reviewarc/internal/process"
)

const maxObjectBytes = 8 << 20

type GitObjectReader struct {
	runner          processpkg.Runner
	cache           string
	base, head      string
	maxSearchOutput int
}

func NewGitObjectReader(runner processpkg.Runner, cachePath, baseSHA, headSHA string) (*GitObjectReader, error) {
	if runner == nil || cachePath == "" || !validSHA(baseSHA) || !validSHA(headSHA) {
		return nil, errors.New("invalid pinned Git object reader configuration")
	}
	return &GitObjectReader{runner: runner, cache: cachePath, base: baseSHA, head: headSHA, maxSearchOutput: 8 << 20}, nil
}

func (r *GitObjectReader) ReadFile(ctx context.Context, revision domain.Revision, path string) (string, bool, error) {
	if gitcache.ValidatePath(path) != nil {
		return "", false, errors.New("unsafe repository path")
	}
	sha, err := r.revision(revision)
	if err != nil {
		return "", false, err
	}
	entry, err := r.run(ctx, 1<<20, "ls-tree", "-z", sha, "--", path)
	if err != nil {
		return "", false, fmt.Errorf("locate repository file: %w", err)
	}
	raw := strings.TrimSuffix(string(entry.Stdout), "\x00")
	parts := strings.SplitN(raw, "\t", 2)
	fields := strings.Fields(parts[0])
	if len(parts) != 2 || parts[1] != path || len(fields) != 3 || fields[1] != "blob" || !validSHA(fields[2]) {
		return "", false, errors.New("path is not a file at the pinned revision")
	}
	sizeResult, err := r.run(ctx, 1024, "cat-file", "-s", fields[2])
	if err != nil {
		return "", false, fmt.Errorf("measure repository file: %w", err)
	}
	size, err := strconv.ParseInt(strings.TrimSpace(string(sizeResult.Stdout)), 10, 64)
	if err != nil || size < 0 || size > maxObjectBytes {
		return "", false, errors.New("repository file exceeds the bounded object limit")
	}
	blob, err := r.run(ctx, maxObjectBytes+1, "cat-file", "blob", fields[2])
	if err != nil {
		return "", false, fmt.Errorf("read repository file: %w", err)
	}
	binary := bytes.IndexByte(blob.Stdout, 0) >= 0 || !utf8.Valid(blob.Stdout)
	if binary {
		return "", true, nil
	}
	return string(blob.Stdout), false, nil
}

func (r *GitObjectReader) Search(ctx context.Context, revision domain.Revision, query string) ([]SearchMatch, error) {
	sha, err := r.revision(revision)
	if err != nil {
		return nil, err
	}
	result, err := r.run(ctx, r.maxSearchOutput, "grep", "-n", "--null", "-I", "-F", "-e", query, sha, "--")
	if err != nil {
		if result.ExitCode == 1 {
			return []SearchMatch{}, nil
		}
		return nil, fmt.Errorf("search pinned repository snapshot: %w", err)
	}
	var matches []SearchMatch
	for len(result.Stdout) > 0 {
		pathEnd := bytes.IndexByte(result.Stdout, 0)
		if pathEnd < 0 {
			return nil, errors.New("Git returned malformed search output")
		}
		lineEnd := bytes.IndexByte(result.Stdout[pathEnd+1:], 0)
		if lineEnd < 0 {
			return nil, errors.New("Git returned malformed search output")
		}
		lineEnd += pathEnd + 1
		contentEnd := bytes.IndexByte(result.Stdout[lineEnd+1:], '\n')
		if contentEnd < 0 {
			contentEnd = len(result.Stdout) - lineEnd - 1
		}
		contentEnd += lineEnd + 1
		objectPath := string(result.Stdout[:pathEnd])
		prefix := sha + ":"
		if !strings.HasPrefix(objectPath, prefix) {
			return nil, errors.New("Git search result did not match pinned revision")
		}
		path := strings.TrimPrefix(objectPath, prefix)
		line, parseErr := strconv.Atoi(string(result.Stdout[pathEnd+1 : lineEnd]))
		content := result.Stdout[lineEnd+1 : contentEnd]
		if parseErr == nil && line > 0 && gitcache.ValidatePath(path) == nil && utf8.Valid(content) {
			matches = append(matches, SearchMatch{Path: path, Line: line, Content: string(content)})
		}
		if contentEnd == len(result.Stdout) {
			result.Stdout = nil
		} else {
			result.Stdout = result.Stdout[contentEnd+1:]
		}
	}
	sortMatches(matches)
	return matches, nil
}

func (r *GitObjectReader) revision(revision domain.Revision) (string, error) {
	switch revision {
	case domain.RevisionBase:
		return r.base, nil
	case domain.RevisionHead:
		return r.head, nil
	default:
		return "", errors.New("revision must be base or head")
	}
}

func (r *GitObjectReader) run(ctx context.Context, maxOutput int, args ...string) (processpkg.Result, error) {
	return r.runner.Run(ctx, processpkg.Command{Tool: processpkg.Git, Args: append([]string{"--git-dir=" + r.cache}, args...), Timeout: 30 * time.Second, MaxOutput: maxOutput})
}

func validSHA(value string) bool {
	if len(value) != 40 {
		return false
	}
	for _, r := range value {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return false
		}
	}
	return true
}
