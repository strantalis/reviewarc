package analysiscontext

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"

	"reviewarc/internal/analysisbundle"
	"reviewarc/internal/domain"
)

var (
	ErrCallBudget    = errors.New("analysis context call budget exhausted")
	ErrByteBudget    = errors.New("analysis context byte budget exhausted")
	ErrInvalidCursor = errors.New("analysis context cursor is invalid")
)

type AccessRecord struct {
	Tool      string `json:"tool"`
	FileID    string `json:"fileId,omitempty"`
	Path      string `json:"path,omitempty"`
	Revision  string `json:"revision,omitempty"`
	Cursor    int    `json:"cursor,omitempty"`
	EndCursor int    `json:"endCursor,omitempty"`
	StartLine int    `json:"startLine,omitempty"`
	EndLine   int    `json:"endLine,omitempty"`
	Bytes     int    `json:"bytes"`
	Success   bool   `json:"success"`
	Error     string `json:"error,omitempty"`
}

type Coverage struct {
	ChangedFiles           int `json:"changedFiles"`
	DiffFilesRead          int `json:"diffFilesRead"`
	DiffFilesFullyRead     int `json:"diffFilesFullyRead"`
	DiffFilesPartiallyRead int `json:"diffFilesPartiallyRead"`
	DiffFilesUnread        int `json:"diffFilesUnread"`
	Calls                  int `json:"calls"`
	BytesServed            int `json:"bytesServed"`
}

type ObjectReader interface {
	ReadFile(context.Context, domain.Revision, string) (string, bool, error)
	Search(context.Context, domain.Revision, string) ([]SearchMatch, error)
}

type Service struct {
	bundle *analysisbundle.Bundle
	reader ObjectReader

	mu      sync.Mutex
	calls   int
	bytes   int
	records []AccessRecord
}

func New(bundle *analysisbundle.Bundle, reader ObjectReader) (*Service, error) {
	if bundle == nil || reader == nil {
		return nil, errors.New("analysis context bundle and object reader are required")
	}
	return &Service{bundle: bundle, reader: reader}, nil
}

type ListChangesInput struct {
	Cursor int `json:"cursor,omitempty" jsonschema:"zero-based changed-file cursor"`
}

type ListChangesOutput struct {
	Repository analysisbundle.Repository `json:"repository"`
	Revisions  analysisbundle.Revisions  `json:"revisions"`
	Changes    []analysisbundle.Change   `json:"changes"`
	NextCursor int                       `json:"nextCursor,omitempty"`
	HasMore    bool                      `json:"hasMore"`
}

func (s *Service) ListChanges(_ context.Context, input ListChangesInput) (ListChangesOutput, error) {
	if err := s.begin(); err != nil {
		return ListChangesOutput{}, err
	}
	const pageSize = 100
	if input.Cursor < 0 || input.Cursor > len(s.bundle.Manifest.Changes) {
		return ListChangesOutput{}, s.failed("list_changes", AccessRecord{Cursor: input.Cursor}, ErrInvalidCursor)
	}
	end := min(input.Cursor+pageSize, len(s.bundle.Manifest.Changes))
	changes := append([]analysisbundle.Change(nil), s.bundle.Manifest.Changes[input.Cursor:end]...)
	for i := range changes {
		changes[i].Diff.Path = ""
		changes[i].Diff.SHA256 = ""
	}
	out := ListChangesOutput{Repository: s.bundle.Manifest.Repository, Revisions: s.bundle.Manifest.Revisions, Changes: changes, NextCursor: end, HasMore: end < len(s.bundle.Manifest.Changes)}
	if !out.HasMore {
		out.NextCursor = 0
	}
	return out, s.success("list_changes", AccessRecord{Cursor: input.Cursor}, out)
}

type ReadPRContextInput struct {
	Section string `json:"section" jsonschema:"metadata or discussion"`
	Cursor  int    `json:"cursor,omitempty" jsonschema:"zero-based byte cursor"`
}

type ReadChunkOutput struct {
	Content    string `json:"content"`
	NextCursor int    `json:"nextCursor,omitempty"`
	HasMore    bool   `json:"hasMore"`
	Bytes      int    `json:"bytes"`
}

func (s *Service) ReadPRContext(_ context.Context, input ReadPRContextInput) (ReadChunkOutput, error) {
	if err := s.begin(); err != nil {
		return ReadChunkOutput{}, err
	}
	artifact := s.bundle.Manifest.Metadata
	if input.Section == "discussion" {
		artifact = s.bundle.Manifest.Discussion
	} else if input.Section != "metadata" {
		return ReadChunkOutput{}, s.failed("read_pr_context", AccessRecord{Cursor: input.Cursor}, errors.New("section must be metadata or discussion"))
	}
	data, err := s.bundle.ReadArtifact(artifact)
	if err != nil {
		return ReadChunkOutput{}, s.failed("read_pr_context", AccessRecord{Cursor: input.Cursor}, err)
	}
	out, err := page(data, input.Cursor, s.bundle.Manifest.Limits.PageBytes)
	if err != nil {
		return ReadChunkOutput{}, s.failed("read_pr_context", AccessRecord{Cursor: input.Cursor}, err)
	}
	return out, s.success("read_pr_context", AccessRecord{Cursor: input.Cursor}, out)
}

type ReadDiffInput struct {
	FileID string `json:"fileId" jsonschema:"generated file identifier from list_changes"`
	Cursor int    `json:"cursor,omitempty" jsonschema:"zero-based byte cursor"`
}

func (s *Service) ReadDiff(_ context.Context, input ReadDiffInput) (ReadChunkOutput, error) {
	if err := s.begin(); err != nil {
		return ReadChunkOutput{}, err
	}
	change, ok := s.bundle.Change(input.FileID)
	record := AccessRecord{FileID: input.FileID, Cursor: input.Cursor}
	if !ok {
		return ReadChunkOutput{}, s.failed("read_diff", record, errors.New("unknown changed-file identifier"))
	}
	record.Path = change.Path
	data, err := s.bundle.ReadArtifact(change.Diff)
	if err != nil {
		return ReadChunkOutput{}, s.failed("read_diff", record, err)
	}
	out, err := page(data, input.Cursor, s.bundle.Manifest.Limits.PageBytes)
	if err != nil {
		return ReadChunkOutput{}, s.failed("read_diff", record, err)
	}
	record.EndCursor = input.Cursor + out.Bytes
	return out, s.success("read_diff", record, out)
}

type ReadFileInput struct {
	Path      string `json:"path"`
	Revision  string `json:"revision" jsonschema:"base or head"`
	StartLine int    `json:"startLine" jsonschema:"1-based inclusive start line"`
	EndLine   int    `json:"endLine" jsonschema:"1-based inclusive end line"`
}

type ReadFileOutput struct {
	Path      string `json:"path"`
	Revision  string `json:"revision"`
	StartLine int    `json:"startLine"`
	EndLine   int    `json:"endLine"`
	NextLine  int    `json:"nextLine,omitempty"`
	HasMore   bool   `json:"hasMore"`
	Content   string `json:"content"`
}

func (s *Service) ReadFile(ctx context.Context, input ReadFileInput) (ReadFileOutput, error) {
	if err := s.begin(); err != nil {
		return ReadFileOutput{}, err
	}
	revision, err := parseRevision(input.Revision)
	record := AccessRecord{Path: input.Path, Revision: input.Revision, StartLine: input.StartLine, EndLine: input.EndLine}
	if err != nil || input.StartLine < 1 || input.EndLine < input.StartLine || input.EndLine-input.StartLine+1 > s.bundle.Manifest.Limits.FileRangeLines {
		return ReadFileOutput{}, s.failed("read_file", record, errors.New("invalid or unbounded file range"))
	}
	content, binary, err := s.reader.ReadFile(ctx, revision, input.Path)
	if err != nil {
		return ReadFileOutput{}, s.failed("read_file", record, err)
	}
	if binary {
		return ReadFileOutput{}, s.failed("read_file", record, errors.New("binary repository file cannot be read as text"))
	}
	lines := strings.Split(content, "\n")
	if strings.HasSuffix(content, "\n") {
		lines = lines[:len(lines)-1]
	}
	if input.StartLine > len(lines) {
		return ReadFileOutput{}, s.failed("read_file", record, errors.New("file range starts beyond end of file"))
	}
	end := min(input.EndLine, len(lines))
	selected := lines[input.StartLine-1 : end]
	for len(selected) > 0 && len(strings.Join(selected, "\n")) > s.bundle.Manifest.Limits.PageBytes {
		selected = selected[:len(selected)-1]
		end--
	}
	if len(selected) == 0 {
		return ReadFileOutput{}, s.failed("read_file", record, errors.New("a single source line exceeds the context page limit"))
	}
	out := ReadFileOutput{Path: input.Path, Revision: input.Revision, StartLine: input.StartLine, EndLine: end, HasMore: end < len(lines), Content: strings.Join(selected, "\n")}
	if out.HasMore {
		out.NextLine = end + 1
	}
	record.EndLine = end
	return out, s.success("read_file", record, out)
}

type SearchInput struct {
	Query    string `json:"query" jsonschema:"literal fixed-string query of at least 3 bytes"`
	Revision string `json:"revision" jsonschema:"base or head"`
	Cursor   int    `json:"cursor,omitempty" jsonschema:"zero-based result cursor"`
}

type SearchMatch struct {
	Path    string `json:"path"`
	Line    int    `json:"line"`
	Content string `json:"content"`
}

type SearchOutput struct {
	Matches    []SearchMatch `json:"matches"`
	NextCursor int           `json:"nextCursor,omitempty"`
	HasMore    bool          `json:"hasMore"`
}

func (s *Service) SearchSnapshot(ctx context.Context, input SearchInput) (SearchOutput, error) {
	if err := s.begin(); err != nil {
		return SearchOutput{}, err
	}
	revision, err := parseRevision(input.Revision)
	record := AccessRecord{Revision: input.Revision, Cursor: input.Cursor}
	if err != nil || len(input.Query) < 3 || len(input.Query) > 256 || strings.IndexFunc(input.Query, func(r rune) bool { return r == 0 || r < 0x20 || r == 0x7f }) >= 0 {
		return SearchOutput{}, s.failed("search_snapshot", record, errors.New("invalid fixed-string search query"))
	}
	matches, err := s.reader.Search(ctx, revision, input.Query)
	if err != nil {
		return SearchOutput{}, s.failed("search_snapshot", record, err)
	}
	if input.Cursor < 0 || input.Cursor > len(matches) {
		return SearchOutput{}, s.failed("search_snapshot", record, ErrInvalidCursor)
	}
	const pageSize = 50
	end := min(input.Cursor+pageSize, len(matches))
	out := SearchOutput{Matches: append([]SearchMatch(nil), matches[input.Cursor:end]...), NextCursor: end, HasMore: end < len(matches)}
	if !out.HasMore {
		out.NextCursor = 0
	}
	return out, s.success("search_snapshot", record, out)
}

func (s *Service) AccessRecords() []AccessRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]AccessRecord(nil), s.records...)
}

func (s *Service) Coverage() Coverage {
	s.mu.Lock()
	defer s.mu.Unlock()
	ranges := map[string][][2]int{}
	for _, record := range s.records {
		if record.Success && record.Tool == "read_diff" {
			ranges[record.FileID] = append(ranges[record.FileID], [2]int{record.Cursor, record.EndCursor})
		}
	}
	coverage := Coverage{ChangedFiles: len(s.bundle.Manifest.Changes), DiffFilesRead: len(ranges), Calls: s.calls, BytesServed: s.bytes}
	for _, change := range s.bundle.Manifest.Changes {
		seen := ranges[change.ID]
		if len(seen) == 0 {
			continue
		}
		sort.Slice(seen, func(i, j int) bool { return seen[i][0] < seen[j][0] })
		covered := 0
		for _, interval := range seen {
			if interval[0] > covered {
				break
			}
			if interval[1] > covered {
				covered = interval[1]
			}
		}
		if covered >= int(change.Diff.Bytes) {
			coverage.DiffFilesFullyRead++
		} else {
			coverage.DiffFilesPartiallyRead++
		}
	}
	coverage.DiffFilesUnread = coverage.ChangedFiles - coverage.DiffFilesRead
	return coverage
}

func (s *Service) begin() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.calls >= s.bundle.Manifest.Limits.MaxCalls {
		return ErrCallBudget
	}
	s.calls++
	return nil
}

func (s *Service) success(tool string, record AccessRecord, output any) error {
	data, err := json.Marshal(output)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	record.Tool = tool
	if s.bytes+len(data) > s.bundle.Manifest.Limits.MaxServedBytes {
		record.Error = ErrByteBudget.Error()
		s.records = append(s.records, record)
		return ErrByteBudget
	}
	s.bytes += len(data)
	record.Bytes, record.Success = len(data), true
	s.records = append(s.records, record)
	return nil
}

func (s *Service) failed(tool string, record AccessRecord, err error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	record.Tool, record.Error = tool, err.Error()
	s.records = append(s.records, record)
	return err
}

func page(data []byte, cursor, limit int) (ReadChunkOutput, error) {
	if cursor < 0 || cursor > len(data) {
		return ReadChunkOutput{}, ErrInvalidCursor
	}
	end := min(cursor+limit, len(data))
	for end > cursor && !utf8.Valid(data[cursor:end]) {
		end--
	}
	if end == cursor && cursor < len(data) {
		return ReadChunkOutput{}, errors.New("artifact page is not valid UTF-8")
	}
	out := ReadChunkOutput{Content: string(data[cursor:end]), Bytes: end - cursor, HasMore: end < len(data)}
	if out.HasMore {
		out.NextCursor = end
	}
	return out, nil
}

func parseRevision(value string) (domain.Revision, error) {
	revision := domain.Revision(value)
	if revision != domain.RevisionBase && revision != domain.RevisionHead {
		return "", errors.New("revision must be base or head")
	}
	return revision, nil
}

func sortMatches(matches []SearchMatch) {
	sort.Slice(matches, func(i, j int) bool {
		if matches[i].Path != matches[j].Path {
			return matches[i].Path < matches[j].Path
		}
		return matches[i].Line < matches[j].Line
	})
}
