package agent

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"reviewarc/internal/domain"
)

type Registry struct {
	adapters map[domain.HarnessID]HarnessAdapter
}

type ResolutionError struct{ Failure domain.AnalysisFailure }

func (e *ResolutionError) Error() string { return e.Failure.Message }

func NewRegistry(adapters ...HarnessAdapter) (*Registry, error) {
	registry := &Registry{adapters: make(map[domain.HarnessID]HarnessAdapter, len(adapters))}
	for _, adapter := range adapters {
		if adapter == nil || adapter.ID() == "" {
			return nil, errors.New("agent registry: adapter ID is required")
		}
		if _, exists := registry.adapters[adapter.ID()]; exists {
			return nil, fmt.Errorf("agent registry: duplicate adapter %q", adapter.ID())
		}
		registry.adapters[adapter.ID()] = adapter
	}
	return registry, nil
}

func (r *Registry) Capabilities(ctx context.Context) []domain.HarnessCapabilities {
	ids := make([]string, 0, len(r.adapters))
	for id := range r.adapters {
		ids = append(ids, string(id))
	}
	sort.Strings(ids)
	result := make([]domain.HarnessCapabilities, 0, len(ids))
	for _, rawID := range ids {
		id := domain.HarnessID(rawID)
		capabilities, err := r.adapters[id].Capabilities(ctx)
		capabilities.ID = id
		if err != nil {
			if capabilities.State == "" {
				capabilities.State = domain.HarnessBroken
			}
			capabilities.Message = "ReviewArc could not inspect this harness"
		}
		if capabilities.Models == nil {
			capabilities.Models = []domain.ModelCapability{}
		}
		if capabilities.ContextTransports == nil {
			capabilities.ContextTransports = []domain.ContextTransport{}
		}
		result = append(result, capabilities)
	}
	return result
}

func (r *Registry) Resolve(ctx context.Context, profile domain.AnalysisProfile) (HarnessAdapter, domain.AnalysisProfile, domain.HarnessCapabilities, error) {
	if profile.Harness == "" {
		return nil, profile, domain.HarnessCapabilities{}, resolutionFailure(domain.FailureConfigurationRequired, "AI analysis is not configured", "Choose an installed analysis harness before starting the first analysis.", domain.RetryConfigure)
	}
	adapter := r.adapters[profile.Harness]
	if adapter == nil {
		return nil, profile, domain.HarnessCapabilities{}, resolutionFailure(domain.FailureHarnessUnavailable, "Analysis harness is unavailable", "The configured analysis harness is not installed or supported by this version of ReviewArc.", domain.RetryConfigure)
	}
	capabilities, err := adapter.Capabilities(ctx)
	capabilities.ID = profile.Harness
	if err != nil || capabilities.State == domain.HarnessMissing || capabilities.State == domain.HarnessBroken {
		return nil, profile, capabilities, resolutionFailure(domain.FailureHarnessUnavailable, "Analysis harness is unavailable", "ReviewArc could not start the configured analysis harness.", domain.RetryConfigure)
	}
	if capabilities.State == domain.HarnessUnsupported {
		return nil, profile, capabilities, resolutionFailure(domain.FailureUnsupportedCapability, "Analysis harness is unsupported", "Update the harness to a version that supports ReviewArc's structured, read-only analysis contract.", domain.RetryConfigure)
	}
	if !capabilities.SupportsJSONSchema || !capabilities.EnforcesReadOnly || !capabilities.SupportsProgress || !hasControlledTransport(capabilities.ContextTransports) {
		return nil, profile, capabilities, resolutionFailure(domain.FailureUnsupportedCapability, "Analysis harness is incompatible", "This harness cannot enforce ReviewArc's structured, controlled read-only analysis contract.", domain.RetryConfigure)
	}
	model, ok := resolveModel(capabilities, strings.TrimSpace(profile.Model))
	if !ok {
		return nil, profile, capabilities, resolutionFailure(domain.FailureInvalidProfile, "Analysis model is unavailable", "Choose a model currently supported by the configured harness.", domain.RetryChangeProfile)
	}
	profile.Model = model.ID
	if profile.Reasoning == "" {
		profile.Reasoning = model.DefaultReasoningLevel
		if profile.Reasoning == "" && len(model.ReasoningLevels) > 0 {
			profile.Reasoning = model.ReasoningLevels[0]
		}
	}
	if !supportsReasoning(model, profile.Reasoning) {
		return nil, profile, capabilities, resolutionFailure(domain.FailureInvalidProfile, "Reasoning level is unavailable", "Choose a reasoning level supported by the selected model.", domain.RetryChangeProfile)
	}
	return adapter, profile, capabilities, nil
}

func resolveModel(capabilities domain.HarnessCapabilities, selected string) (domain.ModelCapability, bool) {
	if selected == "" {
		selected = capabilities.DefaultModel
	}
	if selected == "" {
		for _, model := range capabilities.Models {
			if model.Recommended {
				selected = model.ID
				break
			}
		}
	}
	if selected == "" && len(capabilities.Models) > 0 {
		selected = capabilities.Models[0].ID
	}
	for _, model := range capabilities.Models {
		if model.ID == selected {
			return model, true
		}
	}
	return domain.ModelCapability{}, false
}

func supportsReasoning(model domain.ModelCapability, selected domain.ReasoningLevel) bool {
	if len(model.ReasoningLevels) == 0 {
		return selected == ""
	}
	for _, level := range model.ReasoningLevels {
		if level == selected {
			return true
		}
	}
	return false
}

func hasControlledTransport(transports []domain.ContextTransport) bool {
	for _, transport := range transports {
		if transport == domain.ContextArtifactFiles || transport == domain.ContextReviewArcTools {
			return true
		}
	}
	return false
}

func resolutionFailure(code domain.AnalysisFailureCode, title, message string, action domain.AnalysisRetryAction) error {
	return &ResolutionError{Failure: domain.AnalysisFailure{Code: code, Title: title, Message: message, Action: action, Retryable: action == domain.RetrySamePlan || action == domain.RetryReplan}}
}
