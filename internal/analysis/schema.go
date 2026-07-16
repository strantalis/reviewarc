package analysis

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"

	"github.com/google/jsonschema-go/jsonschema"
)

//go:embed analysis.schema.json
var outputSchema []byte

var (
	resolvedOutputSchema *jsonschema.Resolved
	errResolveSchema     error
	resolveSchemaOnce    sync.Once
)

const SchemaVersion = 1

type Document struct{ raw rawAnalysis }

func Schema() []byte { return append([]byte(nil), outputSchema...) }

func Decode(data []byte) (Document, error) {
	var raw rawAnalysis
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&raw); err != nil {
		return Document{}, fmt.Errorf("structured output is invalid: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return Document{}, errors.New("structured output contains more than one JSON value")
		}
		return Document{}, fmt.Errorf("structured output has invalid trailing data: %w", err)
	}
	if err := validateAgainstSchema(data); err != nil {
		return Document{}, err
	}
	if raw.SchemaVersion != SchemaVersion {
		return Document{}, fmt.Errorf("unsupported analysis schema version %d", raw.SchemaVersion)
	}
	return Document{raw: raw}, nil
}

func validateAgainstSchema(data []byte) error {
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return fmt.Errorf("structured output is invalid: %w", err)
	}
	resolveSchemaOnce.Do(func() {
		var schema jsonschema.Schema
		if errResolveSchema = json.Unmarshal(outputSchema, &schema); errResolveSchema == nil {
			resolvedOutputSchema, errResolveSchema = schema.Resolve(nil)
		}
	})
	if errResolveSchema != nil {
		return fmt.Errorf("resolve structured-output schema: %w", errResolveSchema)
	}
	if err := resolvedOutputSchema.Validate(value); err != nil {
		return fmt.Errorf("structured output does not match ReviewArc's schema: %w", err)
	}
	return nil
}
