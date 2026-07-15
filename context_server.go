package main

import (
	"context"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"path/filepath"

	"reviewarc/internal/analysiscontext"
	processpkg "reviewarc/internal/process"
)

func runContextServer(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("context-server", flag.ContinueOnError)
	flags.SetOutput(stderr)
	dataRoot := flags.String("data-root", "", "absolute ReviewArc data root")
	bundle := flags.String("bundle", "", "absolute finalized analysis bundle")
	digest := flags.String("digest", "", "expected analysis bundle manifest digest")
	if err := flags.Parse(args); err != nil || flags.NArg() != 0 || !filepath.IsAbs(*dataRoot) || !filepath.IsAbs(*bundle) || len(*digest) != 64 {
		fmt.Fprintln(stderr, "context-server requires --data-root, --bundle, and --digest with no extra arguments")
		return 2
	}
	if _, err := hex.DecodeString(*digest); err != nil {
		fmt.Fprintln(stderr, "context-server requires --data-root, --bundle, and --digest with no extra arguments")
		return 2
	}
	service, err := analysiscontext.Open(*dataRoot, *bundle, *digest, processpkg.NewExecRunner())
	if err != nil {
		fmt.Fprintf(stderr, "context-server initialization failed: %v\n", err)
		return 1
	}
	if err := analysiscontext.Serve(context.Background(), service, stdin, stdout, stderr); err != nil {
		fmt.Fprintf(stderr, "context-server failed: %v\n", err)
		return 1
	}
	return 0
}
