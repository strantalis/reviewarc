package analysis

type rawEvidence struct {
	ID, Path, Revision string
	StartLine, EndLine int
	Symbol             string
}
type rawClaim struct {
	ID, Text string
	Evidence []rawEvidence
}
type rawBehavior struct {
	ID, Summary, Before, After string
	Evidence                   []rawEvidence
}
type rawRisk struct {
	ID, Title, Description, Level string
	Evidence                      []rawEvidence
}
type rawAffectedArea struct {
	Name, Description string
	Evidence          []rawEvidence
}
type rawFile struct{ Path, Description string }
type rawSymbol struct {
	Path, Name string
	Evidence   []rawEvidence
}
type rawTest struct {
	ID, Path, Description string
	Evidence              []rawEvidence
}
type rawQuestion struct {
	ID, Text, Rationale string
	Evidence            []rawEvidence
}
type rawChapter struct {
	ID                          string
	Order                       int
	Title, Description, Purpose string
	Evidence                    []rawEvidence
	Files                       []rawFile
	Symbols                     []rawSymbol
	BehavioralChanges           []rawBehavior
	Risks                       []rawRisk
	Facts, Inferences, Unknowns []rawClaim
	RelatedTests                []rawTest
	SuggestedQuestions          []rawQuestion
}
type rawAnalysis struct {
	SchemaVersion     int               `json:"schemaVersion"`
	BaseSHA           string            `json:"baseSha"`
	HeadSHA           string            `json:"headSha"`
	Summary           string            `json:"summary"`
	SummaryEvidence   []rawEvidence     `json:"summaryEvidence"`
	AffectedAreas     []rawAffectedArea `json:"affectedAreas"`
	Chapters          []rawChapter      `json:"chapters"`
	BehavioralChanges []rawBehavior     `json:"behavioralChanges"`
	Risks             []rawRisk         `json:"risks"`
	Facts             []rawClaim        `json:"facts"`
	Inferences        []rawClaim        `json:"inferences"`
	Unknowns          []rawClaim        `json:"unknowns"`
}
