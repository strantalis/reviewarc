package agent

import (
	"context"
	"errors"
	"testing"

	"reviewarc/internal/domain"
)

type fixtureAdapter struct {
	id   domain.HarnessID
	caps domain.HarnessCapabilities
	err  error
}

func (f fixtureAdapter) ID() domain.HarnessID { return f.id }
func (f fixtureAdapter) Capabilities(context.Context) (domain.HarnessCapabilities, error) {
	return f.caps, f.err
}
func (f fixtureAdapter) AnalyzeChange(context.Context, AnalyzeInput) (<-chan Event, error) {
	return nil, nil
}

func eligibleCapabilities() domain.HarnessCapabilities {
	return domain.HarnessCapabilities{
		State: domain.HarnessAvailable, SupportsJSONSchema: true, EnforcesReadOnly: true, SupportsProgress: true,
		ContextTransports: []domain.ContextTransport{domain.ContextReviewArcTools}, DefaultModel: "model-a",
		Models: []domain.ModelCapability{{ID: "model-a", Name: "Model A", ReasoningLevels: []domain.ReasoningLevel{domain.ReasoningLow, domain.ReasoningHigh}, DefaultReasoningLevel: domain.ReasoningLow}},
	}
}

func TestRegistryRejectsDuplicateAndMissingIDs(t *testing.T) {
	if _, err := NewRegistry(fixtureAdapter{}); err == nil {
		t.Fatal("missing ID accepted")
	}
	if _, err := NewRegistry(fixtureAdapter{id: domain.HarnessCodex}, fixtureAdapter{id: domain.HarnessCodex}); err == nil {
		t.Fatal("duplicate ID accepted")
	}
}

func TestRegistryResolvesDefaultsAndExplicitProfile(t *testing.T) {
	registry, err := NewRegistry(fixtureAdapter{id: domain.HarnessCodex, caps: eligibleCapabilities()})
	if err != nil {
		t.Fatal(err)
	}
	adapter, profile, _, err := registry.Resolve(context.Background(), domain.AnalysisProfile{Harness: domain.HarnessCodex})
	if err != nil || adapter.ID() != domain.HarnessCodex || profile.Model != "model-a" || profile.Reasoning != domain.ReasoningLow {
		t.Fatalf("default resolution adapter=%v profile=%+v err=%v", adapter, profile, err)
	}
	_, profile, _, err = registry.Resolve(context.Background(), domain.AnalysisProfile{Harness: domain.HarnessCodex, Model: "model-a", Reasoning: domain.ReasoningHigh})
	if err != nil || profile.Reasoning != domain.ReasoningHigh {
		t.Fatalf("explicit resolution profile=%+v err=%v", profile, err)
	}
}

func TestRegistryRejectsMissingProfileAndInvalidChoices(t *testing.T) {
	registry, _ := NewRegistry(fixtureAdapter{id: domain.HarnessCodex, caps: eligibleCapabilities()})
	for _, test := range []struct {
		profile domain.AnalysisProfile
		code    domain.AnalysisFailureCode
	}{
		{domain.AnalysisProfile{}, domain.FailureConfigurationRequired},
		{domain.AnalysisProfile{Harness: domain.HarnessCodex, Model: "missing"}, domain.FailureInvalidProfile},
		{domain.AnalysisProfile{Harness: domain.HarnessCodex, Model: "model-a", Reasoning: domain.ReasoningMax}, domain.FailureInvalidProfile},
	} {
		_, _, _, err := registry.Resolve(context.Background(), test.profile)
		var resolution *ResolutionError
		if !errors.As(err, &resolution) || resolution.Failure.Code != test.code {
			t.Fatalf("profile=%+v error=%v", test.profile, err)
		}
	}
}

func TestRegistryResolvesSupportedCustomModels(t *testing.T) {
	capabilities := eligibleCapabilities()
	capabilities.CustomModel = &domain.ModelCapability{Name: "Custom model", ReasoningLevels: []domain.ReasoningLevel{domain.ReasoningMedium, domain.ReasoningHigh}, DefaultReasoningLevel: domain.ReasoningMedium}
	registry, _ := NewRegistry(fixtureAdapter{id: domain.HarnessClaude, caps: capabilities})
	_, profile, _, err := registry.Resolve(context.Background(), domain.AnalysisProfile{Harness: domain.HarnessClaude, Model: "  claude-fable-5[1m]  "})
	if err != nil || profile.Model != "claude-fable-5[1m]" || profile.Reasoning != domain.ReasoningMedium {
		t.Fatalf("custom profile=%+v err=%v", profile, err)
	}
	for _, model := range []string{"", "-flag", "model with spaces"} {
		reasoning := domain.ReasoningMedium
		if model == "" {
			reasoning = ""
		}
		_, _, _, err := registry.Resolve(context.Background(), domain.AnalysisProfile{Harness: domain.HarnessClaude, Model: model, Reasoning: reasoning})
		if model == "" {
			// Empty means the harness default, not a custom model.
			if err != nil {
				t.Fatalf("default model resolution failed: %v", err)
			}
			continue
		}
		var resolution *ResolutionError
		if !errors.As(err, &resolution) || resolution.Failure.Code != domain.FailureInvalidProfile {
			t.Fatalf("invalid custom model %q error=%v", model, err)
		}
	}
}

func TestRegistryRequiresSchemaReadOnlyAndControlledContext(t *testing.T) {
	for _, mutate := range []func(*domain.HarnessCapabilities){
		func(c *domain.HarnessCapabilities) { c.SupportsJSONSchema = false },
		func(c *domain.HarnessCapabilities) { c.EnforcesReadOnly = false },
		func(c *domain.HarnessCapabilities) { c.SupportsProgress = false },
		func(c *domain.HarnessCapabilities) {
			c.ContextTransports = []domain.ContextTransport{domain.ContextInline}
		},
	} {
		capabilities := eligibleCapabilities()
		mutate(&capabilities)
		registry, _ := NewRegistry(fixtureAdapter{id: domain.HarnessCodex, caps: capabilities})
		_, _, _, err := registry.Resolve(context.Background(), domain.AnalysisProfile{Harness: domain.HarnessCodex})
		var resolution *ResolutionError
		if !errors.As(err, &resolution) || resolution.Failure.Code != domain.FailureUnsupportedCapability {
			t.Fatalf("capabilities=%+v error=%v", capabilities, err)
		}
	}
}

func TestRegistryCapabilitiesAreStableAndSanitizeInspectionErrors(t *testing.T) {
	registry, _ := NewRegistry(
		fixtureAdapter{id: domain.HarnessCodex, caps: eligibleCapabilities()},
		fixtureAdapter{id: domain.HarnessClaude, err: errors.New("provider detail")},
	)
	capabilities := registry.Capabilities(context.Background())
	if len(capabilities) != 2 || capabilities[0].ID != domain.HarnessClaude || capabilities[0].State != domain.HarnessBroken || capabilities[0].Message == "provider detail" || capabilities[1].ID != domain.HarnessCodex {
		t.Fatalf("capabilities=%+v", capabilities)
	}
}

func TestRegistryCapabilitiesPreserveSafeProviderGuidance(t *testing.T) {
	capabilities := eligibleCapabilities()
	capabilities.Message = "Sign in to Codex before using it for analysis"
	registry, _ := NewRegistry(fixtureAdapter{id: domain.HarnessCodex, caps: capabilities, err: errors.New("credential detail")})
	got := registry.Capabilities(context.Background())
	if len(got) != 1 || got[0].Message != capabilities.Message {
		t.Fatalf("capabilities=%+v", got)
	}
}
