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
	normalizeModelPresentation(&raw)
	if raw.BaseSHA != snapshot.BaseSHA || raw.HeadSHA != snapshot.HeadSHA {
		return domain.ReviewAnalysis{}, errors.New("analysis revisions do not match the prepared snapshot")
	}
	if snapshot.Files == nil {
		return domain.ReviewAnalysis{}, errors.New("analysis file reader is required")
	}
	if err := validateModelIdentity(raw); err != nil {
		return domain.ReviewAnalysis{}, err
	}
	v := validator{ctx: ctx, files: snapshot.Files, cache: map[string][]byte{}}
	result := v.convert(raw)
	if err := validateAnalysisSubstance(result); err != nil {
		return domain.ReviewAnalysis{}, err
	}
	result.CreatedAt = time.Now().UTC()
	return result, nil
}

func validateModelIdentity(raw rawAnalysis) error {
	if len(raw.Chapters) == 0 {
		return errors.New("analysis returned no review chapters")
	}
	for _, chapter := range raw.Chapters {
		if strings.TrimSpace(chapter.Title) == "" || strings.TrimSpace(chapter.Purpose) == "" {
			return fmt.Errorf("analysis returned an empty title or purpose for chapter %q", chapter.ID)
		}
	}
	return nil
}

func normalizeModelPresentation(raw *rawAnalysis) {
	if strings.TrimSpace(raw.Summary) == "" {
		raw.Summary = "Review the evidence-backed changes in this pull request."
	}
	normalizeClaims := func(values []rawClaim, prefix string) {
		seen := map[string]bool{}
		for i := range values {
			values[i].ID = normalizedID(values[i].ID, prefix, i, seen)
		}
	}
	normalizeRisks := func(values []rawRisk, prefix string) {
		seen := map[string]bool{}
		for i := range values {
			values[i].ID = normalizedID(values[i].ID, prefix, i, seen)
		}
	}
	normalizeBehaviors := func(values []rawBehavior, prefix string) {
		seen := map[string]bool{}
		for i := range values {
			values[i].ID = normalizedID(values[i].ID, prefix, i, seen)
		}
	}
	normalizeClaims(raw.Facts, "fact")
	normalizeClaims(raw.Inferences, "inference")
	normalizeClaims(raw.Unknowns, "unknown")
	normalizeRisks(raw.Risks, "risk")
	normalizeBehaviors(raw.BehavioralChanges, "behavior")
	chapterIDs := map[string]bool{}
	for i := range raw.Chapters {
		chapter := &raw.Chapters[i]
		chapter.ID = normalizedID(chapter.ID, "chapter", i, chapterIDs)
		chapter.Order = i + 1
		if strings.TrimSpace(chapter.Title) == "" {
			chapter.Title = fmt.Sprintf("Review area %d", i+1)
		}
		if strings.TrimSpace(chapter.Purpose) == "" {
			chapter.Purpose = "Review the evidence-backed changes in this area."
		}
		normalizeClaims(chapter.Facts, "fact")
		normalizeClaims(chapter.Inferences, "inference")
		normalizeClaims(chapter.Unknowns, "unknown")
		normalizeRisks(chapter.Risks, "risk")
		normalizeBehaviors(chapter.BehavioralChanges, "behavior")
		testIDs := map[string]bool{}
		for j := range chapter.RelatedTests {
			chapter.RelatedTests[j].ID = normalizedID(chapter.RelatedTests[j].ID, "test", j, testIDs)
		}
		questionIDs := map[string]bool{}
		for j := range chapter.SuggestedQuestions {
			chapter.SuggestedQuestions[j].ID = normalizedID(chapter.SuggestedQuestions[j].ID, "question", j, questionIDs)
		}
	}
}

func normalizedID(value, prefix string, index int, seen map[string]bool) string {
	value = strings.TrimSpace(value)
	if value != "" && !seen[value] {
		seen[value] = true
		return value
	}
	for candidate := fmt.Sprintf("%s-%d", prefix, index+1); ; candidate = candidate + "-copy" {
		if !seen[candidate] {
			seen[candidate] = true
			return candidate
		}
	}
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
	issues []domain.ValidationIssue
}

func (v *validator) evidence(values []rawEvidence) []domain.EvidenceReference {
	out := make([]domain.EvidenceReference, 0, len(values))
	seen := map[string]bool{}
	for index, raw := range values {
		revision := strings.ToLower(strings.TrimSpace(raw.Revision))
		evidence := domain.EvidenceReference{ID: normalizedID(raw.ID, "evidence", index, seen), Path: filepath.ToSlash(raw.Path), Revision: domain.Revision(revision), StartLine: raw.StartLine, EndLine: raw.EndLine, Symbol: raw.Symbol, ValidationStatus: domain.ValidationInvalid}
		reason := ""
		reason = validatePath(raw.Path)
		if revision != string(domain.RevisionBase) && revision != string(domain.RevisionHead) && reason == "" {
			reason = "revision must be base or head"
		}
		if reason == "" && (raw.StartLine < 1 || raw.EndLine < raw.StartLine) {
			reason = "line range must be 1-based and inclusive"
		}
		if reason == "" {
			key := revision + ":" + evidence.Path
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
		level := domain.RiskLevel(strings.ToLower(strings.TrimSpace(raw.Level)))
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
