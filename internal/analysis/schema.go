package analysis

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

//go:embed analysis.schema.json
var outputSchema []byte

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
	if raw.SchemaVersion != SchemaVersion {
		return Document{}, fmt.Errorf("unsupported analysis schema version %d", raw.SchemaVersion)
	}
	return Document{raw: raw}, nil
}
