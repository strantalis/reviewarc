package agent

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"reviewarc/internal/analysisbundle"
	"reviewarc/internal/domain"
)

var allowedContextTools = map[string]bool{
	"list_changes": true, "read_pr_context": true, "read_diff": true,
	"read_file": true, "search_snapshot": true,
}

// AccessTracker reconstructs persisted context coverage from successful
// provider tool events. The MCP server enforces the actual limits; this tracker
// never grants authority and deliberately under-counts malformed event data.
type AccessTracker struct {
	manifest    analysisbundle.Manifest
	accesses    []domain.ContextAccess
	diffs       map[string][][2]int
	seen        map[string]bool
	inventoried map[string]bool
}

func NewAccessTracker(manifest analysisbundle.Manifest) *AccessTracker {
	return &AccessTracker{manifest: manifest, diffs: map[string][][2]int{}, seen: map[string]bool{}, inventoried: map[string]bool{}}
}

func IsAllowedContextTool(name string) bool { return allowedContextTools[name] }

// ContextActivityMessage turns an approved read-only tool call into progress
// copy. It deliberately excludes model prose, file contents, and search terms.
func ContextActivityMessage(tool string, arguments json.RawMessage, manifest analysisbundle.Manifest) string {
	if !IsAllowedContextTool(tool) {
		return ""
	}
	args := jsonObject(arguments)
	switch tool {
	case "list_changes":
		return "Listing changed files"
	case "read_pr_context":
		switch jsonString(args["section"]) {
		case "metadata":
			return "Reading pull request metadata"
		case "discussion":
			return "Reading pull request discussion"
		default:
			return "Reading pull request context"
		}
	case "read_diff":
		if change, ok := changeByID(manifest.Changes, jsonString(args["fileId"])); ok {
			if path := safeActivityPath(change.Path); path != "" {
				return "Reading diff for " + path
			}
		}
		return "Reading a changed-file diff"
	case "read_file":
		path := safeActivityPath(jsonString(args["path"]))
		start, end := jsonInt(args["startLine"]), jsonInt(args["endLine"])
		if path != "" && start > 0 && end >= start {
			return fmt.Sprintf("Reading %s lines %d–%d", path, start, end)
		}
		if path != "" {
			return "Reading " + path
		}
		return "Reading a repository file"
	case "search_snapshot":
		revision := jsonString(args["revision"])
		if revision == "base" || revision == "head" {
			return "Searching the " + revision + " repository snapshot"
		}
		return "Searching the repository snapshot"
	default:
		return ""
	}
}

func safeActivityPath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" || strings.IndexFunc(path, func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0 {
		return ""
	}
	const maxRunes = 160
	runes := []rune(path)
	if len(runes) > maxRunes {
		return string(runes[:maxRunes-1]) + "…"
	}
	return path
}

func (t *AccessTracker) Record(tool string, arguments, result json.RawMessage) error {
	if t == nil {
		return errors.New("analysis access tracker is required")
	}
	if !IsAllowedContextTool(tool) {
		return fmt.Errorf("unapproved context tool %q", tool)
	}
	args := jsonObject(arguments)
	output := jsonValue(result)
	access := domain.ContextAccess{Kind: tool, At: time.Now().UTC()}
	switch tool {
	case "list_changes":
		access.Bytes = jsonSize(result)
		for _, item := range nestedArray(output, "changes") {
			change, ok := item.(map[string]any)
			if !ok {
				continue
			}
			fileID := jsonString(change["id"])
			if _, found := changeByID(t.manifest.Changes, fileID); !found {
				return errors.New("context event inventoried an unknown changed file")
			}
			t.inventoried[fileID] = true
		}
	case "read_diff":
		fileID, _ := args["fileId"].(string)
		change, ok := changeByID(t.manifest.Changes, fileID)
		if !ok {
			return errors.New("context event referenced an unknown changed file")
		}
		cursor := jsonInt(args["cursor"])
		bytes := nestedInt(output, "bytes")
		if cursor < 0 || bytes < 0 || cursor > int(change.Diff.Bytes) {
			return errors.New("context event contained an invalid diff range")
		}
		end := min(cursor+bytes, int(change.Diff.Bytes))
		t.seen[fileID] = true
		if end > cursor {
			t.diffs[fileID] = append(t.diffs[fileID], [2]int{cursor, end})
		}
		access.Path, access.Bytes = change.Path, end-cursor
	case "read_file":
		access.Path, _ = args["path"].(string)
		access.Revision = domain.Revision(jsonString(args["revision"]))
		access.StartLine = jsonInt(args["startLine"])
		access.EndLine = nestedInt(output, "endLine")
		if access.EndLine == 0 {
			access.EndLine = jsonInt(args["endLine"])
		}
		access.Bytes = len(nestedString(output, "content"))
	case "read_pr_context":
		access.Path = jsonString(args["section"])
		access.Bytes = nestedInt(output, "bytes")
	case "search_snapshot":
		access.Revision = domain.Revision(jsonString(args["revision"]))
		access.Bytes = jsonSize(result)
	}
	t.accesses = append(t.accesses, access)
	return nil
}

func (t *AccessTracker) Coverage() domain.AnalysisCoverage {
	if t == nil {
		return domain.AnalysisCoverage{OmittedPaths: []string{}, Accesses: []domain.ContextAccess{}}
	}
	coverage := domain.AnalysisCoverage{ChangedFilesTotal: len(t.manifest.Changes), OmittedPaths: []string{}, PreviewedPaths: []string{}, UnseenPaths: []string{}, Accesses: append([]domain.ContextAccess(nil), t.accesses...)}
	for _, change := range t.manifest.Changes {
		coverage.DiffBytesTotal += int(change.Diff.Bytes)
		ranges := append([][2]int(nil), t.diffs[change.ID]...)
		if !t.seen[change.ID] {
			coverage.DiffFilesUnread++
			coverage.OmittedPaths = append(coverage.OmittedPaths, change.Path)
			if t.inventoried[change.ID] {
				coverage.DiffFilesPreviewed++
				coverage.PreviewedPaths = append(coverage.PreviewedPaths, change.Path)
			} else {
				coverage.DiffFilesUnseen++
				coverage.UnseenPaths = append(coverage.UnseenPaths, change.Path)
			}
			continue
		}
		coverage.Segments += len(ranges)
		sort.Slice(ranges, func(i, j int) bool { return ranges[i][0] < ranges[j][0] })
		read := 0
		coveredUntil := 0
		for _, interval := range ranges {
			if interval[1] <= coveredUntil {
				continue
			}
			start := interval[0]
			if start < coveredUntil {
				start = coveredUntil
			}
			read += interval[1] - start
			coveredUntil = interval[1]
		}
		coverage.DiffBytesRead += read
		if read >= int(change.Diff.Bytes) {
			coverage.DiffFilesFullyRead++
		} else {
			coverage.DiffFilesPartiallyRead++
		}
	}
	return coverage
}

func changeByID(changes []analysisbundle.Change, id string) (analysisbundle.Change, bool) {
	for _, change := range changes {
		if change.ID == id {
			return change, true
		}
	}
	return analysisbundle.Change{}, false
}

func jsonObject(raw json.RawMessage) map[string]any {
	value := jsonValue(raw)
	if object, ok := value.(map[string]any); ok {
		return object
	}
	return map[string]any{}
}

func jsonValue(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return nil
	}
	if encoded, ok := value.(string); ok && json.Valid([]byte(encoded)) {
		_ = json.Unmarshal([]byte(encoded), &value)
	}
	return value
}

func nestedValue(value any, key string) any {
	switch typed := value.(type) {
	case map[string]any:
		if found, ok := typed[key]; ok {
			return found
		}
		for _, child := range typed {
			if found := nestedValue(child, key); found != nil {
				return found
			}
		}
	case []any:
		for _, child := range typed {
			if found := nestedValue(child, key); found != nil {
				return found
			}
		}
	case string:
		if json.Valid([]byte(typed)) {
			return nestedValue(jsonValue(json.RawMessage(typed)), key)
		}
	}
	return nil
}

func nestedArray(value any, key string) []any {
	if items, ok := nestedValue(value, key).([]any); ok {
		return items
	}
	return nil
}

func nestedInt(value any, key string) int       { return jsonInt(nestedValue(value, key)) }
func nestedString(value any, key string) string { return jsonString(nestedValue(value, key)) }
func jsonString(value any) string               { result, _ := value.(string); return result }
func jsonInt(value any) int                     { number, _ := value.(float64); return int(number) }
func jsonSize(raw json.RawMessage) int {
	if len(raw) == 0 {
		return 0
	}
	return len(raw)
}
