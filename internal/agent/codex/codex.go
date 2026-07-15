package codex

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"reviewarc/internal/agent"
	sharedanalysis "reviewarc/internal/analysis"
	"reviewarc/internal/analysisbundle"
	"reviewarc/internal/analysiscontext"
	"reviewarc/internal/domain"
	processpkg "reviewarc/internal/process"
)

const maxLaunchPromptBytes = 16 << 10

type Config struct {
	Timeout                 time.Duration
	MaxOutput               int
	ContextServerExecutable string
}

type Provider struct {
	runner processpkg.Runner
	config Config
}

func New(runner processpkg.Runner, config Config) *Provider {
	if config.Timeout <= 0 {
		config.Timeout = 15 * time.Minute
	}
	if config.MaxOutput <= 0 {
		config.MaxOutput = 32 << 20
	}
	return &Provider{runner: runner, config: config}
}

func (p *Provider) ID() domain.HarnessID { return domain.HarnessCodex }

func (p *Provider) Capabilities(ctx context.Context) (domain.HarnessCapabilities, error) {
	capabilities := domain.HarnessCapabilities{
		ID: domain.HarnessCodex, Name: "Codex", State: domain.HarnessAvailable,
		SupportsJSONSchema: true, EnforcesReadOnly: true, SupportsProgress: true, SupportsCancellation: true,
		ContextTransports: []domain.ContextTransport{domain.ContextReviewArcTools},
		Limits:            domain.HarnessLimits{MaxInputBytes: maxLaunchPromptBytes, MaxOutputBytes: p.config.MaxOutput},
	}
	if p.runner == nil {
		capabilities.State = domain.HarnessBroken
		return capabilities, errors.New("codex: runner is required")
	}
	version, err := p.runner.Run(ctx, processpkg.Command{Tool: processpkg.Codex, Args: []string{"--version"}, Timeout: 5 * time.Second, MaxOutput: 64 << 10})
	if err != nil {
		if errors.Is(err, processpkg.ErrToolNotFound) {
			capabilities.State = domain.HarnessMissing
		} else {
			capabilities.State = domain.HarnessBroken
		}
		return capabilities, err
	}
	capabilities.Version = strings.TrimSpace(string(version.Stdout))
	if _, err := p.runner.Run(ctx, processpkg.Command{Tool: processpkg.Codex, Args: []string{"login", "status"}, Timeout: 5 * time.Second, MaxOutput: 64 << 10}); err != nil {
		capabilities.State = domain.HarnessBroken
		capabilities.Message = "Sign in to Codex before using it for analysis"
		return capabilities, errors.New("Codex authentication is required")
	}
	catalog, err := p.loadModelCatalog(ctx)
	if err != nil {
		capabilities.State = domain.HarnessUnsupported
		return capabilities, err
	}
	for _, raw := range catalog.Models {
		if raw.Slug == "" || raw.Visibility == "hide" {
			continue
		}
		model := domain.ModelCapability{ID: raw.Slug, Name: raw.DisplayName, DefaultReasoningLevel: domain.ReasoningLevel(raw.DefaultReasoning)}
		if model.Name == "" {
			model.Name = model.ID
		}
		for _, level := range raw.Reasoning {
			if level.Effort != "" {
				model.ReasoningLevels = append(model.ReasoningLevels, domain.ReasoningLevel(level.Effort))
			}
		}
		if len(capabilities.Models) == 0 {
			model.Recommended = true
			capabilities.DefaultModel = model.ID
		}
		capabilities.Models = append(capabilities.Models, model)
	}
	if len(capabilities.Models) == 0 {
		capabilities.State = domain.HarnessUnsupported
		return capabilities, errors.New("Codex returned no selectable models")
	}
	return capabilities, nil
}

type modelCatalog struct {
	Models []struct {
		Slug             string `json:"slug"`
		DisplayName      string `json:"display_name"`
		DefaultReasoning string `json:"default_reasoning_level"`
		Visibility       string `json:"visibility"`
		Reasoning        []struct {
			Effort string `json:"effort"`
		} `json:"supported_reasoning_levels"`
	} `json:"models"`
}

func (p *Provider) loadModelCatalog(ctx context.Context) (modelCatalog, error) {
	result, err := p.runner.Run(ctx, processpkg.Command{Tool: processpkg.Codex, Args: []string{"debug", "models", "--bundled"}, Timeout: 20 * time.Second, MaxOutput: 16 << 20})
	if err != nil {
		return modelCatalog{}, fmt.Errorf("load Codex model catalog: %w", err)
	}
	var catalog modelCatalog
	if json.Unmarshal(result.Stdout, &catalog) != nil || len(catalog.Models) == 0 {
		return modelCatalog{}, errors.New("Codex returned an invalid model catalog")
	}
	return catalog, nil
}

func (p *Provider) AnalyzeChange(ctx context.Context, input agent.AnalyzeInput) (<-chan agent.Event, error) {
	if p.runner == nil {
		return nil, errors.New("codex: runner is required")
	}
	bundle, executable, err := p.validateInput(input)
	if err != nil {
		return nil, err
	}
	out := make(chan agent.Event, 8)
	go p.analyze(ctx, input, bundle, executable, out)
	return out, nil
}

func (p *Provider) validateInput(input agent.AnalyzeInput) (*analysisbundle.Bundle, string, error) {
	if input.Profile.Harness != domain.HarnessCodex || strings.TrimSpace(input.Profile.Model) == "" || input.Profile.Reasoning == "" {
		return nil, "", errors.New("codex: complete Codex profile is required")
	}
	if input.ContextTransport != domain.ContextReviewArcTools {
		return nil, "", errors.New("codex: ReviewArc controlled context tools are required")
	}
	bundle, err := analysisbundle.Open(input.DataRoot, input.Bundle.Path, input.Bundle.Digest)
	if err != nil {
		return nil, "", fmt.Errorf("codex: open analysis bundle: %w", err)
	}
	if input.Snapshot.BaseSHA != bundle.Manifest.Revisions.Base || input.Snapshot.HeadSHA != bundle.Manifest.Revisions.Head || input.Snapshot.Files == nil {
		return nil, "", errors.New("codex: validation snapshot does not match the analysis bundle")
	}
	executable := p.config.ContextServerExecutable
	if executable == "" {
		executable, err = os.Executable()
	}
	if err != nil || !filepath.IsAbs(executable) {
		return nil, "", errors.New("codex: context server executable is unavailable")
	}
	return bundle, executable, nil
}

func (p *Provider) analyze(parent context.Context, input agent.AnalyzeInput, bundle *analysisbundle.Bundle, executable string, out chan<- agent.Event) {
	defer close(out)
	ctx, cancel := context.WithTimeout(parent, p.config.Timeout)
	defer cancel()
	emit := func(event agent.Event) bool {
		select {
		case out <- event:
			return true
		case <-ctx.Done():
			return false
		}
	}
	if !emit(agent.Event{Kind: agent.EventStarted, Message: "Starting read-only analysis"}) {
		return
	}
	schemaPath, err := writePrivateFile("reviewarc-analysis-schema-*.json", sharedanalysis.Schema())
	if err != nil {
		emit(failureEvent(domain.FailureConfigurationRequired, "Analysis could not start", "ReviewArc could not prepare the structured-output contract.", domain.RetrySamePlan, err))
		return
	}
	defer os.Remove(schemaPath)
	catalogPath, err := p.writeToollessModelCatalog(ctx)
	if err != nil {
		emit(providerFailure(err, nil))
		return
	}
	defer os.Remove(catalogPath)
	prompt := analysisbundle.LaunchPrompt(input.Bundle)
	if len(prompt) > maxLaunchPromptBytes {
		emit(failureEvent(domain.FailureRetryRequiresReplan, "Analysis plan is too large", "ReviewArc must create a smaller analysis plan before retrying.", domain.RetryChangeProfile, errors.New("bounded launch prompt exceeded its invariant")))
		return
	}
	tracker := agent.NewAccessTracker(bundle.Manifest)
	command := processpkg.Command{
		Tool: processpkg.Codex, Dir: filepath.Join(bundle.Path, "run"), Timeout: p.config.Timeout,
		Args: invocationArgs(input, schemaPath, catalogPath, executable), Stdin: []byte(prompt), MaxOutput: p.config.MaxOutput,
		OnStdoutLine: func(line []byte) {
			if message := progressMessage(line, bundle.Manifest); message != "" {
				emit(agent.Event{Kind: agent.EventProgress, Message: message})
			}
		},
	}
	if !emit(agent.Event{Kind: agent.EventProgress, Message: "Reading the prepared review context"}) {
		return
	}
	result, runErr := p.runner.Run(ctx, command)
	if runErr != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			emit(agent.Event{Kind: agent.EventCancelled, Message: "Analysis cancelled", Err: context.Canceled})
			return
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			emit(failureEvent(domain.FailureTimeout, "Analysis timed out", "The analysis harness did not finish in time.", domain.RetrySamePlan, ctx.Err()))
			return
		}
		emit(providerFailure(runErr, result.Stderr))
		return
	}
	if !emit(agent.Event{Kind: agent.EventValidating, Message: "Validating structured output"}) {
		return
	}
	document, warnings, err := parseJSONL(result.Stdout, tracker)
	for _, warning := range warnings {
		if !emit(agent.Event{Kind: agent.EventWarning, Message: warning}) {
			return
		}
	}
	if err != nil {
		code := domain.FailureMalformedOutput
		title := "The analysis response was invalid"
		message := "The harness did not return ReviewArc's required structured review."
		if errors.Is(err, errPolicyViolation) {
			code, title, message = domain.FailurePolicyViolation, "Analysis stopped for safety", "The harness attempted to use context outside ReviewArc's approved read-only tools."
		}
		emit(failureEvent(code, title, message, domain.RetrySamePlan, err))
		return
	}
	if !emit(agent.Event{Kind: agent.EventValidating, Message: "Checking analysis evidence"}) {
		return
	}
	analysis, err := sharedanalysis.Validate(ctx, document, input.Snapshot)
	if err != nil {
		emit(failureEvent(domain.FailureEvidenceValidation, "Analysis evidence could not be verified", "The generated review did not contain enough valid evidence for a guided walkthrough.", domain.RetrySamePlan, err))
		return
	}
	coverage := tracker.Coverage()
	emit(agent.Event{Kind: agent.EventCompleted, Message: "Analysis ready", Analysis: &analysis, Issues: analysis.ValidationIssues, Coverage: &coverage})
}

func invocationArgs(input agent.AnalyzeInput, schemaPath, catalogPath, executable string) []string {
	mcpArgs := []string{"context-server", "--data-root", input.DataRoot, "--bundle", input.Bundle.Path, "--digest", input.Bundle.Digest}
	args := []string{
		"exec", "--json", "--output-schema", schemaPath, "--sandbox", "read-only", "--ephemeral",
		"--ignore-user-config", "--ignore-rules", "--strict-config", "--skip-git-repo-check", "--color", "never",
		"--model", input.Profile.Model,
	}
	settings := [][2]string{
		{"approval_policy", strconv.Quote("never")},
		{"shell_environment_policy.inherit", strconv.Quote("none")},
		{"web_search", strconv.Quote("disabled")},
		{"memories.use_memories", "false"}, {"memories.generate_memories", "false"},
		{"features.remote_plugin", "false"},
		{"model_reasoning_effort", strconv.Quote(string(input.Profile.Reasoning))},
		{"model_catalog_json", strconv.Quote(catalogPath)},
		{"mcp_servers.reviewarc.command", strconv.Quote(executable)},
		{"mcp_servers.reviewarc.args", tomlStrings(mcpArgs)},
		{"mcp_servers.reviewarc.required", "true"},
		{"mcp_servers.reviewarc.enabled_tools", tomlStrings(analysiscontext.ToolNames)},
		{"mcp_servers.reviewarc.default_tools_approval_mode", strconv.Quote("approve")},
		{"mcp_servers.reviewarc.startup_timeout_sec", "15"}, {"mcp_servers.reviewarc.tool_timeout_sec", "30"},
	}
	for _, setting := range settings {
		args = append(args, "-c", setting[0]+"="+setting[1])
	}
	return append(args, "-C", filepath.Join(input.Bundle.Path, "run"), "-")
}

func tomlStrings(values []string) string {
	quoted := make([]string, len(values))
	for i, value := range values {
		quoted[i] = strconv.Quote(value)
	}
	return "[" + strings.Join(quoted, ",") + "]"
}

func (p *Provider) writeToollessModelCatalog(ctx context.Context) (string, error) {
	result, err := p.runner.Run(ctx, processpkg.Command{Tool: processpkg.Codex, Args: []string{"debug", "models", "--bundled"}, Timeout: 20 * time.Second, MaxOutput: 16 << 20})
	if err != nil {
		return "", fmt.Errorf("load Codex model catalog: %w", err)
	}
	var catalog struct {
		Models []map[string]any `json:"models"`
	}
	if json.Unmarshal(result.Stdout, &catalog) != nil || len(catalog.Models) == 0 {
		return "", errors.New("Codex returned an invalid model catalog")
	}
	for _, model := range catalog.Models {
		model["shell_type"] = "disabled"
		model["experimental_supported_tools"] = []any{}
	}
	data, err := json.Marshal(catalog)
	if err != nil {
		return "", err
	}
	return writePrivateFile("reviewarc-codex-models-*.json", data)
}

func writePrivateFile(pattern string, data []byte) (string, error) {
	file, err := os.CreateTemp("", pattern)
	if err != nil {
		return "", err
	}
	name := file.Name()
	if err = file.Chmod(0o600); err == nil {
		_, err = file.Write(data)
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(name)
		return "", err
	}
	return name, nil
}

var errPolicyViolation = errors.New("analysis harness policy violation")

type envelope struct {
	Type string `json:"type"`
	Item struct {
		Type      string          `json:"type"`
		Text      string          `json:"text"`
		Message   string          `json:"message"`
		Server    string          `json:"server"`
		Tool      string          `json:"tool"`
		Name      string          `json:"name"`
		Status    string          `json:"status"`
		Arguments json.RawMessage `json:"arguments"`
		Result    json.RawMessage `json:"result"`
	} `json:"item"`
}

func progressMessage(line []byte, manifest analysisbundle.Manifest) string {
	var event envelope
	if json.Unmarshal(line, &event) != nil {
		return ""
	}
	switch event.Type {
	case "thread.started", "turn.started":
		return "Planning the review"
	case "item.completed":
		if event.Item.Type != "mcp_tool_call" || event.Item.Server != "reviewarc" {
			return ""
		}
		tool := event.Item.Tool
		if tool == "" {
			tool = event.Item.Name
		}
		return agent.ContextActivityMessage(tool, event.Item.Arguments, manifest)
	case "turn.completed":
		return "Analysis response received"
	default:
		return ""
	}
}

func parseJSONL(data []byte, tracker *agent.AccessTracker) (sharedanalysis.Document, []string, error) {
	var final string
	var warnings []string
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	scanner.Buffer(make([]byte, 64<<10), 32<<20)
	lineNo := 0
	for scanner.Scan() {
		lineNo++
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var event envelope
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			return sharedanalysis.Document{}, warnings, fmt.Errorf("Codex JSONL line %d is invalid: %w", lineNo, err)
		}
		switch event.Item.Type {
		case "command_execution", "file_change", "web_search":
			return sharedanalysis.Document{}, warnings, fmt.Errorf("%w: attempted %s", errPolicyViolation, event.Item.Type)
		case "mcp_tool_call":
			tool := event.Item.Tool
			if tool == "" {
				tool = event.Item.Name
			}
			if event.Item.Server != "reviewarc" || !agent.IsAllowedContextTool(tool) {
				return sharedanalysis.Document{}, warnings, fmt.Errorf("%w: unapproved MCP call %s/%s", errPolicyViolation, event.Item.Server, tool)
			}
			if event.Type == "item.completed" && (event.Item.Status == "" || event.Item.Status == "completed" || event.Item.Status == "success") {
				if err := tracker.Record(tool, event.Item.Arguments, event.Item.Result); err != nil {
					return sharedanalysis.Document{}, warnings, fmt.Errorf("record context access: %w", err)
				}
			}
		case "agent_message":
			if event.Type == "item.completed" {
				final = event.Item.Text
			}
		case "error":
			if message := strings.TrimSpace(event.Item.Message); message != "" {
				warnings = append(warnings, "The harness reported a recoverable analysis warning.")
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return sharedanalysis.Document{}, warnings, err
	}
	if final == "" {
		return sharedanalysis.Document{}, warnings, errors.New("Codex completed without a structured analysis")
	}
	document, err := sharedanalysis.Decode([]byte(final))
	if err != nil {
		return sharedanalysis.Document{}, warnings, fmt.Errorf("Codex structured output: %w", err)
	}
	return document, warnings, nil
}

func providerFailure(err error, stderr []byte) agent.Event {
	detail := strings.TrimSpace(string(stderr))
	if detail == "" && err != nil {
		detail = err.Error()
	}
	lower := strings.ToLower(detail)
	switch {
	case strings.Contains(lower, "input_too_large") || strings.Contains(lower, "input exceeds") || strings.Contains(lower, "max_chars") || strings.Contains(lower, "maximum length"):
		return failureEvent(domain.FailureInputTooLarge, "This change exceeded the harness input limit", "ReviewArc did not repeat the oversized request. Choose another profile or retry after the analysis plan changes.", domain.RetryChangeProfile, errors.New(detail))
	case strings.Contains(lower, "unauthorized") || strings.Contains(lower, "authentication") || strings.Contains(lower, "sign in") || strings.Contains(lower, "api key"):
		return failureEvent(domain.FailureAuthentication, "The analysis harness needs authentication", "Sign in to the selected harness, then check the analysis setup again.", domain.RetryAuthenticate, errors.New(detail))
	case strings.Contains(lower, "rate limit") || strings.Contains(lower, "too many requests"):
		return failureEvent(domain.FailureRateLimited, "The analysis harness is rate limited", "Wait a moment, then try the analysis again.", domain.RetrySamePlan, errors.New(detail))
	case strings.Contains(lower, "unavailable") || strings.Contains(lower, "overloaded"):
		return failureEvent(domain.FailureProviderUnavailable, "The analysis harness is unavailable", "The provider is temporarily unavailable. Try again shortly.", domain.RetrySamePlan, errors.New(detail))
	default:
		return failureEvent(domain.FailureProvider, "Analysis did not complete", "The selected harness stopped before ReviewArc received a valid review.", domain.RetrySamePlan, fmt.Errorf("%w: %s", err, detail))
	}
}

func failureEvent(code domain.AnalysisFailureCode, title, message string, action domain.AnalysisRetryAction, err error) agent.Event {
	failure := domain.AnalysisFailure{Code: code, Title: title, Message: message, Action: action, Retryable: action == domain.RetrySamePlan || action == domain.RetryReplan}
	if err != nil {
		failure.TechnicalDetails = err.Error()
	}
	return agent.Event{Kind: agent.EventFailed, Message: message, Failure: &failure, Err: err}
}
