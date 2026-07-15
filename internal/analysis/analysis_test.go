package analysis

import (
	"context"
	"errors"
	"strings"
	"testing"

	"reviewarc/internal/domain"
)

type fixtureFiles map[string][]byte

func (f fixtureFiles) ReadFile(_ context.Context, revision domain.Revision, path string) ([]byte, error) {
	value, ok := f[string(revision)+":"+path]
	if !ok {
		return nil, errors.New("missing")
	}
	return value, nil
}

func TestValidateRejectsTraversalAndInvalidLines(t *testing.T) {
	for _, test := range []struct {
		name, path string
		start, end int
		want       string
	}{
		{"parent", "../outside", 1, 1, "escapes"}, {"absolute", "/tmp/outside", 1, 1, "relative"}, {"dot", ".", 1, 1, "escapes"}, {"dot-prefix", "./src/greet.go", 1, 1, "canonical"}, {"normalized-traversal", "src/../greet.go", 1, 1, "canonical"}, {"backward", "src/greet.go", 3, 2, "1-based"},
	} {
		t.Run(test.name, func(t *testing.T) {
			value := rawEvidence{ID: "e", Path: test.path, Revision: "head", StartLine: test.start, EndLine: test.end}
			validator := validator{ctx: context.Background(), files: fixtureFiles{}, cache: map[string][]byte{}, ids: map[string]rawEvidence{}}
			got := validator.evidence([]rawEvidence{value})[0]
			if got.ValidationStatus != domain.ValidationInvalid || !strings.Contains(got.ValidationMessage, test.want) {
				t.Fatalf("got %+v", got)
			}
		})
	}
}

func TestValidateModelIdentityRejectsDuplicateChapterIDs(t *testing.T) {
	raw := rawAnalysis{Summary: "Review summary", Chapters: []rawChapter{{ID: "chapter", Order: 1, Title: "One", Purpose: "Review one"}, {ID: "chapter", Order: 2, Title: "Two", Purpose: "Review two"}}}
	if err := validateModelIdentity(raw); err == nil || !strings.Contains(err.Error(), "reused") {
		t.Fatalf("duplicate chapter ID error = %v", err)
	}
	raw = rawAnalysis{Summary: "Review summary", Chapters: []rawChapter{{ID: "chapter", Order: 1, Title: "One", Purpose: "Review one"}, {ID: "other", Order: 1, Title: "Two", Purpose: "Review two"}}}
	if err := validateModelIdentity(raw); err == nil || !strings.Contains(err.Error(), "order") {
		t.Fatalf("duplicate chapter order error = %v", err)
	}
}

func TestValidateModelIdentityScopesFindingIDsToTheirCollections(t *testing.T) {
	raw := rawAnalysis{
		Summary: "Review summary",
		Facts:   []rawClaim{{ID: "f1", Text: "Top-level fact"}},
		Risks:   []rawRisk{{ID: "f1", Title: "Top-level risk"}},
		Chapters: []rawChapter{{
			ID: "chapter", Order: 1, Title: "One", Purpose: "Review one",
			Facts: []rawClaim{{ID: "f1", Text: "Chapter fact"}},
			Risks: []rawRisk{{ID: "f1", Title: "Chapter risk"}},
		}},
	}
	if err := validateModelIdentity(raw); err != nil {
		t.Fatalf("collection-scoped ID reuse rejected: %v", err)
	}
	raw.Chapters[0].Facts = append(raw.Chapters[0].Facts, rawClaim{ID: "f1", Text: "Duplicate chapter fact"})
	if err := validateModelIdentity(raw); err == nil || !strings.Contains(err.Error(), "within chapter facts") {
		t.Fatalf("same-collection duplicate error=%v", err)
	}
}

func TestValidateRejectsEmptyOrUnsupportedWalkthrough(t *testing.T) {
	for _, raw := range []rawAnalysis{
		{Chapters: []rawChapter{{ID: "chapter", Order: 1, Title: "Title", Purpose: "Purpose"}}},
		{Summary: "Summary", Chapters: []rawChapter{{ID: "chapter", Order: 1, Purpose: "Purpose"}}},
	} {
		if err := validateModelIdentity(raw); err == nil || !strings.Contains(err.Error(), "empty") {
			t.Fatalf("empty walkthrough error = %v", err)
		}
	}
	result := domain.ReviewAnalysis{Summary: "Summary", Chapters: []domain.ReviewChapter{{ID: "chapter", Title: "Title", Purpose: "Purpose"}}}
	if err := validateAnalysisSubstance(result); err == nil || !strings.Contains(err.Error(), "substantive review findings") {
		t.Fatalf("unsupported walkthrough error = %v", err)
	}
	result.Chapters[0].Evidence = []domain.EvidenceReference{{ID: "evidence", ValidationStatus: domain.ValidationValid}}
	if err := validateAnalysisSubstance(result); err == nil || !strings.Contains(err.Error(), "substantive review findings") {
		t.Fatalf("empty evidence-only walkthrough error = %v", err)
	}
	result.Chapters[0].Facts = []domain.Claim{{ID: "fact", Text: "The implementation changes behavior.", Evidence: result.Chapters[0].Evidence}}
	if err := validateAnalysisSubstance(result); err != nil {
		t.Fatalf("evidence-backed walkthrough rejected: %v", err)
	}
}

func TestDecodeRejectsUnknownFieldsAndTrailingValues(t *testing.T) {
	if _, err := Decode([]byte(`{"schemaVersion":1,"unexpected":true}`)); err == nil {
		t.Fatal("unknown field accepted")
	}
	if _, err := Decode([]byte(`{"schemaVersion":1} {}`)); err == nil || !strings.Contains(err.Error(), "more than one") {
		t.Fatalf("trailing JSON error = %v", err)
	}
}

func TestValidateChecksRevisionsAndEvidence(t *testing.T) {
	base, head := strings.Repeat("1", 40), strings.Repeat("2", 40)
	raw := rawAnalysis{SchemaVersion: SchemaVersion, BaseSHA: base, HeadSHA: head, Summary: "Summary", SummaryEvidence: []rawEvidence{{ID: "summary", Path: "src/greet.go", Revision: "head", StartLine: 1, EndLine: 1}}, Chapters: []rawChapter{{ID: "chapter", Order: 1, Title: "Greeting", Purpose: "Review greeting", Facts: []rawClaim{{ID: "fact", Text: "Greeting exists", Evidence: []rawEvidence{{ID: "fact-evidence", Path: "src/greet.go", Revision: "head", StartLine: 1, EndLine: 1}}}}}}}
	result, err := Validate(context.Background(), Document{raw: raw}, Snapshot{BaseSHA: base, HeadSHA: head, Files: fixtureFiles{"head:src/greet.go": []byte("package greet\n")}})
	if err != nil {
		t.Fatal(err)
	}
	if result.SummaryValidation != domain.ValidationValid || result.Chapters[0].Facts[0].ValidationStatus != domain.ValidationValid {
		t.Fatalf("validation result = %+v", result)
	}
	raw.HeadSHA = strings.Repeat("3", 40)
	if _, err := Validate(context.Background(), Document{raw: raw}, Snapshot{BaseSHA: base, HeadSHA: head, Files: fixtureFiles{}}); err == nil || !strings.Contains(err.Error(), "revisions") {
		t.Fatalf("revision mismatch error = %v", err)
	}
}
