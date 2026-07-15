package analysis

import (
	"context"
	"encoding/json"
	"errors"
	"os"
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
			validator := validator{ctx: context.Background(), files: fixtureFiles{}, cache: map[string][]byte{}}
			got := validator.evidence([]rawEvidence{value})[0]
			if got.ValidationStatus != domain.ValidationInvalid || !strings.Contains(got.ValidationMessage, test.want) {
				t.Fatalf("got %+v", got)
			}
		})
	}
}

func TestNormalizeModelPresentationRepairsOpaqueIDsAndOrder(t *testing.T) {
	raw := rawAnalysis{
		Facts: []rawClaim{{ID: "f1", Text: "Top-level fact"}, {ID: "f1", Text: "Second top-level fact"}},
		Risks: []rawRisk{{ID: "f1", Title: "Top-level risk"}},
		Chapters: []rawChapter{
			{ID: "chapter", Order: 0, Facts: []rawClaim{{ID: "f1", Text: "Chapter fact"}, {ID: "f1", Text: "Second chapter fact"}}, Risks: []rawRisk{{ID: "f1", Title: "Chapter risk"}}},
			{ID: "chapter", Order: 0, Title: "Two", Purpose: "Review two"},
		},
	}
	normalizeModelPresentation(&raw)
	if err := validateModelIdentity(raw); err != nil {
		t.Fatalf("normalized presentation rejected: %v", err)
	}
	if raw.Summary == "" || raw.Chapters[0].Title == "" || raw.Chapters[0].Purpose == "" {
		t.Fatalf("missing presentation fallbacks: %+v", raw)
	}
	if raw.Chapters[0].ID == raw.Chapters[1].ID || raw.Chapters[0].Order != 1 || raw.Chapters[1].Order != 2 {
		t.Fatalf("chapter identity was not repaired: %+v", raw.Chapters)
	}
	if raw.Facts[0].ID == raw.Facts[1].ID || raw.Chapters[0].Facts[0].ID == raw.Chapters[0].Facts[1].ID {
		t.Fatalf("collection identity was not repaired: root=%+v chapter=%+v", raw.Facts, raw.Chapters[0].Facts)
	}
	if raw.Facts[0].ID != raw.Risks[0].ID || raw.Facts[0].ID != raw.Chapters[0].Facts[0].ID {
		t.Fatalf("safe cross-collection labels were unnecessarily rewritten: %+v", raw)
	}
}

func TestValidateRejectsEmptyOrUnsupportedWalkthrough(t *testing.T) {
	if err := validateModelIdentity(rawAnalysis{}); err == nil || !strings.Contains(err.Error(), "no review chapters") {
		t.Fatalf("empty walkthrough error = %v", err)
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

func TestDecodeEnforcesRequiredSchemaFieldsLocally(t *testing.T) {
	data, err := os.ReadFile("../agent/codex/testdata/analysis.json")
	if err != nil {
		t.Fatal(err)
	}
	var root map[string]any
	if err := json.Unmarshal(data, &root); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"summaryEvidence", "affectedAreas", "behavioralChanges", "risks", "facts", "inferences", "unknowns"} {
		t.Run(field, func(t *testing.T) {
			copy := make(map[string]any, len(root))
			for key, value := range root {
				copy[key] = value
			}
			delete(copy, field)
			payload, _ := json.Marshal(copy)
			if _, err := Decode(payload); err == nil || !strings.Contains(err.Error(), "does not match") {
				t.Fatalf("missing required field %q error=%v", field, err)
			}
		})
	}
	root["risks"] = nil
	payload, _ := json.Marshal(root)
	if _, err := Decode(payload); err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("null required array error=%v", err)
	}
}

func TestSchemaUsesHarnessCompatibleConstraintSubset(t *testing.T) {
	var root any
	if err := json.Unmarshal(Schema(), &root); err != nil {
		t.Fatal(err)
	}
	unsupported := map[string]bool{
		"minimum": true, "maximum": true, "exclusiveMinimum": true, "exclusiveMaximum": true,
		"minLength": true, "maxLength": true, "minItems": true, "maxItems": true,
	}
	var walk func(any)
	walk = func(value any) {
		switch value := value.(type) {
		case map[string]any:
			for key, child := range value {
				if unsupported[key] {
					t.Errorf("output schema uses unsupported provider constraint %q", key)
				}
				walk(child)
			}
		case []any:
			for _, child := range value {
				walk(child)
			}
		}
	}
	walk(root)
}

func TestValidateRepairsEvidenceLabelsAndNormalizesEnums(t *testing.T) {
	base, head := strings.Repeat("1", 40), strings.Repeat("2", 40)
	evidence := []rawEvidence{
		{ID: "e1", Path: "missing.go", Revision: "head", StartLine: 1, EndLine: 1},
		{ID: "e1", Path: "src/greet.go", Revision: "HEAD", StartLine: 1, EndLine: 1},
	}
	raw := rawAnalysis{SchemaVersion: SchemaVersion, BaseSHA: base, HeadSHA: head, Summary: "Summary", Chapters: []rawChapter{{ID: "chapter", Order: 1, Title: "Greeting", Purpose: "Review greeting", Risks: []rawRisk{{ID: "risk", Title: "Risk", Description: "Description", Level: "Medium", Evidence: evidence}}}}}
	result, err := Validate(context.Background(), Document{raw: raw}, Snapshot{BaseSHA: base, HeadSHA: head, Files: fixtureFiles{"head:src/greet.go": []byte("package greet\n")}})
	if err != nil {
		t.Fatal(err)
	}
	risk := result.Chapters[0].Risks[0]
	if risk.Level != domain.RiskMedium || len(risk.Evidence) != 2 || risk.Evidence[0].ID == risk.Evidence[1].ID || risk.Evidence[1].ValidationStatus != domain.ValidationValid {
		t.Fatalf("normalized risk=%+v", risk)
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
