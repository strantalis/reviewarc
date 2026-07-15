package analysis

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"reviewarc/internal/domain"
)

type FileReader interface {
	ReadFile(context.Context, domain.Revision, string) ([]byte, error)
}

type Snapshot struct {
	BaseSHA string
	HeadSHA string
	Files   FileReader
}

func Validate(ctx context.Context, document Document, snapshot Snapshot) (domain.ReviewAnalysis, error) {
	raw := document.raw
	if raw.BaseSHA != snapshot.BaseSHA || raw.HeadSHA != snapshot.HeadSHA {
		return domain.ReviewAnalysis{}, errors.New("analysis revisions do not match the prepared snapshot")
	}
	if snapshot.Files == nil {
		return domain.ReviewAnalysis{}, errors.New("analysis file reader is required")
	}
	if err := validateModelIdentity(raw); err != nil {
		return domain.ReviewAnalysis{}, err
	}
	v := validator{ctx: ctx, files: snapshot.Files, cache: map[string][]byte{}, ids: map[string]rawEvidence{}}
	result := v.convert(raw)
	if err := validateAnalysisSubstance(result); err != nil {
		return domain.ReviewAnalysis{}, err
	}
	result.CreatedAt = time.Now().UTC()
	return result, nil
}

func validateModelIdentity(raw rawAnalysis) error {
	if strings.TrimSpace(raw.Summary) == "" {
		return errors.New("analysis returned an empty review summary")
	}
	if len(raw.Chapters) == 0 {
		return errors.New("analysis returned no review chapters")
	}
	unique := func(ids []string, kind, scope string) error {
		seen := map[string]bool{}
		for _, id := range ids {
			id = strings.TrimSpace(id)
			if id == "" {
				return fmt.Errorf("analysis returned an empty %s ID", kind)
			}
			if seen[id] {
				return fmt.Errorf("analysis reused %s ID %q within %s", kind, id, scope)
			}
			seen[id] = true
		}
		return nil
	}
	claims := func(values []rawClaim, scope string) error {
		ids := make([]string, len(values))
		for i, value := range values {
			ids[i] = value.ID
		}
		return unique(ids, "claim", scope)
	}
	risks := func(values []rawRisk, scope string) error {
		ids := make([]string, len(values))
		for i, value := range values {
			ids[i] = value.ID
		}
		return unique(ids, "risk", scope)
	}
	behaviors := func(values []rawBehavior, scope string) error {
		ids := make([]string, len(values))
		for i, value := range values {
			ids[i] = value.ID
		}
		return unique(ids, "behavior", scope)
	}
	for _, collection := range []struct {
		values []rawClaim
		scope  string
	}{{raw.Facts, "top-level facts"}, {raw.Inferences, "top-level inferences"}, {raw.Unknowns, "top-level unknowns"}} {
		if err := claims(collection.values, collection.scope); err != nil {
			return err
		}
	}
	if err := risks(raw.Risks, "top-level risks"); err != nil {
		return err
	}
	if err := behaviors(raw.BehavioralChanges, "top-level behavioral changes"); err != nil {
		return err
	}
	chapterIDs, orders := map[string]bool{}, map[int]bool{}
	for _, chapter := range raw.Chapters {
		if strings.TrimSpace(chapter.Title) == "" || strings.TrimSpace(chapter.Purpose) == "" {
			return fmt.Errorf("analysis returned an empty title or purpose for chapter %q", chapter.ID)
		}
		chapterID := strings.TrimSpace(chapter.ID)
		if chapterID == "" {
			return errors.New("analysis returned an empty chapter ID")
		}
		if chapterIDs[chapterID] {
			return fmt.Errorf("analysis reused chapter ID %q", chapterID)
		}
		chapterIDs[chapterID] = true
		if chapter.Order < 1 || orders[chapter.Order] {
			return fmt.Errorf("analysis returned invalid or duplicate chapter order %d", chapter.Order)
		}
		orders[chapter.Order] = true
		for _, collection := range []struct {
			values []rawClaim
			scope  string
		}{{chapter.Facts, "chapter facts"}, {chapter.Inferences, "chapter inferences"}, {chapter.Unknowns, "chapter unknowns"}} {
			if err := claims(collection.values, collection.scope); err != nil {
				return err
			}
		}
		if err := risks(chapter.Risks, "chapter risks"); err != nil {
			return err
		}
		if err := behaviors(chapter.BehavioralChanges, "chapter behavioral changes"); err != nil {
			return err
		}
		testIDs := make([]string, len(chapter.RelatedTests))
		for i, test := range chapter.RelatedTests {
			testIDs[i] = test.ID
		}
		if err := unique(testIDs, "test", "chapter related tests"); err != nil {
			return err
		}
		questionIDs := make([]string, len(chapter.SuggestedQuestions))
		for i, question := range chapter.SuggestedQuestions {
			questionIDs[i] = question.ID
		}
		if err := unique(questionIDs, "question", "chapter suggested questions"); err != nil {
			return err
		}
	}
	return nil
}

func validateAnalysisSubstance(result domain.ReviewAnalysis) error {
	valid := func(values []domain.EvidenceReference) bool { return hasValid(values) }
	hasFindings, hasValidatedFinding := false, false
	for _, chapter := range result.Chapters {
		for _, symbol := range chapter.Symbols {
			hasFindings, hasValidatedFinding = true, hasValidatedFinding || valid(symbol.Evidence)
		}
		for _, change := range chapter.BehavioralChanges {
			hasFindings, hasValidatedFinding = true, hasValidatedFinding || valid(change.Evidence)
		}
		for _, risk := range chapter.Risks {
			hasFindings, hasValidatedFinding = true, hasValidatedFinding || valid(risk.Evidence)
		}
		for _, group := range [][]domain.Claim{chapter.Facts, chapter.Inferences, chapter.Unknowns} {
			for _, claim := range group {
				hasFindings, hasValidatedFinding = true, hasValidatedFinding || valid(claim.Evidence)
			}
		}
		for _, test := range chapter.RelatedTests {
			hasFindings, hasValidatedFinding = true, hasValidatedFinding || valid(test.Evidence)
		}
		for _, question := range chapter.SuggestedQuestions {
			hasFindings, hasValidatedFinding = true, hasValidatedFinding || valid(question.Evidence)
		}
	}
	if !hasFindings {
		return errors.New("analysis returned no substantive review findings")
	}
	if !hasValidatedFinding {
		return errors.New("analysis returned no validated evidence for the walkthrough")
	}
	return nil
}

type validator struct {
	ctx    context.Context
	files  FileReader
	cache  map[string][]byte
	ids    map[string]rawEvidence
	issues []domain.ValidationIssue
}

func (v *validator) evidence(values []rawEvidence) []domain.EvidenceReference {
	out := make([]domain.EvidenceReference, 0, len(values))
	for _, raw := range values {
		evidence := domain.EvidenceReference{ID: raw.ID, Path: filepath.ToSlash(raw.Path), Revision: domain.Revision(raw.Revision), StartLine: raw.StartLine, EndLine: raw.EndLine, Symbol: raw.Symbol, ValidationStatus: domain.ValidationInvalid}
		reason := ""
		if raw.ID == "" {
			reason = "evidence ID is empty"
		} else if existing, ok := v.ids[raw.ID]; ok && existing != raw {
			reason = "evidence ID is reused for a different location"
		} else {
			v.ids[raw.ID] = raw
		}
		if reason == "" {
			reason = validatePath(raw.Path)
		}
		if raw.Revision != string(domain.RevisionBase) && raw.Revision != string(domain.RevisionHead) && reason == "" {
			reason = "revision must be base or head"
		}
		if reason == "" && (raw.StartLine < 1 || raw.EndLine < raw.StartLine) {
			reason = "line range must be 1-based and inclusive"
		}
		if reason == "" {
			key := raw.Revision + ":" + evidence.Path
			content, ok := v.cache[key]
			if !ok {
				var err error
				content, err = v.files.ReadFile(v.ctx, evidence.Revision, evidence.Path)
				if err != nil {
					reason = "path does not exist at the selected revision"
				} else {
					v.cache[key] = content
				}
			}
			if reason == "" && raw.EndLine > lineCount(content) {
				reason = fmt.Sprintf("line range ends at %d but file has %d lines", raw.EndLine, lineCount(content))
			}
		}
		if reason == "" {
			evidence.ValidationStatus = domain.ValidationValid
		} else {
			evidence.ValidationMessage = reason
			v.issues = append(v.issues, domain.ValidationIssue{Code: "invalid_evidence", Message: reason, EvidenceID: raw.ID})
		}
		out = append(out, evidence)
	}
	return out
}

func validatePath(path string) string {
	if path == "" || strings.ContainsRune(path, 0) {
		return "path is empty or contains NUL"
	}
	if filepath.IsAbs(path) || filepath.VolumeName(path) != "" {
		return "path must be repository-relative"
	}
	normal := filepath.ToSlash(filepath.Clean(path))
	if normal == "." || normal == ".." || strings.HasPrefix(normal, "../") || strings.HasPrefix(normal, "/") {
		return "path escapes the selected repository"
	}
	if runtime.GOOS == "windows" && strings.Contains(path, `\`) {
		return "path must use repository separators"
	}
	if filepath.ToSlash(path) != normal {
		return "path must be canonical and repository-relative"
	}
	return ""
}

func lineCount(content []byte) int {
	if len(content) == 0 {
		return 0
	}
	count := strings.Count(string(content), "\n")
	if content[len(content)-1] != '\n' {
		count++
	}
	return count
}

func (v *validator) claims(values []rawClaim, kind domain.ClaimKind) []domain.Claim {
	out := make([]domain.Claim, 0, len(values))
	for _, raw := range values {
		evidence := v.evidence(raw.Evidence)
		status, message := domain.ValidationUnverified, "claim has no valid supporting evidence"
		if hasValid(evidence) {
			status, message = domain.ValidationValid, ""
		}
		if kind != domain.ClaimUnknown && status == domain.ValidationUnverified {
			v.issues = append(v.issues, domain.ValidationIssue{Code: "unsupported_claim", Message: message, EvidenceID: raw.ID})
		}
		out = append(out, domain.Claim{ID: raw.ID, Kind: kind, Text: raw.Text, Evidence: evidence, ValidationStatus: status, ValidationMessage: message})
	}
	return out
}

func hasValid(values []domain.EvidenceReference) bool {
	for _, value := range values {
		if value.ValidationStatus == domain.ValidationValid {
			return true
		}
	}
	return false
}

func supportStatus(evidence []domain.EvidenceReference) (domain.ValidationStatus, string) {
	if hasValid(evidence) {
		return domain.ValidationValid, ""
	}
	return domain.ValidationUnverified, "statement has no valid supporting evidence"
}

func (v *validator) convert(raw rawAnalysis) domain.ReviewAnalysis {
	summaryEvidence := v.evidence(raw.SummaryEvidence)
	summaryStatus, summaryMessage := supportStatus(summaryEvidence)
	out := domain.ReviewAnalysis{SchemaVersion: raw.SchemaVersion, BaseSHA: raw.BaseSHA, HeadSHA: raw.HeadSHA, Summary: raw.Summary, SummaryEvidence: summaryEvidence, SummaryValidation: summaryStatus, SummaryMessage: summaryMessage}
	if summaryStatus != domain.ValidationValid {
		v.issues = append(v.issues, domain.ValidationIssue{Code: "unsupported_summary", Message: summaryMessage})
	}
	for _, area := range raw.AffectedAreas {
		evidence := v.evidence(area.Evidence)
		status, message := supportStatus(evidence)
		if status != domain.ValidationValid {
			v.issues = append(v.issues, domain.ValidationIssue{Code: "unsupported_affected_area", Message: message, EvidenceID: area.Name})
		}
		out.AffectedAreas = append(out.AffectedAreas, domain.AffectedArea{Name: area.Name, Description: area.Description, Evidence: evidence, ValidationStatus: status, ValidationMessage: message})
	}
	out.BehavioralChanges = v.behaviors(raw.BehavioralChanges)
	out.Risks = v.risks(raw.Risks)
	out.Facts = v.claims(raw.Facts, domain.ClaimFact)
	out.Inferences = v.claims(raw.Inferences, domain.ClaimInference)
	out.Unknowns = v.claims(raw.Unknowns, domain.ClaimUnknown)
	for _, chapter := range raw.Chapters {
		out.Chapters = append(out.Chapters, v.chapter(chapter))
	}
	out.ValidationIssues = v.issues
	return out
}

func (v *validator) behaviors(values []rawBehavior) []domain.BehavioralChange {
	out := make([]domain.BehavioralChange, 0, len(values))
	for _, raw := range values {
		evidence := v.evidence(raw.Evidence)
		status, message := supportStatus(evidence)
		if status != domain.ValidationValid {
			v.issues = append(v.issues, domain.ValidationIssue{Code: "unsupported_behavioral_change", Message: message, EvidenceID: raw.ID})
		}
		out = append(out, domain.BehavioralChange{ID: raw.ID, Summary: raw.Summary, Before: raw.Before, After: raw.After, Evidence: evidence, ValidationStatus: status, ValidationMessage: message})
	}
	return out
}

func (v *validator) risks(values []rawRisk) []domain.ReviewRisk {
	out := make([]domain.ReviewRisk, 0, len(values))
	for _, raw := range values {
		level := domain.RiskLevel(raw.Level)
		if level != domain.RiskLow && level != domain.RiskMedium && level != domain.RiskHigh && level != domain.RiskCritical {
			level = domain.RiskUnknown
		}
		evidence := v.evidence(raw.Evidence)
		status, message := supportStatus(evidence)
		if status != domain.ValidationValid {
			v.issues = append(v.issues, domain.ValidationIssue{Code: "unsupported_risk", Message: message, EvidenceID: raw.ID})
		}
		out = append(out, domain.ReviewRisk{ID: raw.ID, Title: raw.Title, Description: raw.Description, Level: level, Evidence: evidence, ValidationStatus: status, ValidationMessage: message})
	}
	return out
}

func (v *validator) chapter(raw rawChapter) domain.ReviewChapter {
	out := domain.ReviewChapter{ID: raw.ID, Order: raw.Order, Title: raw.Title, Description: raw.Description, Purpose: raw.Purpose, Status: domain.ChapterNotReviewed, Evidence: v.evidence(raw.Evidence), BehavioralChanges: v.behaviors(raw.BehavioralChanges), Risks: v.risks(raw.Risks), Facts: v.claims(raw.Facts, domain.ClaimFact), Inferences: v.claims(raw.Inferences, domain.ClaimInference), Unknowns: v.claims(raw.Unknowns, domain.ClaimUnknown)}
	for _, file := range raw.Files {
		status, message := v.validateFilePath(file.Path)
		out.Files = append(out.Files, domain.FileReference{Path: filepath.ToSlash(file.Path), Description: file.Description, ValidationStatus: status, ValidationMessage: message})
		if status != domain.ValidationValid {
			v.issues = append(v.issues, domain.ValidationIssue{Code: "invalid_path", Message: message, EvidenceID: raw.ID})
		}
	}
	for _, symbol := range raw.Symbols {
		evidence := v.evidence(symbol.Evidence)
		status, message := v.validateFilePath(symbol.Path)
		if status == domain.ValidationValid && !hasValid(evidence) {
			status, message = domain.ValidationUnverified, "symbol has no valid supporting evidence"
		}
		if status != domain.ValidationValid {
			v.issues = append(v.issues, domain.ValidationIssue{Code: "unverified_symbol", Message: message, EvidenceID: raw.ID})
			continue
		}
		out.Symbols = append(out.Symbols, domain.SymbolReference{Path: filepath.ToSlash(symbol.Path), Name: symbol.Name, Evidence: evidence})
	}
	for _, test := range raw.RelatedTests {
		evidence := v.evidence(test.Evidence)
		status, message := v.validateFilePath(test.Path)
		if status == domain.ValidationValid && !hasValid(evidence) {
			status, message = domain.ValidationUnverified, "test relationship has no valid supporting evidence"
		}
		if status != domain.ValidationValid {
			v.issues = append(v.issues, domain.ValidationIssue{Code: "unverified_test", Message: message, EvidenceID: test.ID})
		}
		out.RelatedTests = append(out.RelatedTests, domain.TestReference{ID: test.ID, Path: filepath.ToSlash(test.Path), Description: test.Description, Evidence: evidence, Relationship: status})
	}
	for _, question := range raw.SuggestedQuestions {
		out.SuggestedQuestions = append(out.SuggestedQuestions, domain.SuggestedQuestion{ID: question.ID, Text: question.Text, Rationale: question.Rationale, Evidence: v.evidence(question.Evidence)})
	}
	sort.SliceStable(out.RelatedTests, func(i, j int) bool { return out.RelatedTests[i].Path < out.RelatedTests[j].Path })
	return out
}

func (v *validator) validateFilePath(path string) (domain.ValidationStatus, string) {
	if reason := validatePath(path); reason != "" {
		return domain.ValidationInvalid, reason
	}
	normal := filepath.ToSlash(path)
	for _, revision := range []domain.Revision{domain.RevisionHead, domain.RevisionBase} {
		key := string(revision) + ":" + normal
		if _, ok := v.cache[key]; ok {
			return domain.ValidationValid, ""
		}
		content, err := v.files.ReadFile(v.ctx, revision, normal)
		if err == nil {
			v.cache[key] = content
			return domain.ValidationValid, ""
		}
	}
	return domain.ValidationInvalid, "path does not exist at the selected revisions"
}
