package analysisbundle

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"reviewarc/internal/domain"
	gitcache "reviewarc/internal/git"
)

type Bundle struct {
	Path     string
	Manifest Manifest
}

func Open(dataRoot, bundlePath, expectedDigest string) (*Bundle, error) {
	root, err := filepath.Abs(BundleRoot(dataRoot))
	if err != nil {
		return nil, errors.New("resolve analysis bundle root")
	}
	path, err := filepath.Abs(bundlePath)
	if err != nil || filepath.Dir(path) != root || !strings.HasPrefix(filepath.Base(path), "bundle-") {
		return nil, errors.New("analysis bundle is outside the private bundle root")
	}
	if !validDigest(expectedDigest) {
		return nil, errors.New("analysis bundle digest is invalid")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0o022 != 0 {
		return nil, errors.New("analysis bundle directory is unavailable or writable by other users")
	}
	manifestPath := filepath.Join(path, manifestName)
	data, err := readRegularFile(manifestPath, maxManifestSize)
	if err != nil {
		return nil, fmt.Errorf("read analysis bundle manifest: %w", err)
	}
	if hashBytes(data) != strings.ToLower(expectedDigest) {
		return nil, errors.New("analysis bundle manifest digest does not match")
	}
	var manifest Manifest
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return nil, fmt.Errorf("decode analysis bundle manifest: %w", err)
	}
	if err := validateManifest(manifest); err != nil {
		return nil, err
	}
	if err := verifyBundleLayout(path, manifest); err != nil {
		return nil, err
	}
	for _, artifact := range append([]Artifact{manifest.Metadata, manifest.Discussion}, diffArtifacts(manifest.Changes)...) {
		if err := verifyArtifact(path, artifact); err != nil {
			return nil, err
		}
	}
	return &Bundle{Path: path, Manifest: manifest}, nil
}

func (b *Bundle) ReadArtifact(artifact Artifact) ([]byte, error) {
	if err := verifyArtifact(b.Path, artifact); err != nil {
		return nil, err
	}
	return readRegularFile(filepath.Join(b.Path, filepath.FromSlash(artifact.Path)), int(artifact.Bytes)+1)
}

func (b *Bundle) Change(id string) (Change, bool) {
	for _, change := range b.Manifest.Changes {
		if change.ID == id {
			return change, true
		}
	}
	return Change{}, false
}

func validateManifest(m Manifest) error {
	if m.Version != ManifestVersion || len(m.BundleID) != 32 || !validHex(m.BundleID) || m.CreatedAt.IsZero() {
		return errors.New("unsupported or invalid analysis bundle manifest")
	}
	if !strings.EqualFold(m.Repository.Host, "github.com") || !validName(m.Repository.Owner, 39, false) || !validName(m.Repository.Name, 100, true) || m.Repository.PullRequest < 1 {
		return errors.New("invalid analysis bundle repository identity")
	}
	if !validSHA(m.Revisions.Base) || !validSHA(m.Revisions.Head) || !validSHA(m.Revisions.MergeBase) || strings.EqualFold(m.Revisions.Base, m.Revisions.Head) {
		return errors.New("invalid analysis bundle revisions")
	}
	if err := validateLimits(m.Limits); err != nil {
		return err
	}
	if m.Metadata.Path != metadataName || m.Discussion.Path != discussionName {
		return errors.New("invalid analysis bundle metadata paths")
	}
	if err := validateArtifactPageMetadata(m.Metadata, m.Limits.PageBytes); err != nil {
		return err
	}
	if err := validateArtifactPageMetadata(m.Discussion, m.Limits.PageBytes); err != nil {
		return err
	}
	seenIDs, seenPaths := map[string]bool{}, map[string]bool{}
	for index, change := range m.Changes {
		expectedID := fmt.Sprintf("f%06d", index+1)
		expectedPath := filepath.ToSlash(filepath.Join("diffs", expectedID+".patch"))
		if change.ID != expectedID || change.Diff.Path != expectedPath || seenIDs[change.ID] || seenPaths[change.Path] || gitcache.ValidatePath(change.Path) != nil || (change.PreviousPath != "" && gitcache.ValidatePath(change.PreviousPath) != nil) || change.Additions < 0 || change.Deletions < 0 || !validStatus(change.Status) {
			return errors.New("invalid analysis bundle change entry")
		}
		if len(change.Preview) > diffPreviewBytes || (change.Binary && change.Preview != "") || (!change.Binary && change.Diff.Bytes > 0 && change.Preview == "") {
			return errors.New("invalid analysis bundle diff preview")
		}
		if err := validateArtifactPageMetadata(change.Diff, m.Limits.PageBytes); err != nil {
			return err
		}
		seenIDs[change.ID], seenPaths[change.Path] = true, true
	}
	return nil
}

func validateArtifactPageMetadata(artifact Artifact, pageBytes int) error {
	if artifact.Bytes < 0 || artifact.Lines < 0 || artifact.Pages < 0 {
		return errors.New("invalid analysis artifact counters")
	}
	wantPages := 0
	if artifact.Bytes > 0 {
		wantPages = (int(artifact.Bytes) + pageBytes - 1) / pageBytes
	}
	if artifact.Pages != wantPages {
		return errors.New("invalid analysis artifact page count")
	}
	return nil
}

func validStatus(status domain.FileStatus) bool {
	switch status {
	case domain.FileAdded, domain.FileModified, domain.FileDeleted, domain.FileRenamed, domain.FileCopied, domain.FileBinary:
		return true
	default:
		return false
	}
}

func verifyBundleLayout(root string, manifest Manifest) error {
	expected := map[string]bool{
		".":            true,
		manifestName:   true,
		metadataName:   true,
		discussionName: true,
		"diffs":        true,
		"run":          true,
	}
	for _, change := range manifest.Changes {
		expected[change.Diff.Path] = true
	}
	return filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if !expected[rel] || entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("unexpected or unsafe analysis bundle entry %q", rel)
		}
		info, err := entry.Info()
		if err != nil || info.Mode().Perm()&0o022 != 0 {
			return fmt.Errorf("analysis bundle entry %q is unavailable or writable by other users", rel)
		}
		if entry.IsDir() != (rel == "." || rel == "diffs" || rel == "run") {
			return fmt.Errorf("analysis bundle entry %q has the wrong type", rel)
		}
		return nil
	})
}

func diffArtifacts(changes []Change) []Artifact {
	result := make([]Artifact, 0, len(changes))
	for _, change := range changes {
		result = append(result, change.Diff)
	}
	return result
}

func verifyArtifact(root string, artifact Artifact) error {
	if artifact.Bytes < 0 || artifact.Bytes > 64<<20 || !validDigest(artifact.SHA256) || filepath.ToSlash(filepath.Clean(artifact.Path)) != artifact.Path {
		return errors.New("invalid analysis artifact metadata")
	}
	path := filepath.Join(root, filepath.FromSlash(artifact.Path))
	if !contained(root, path) {
		return errors.New("analysis artifact escapes bundle")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o022 != 0 || info.Size() != artifact.Bytes {
		return fmt.Errorf("analysis artifact %q is unavailable or changed", artifact.Path)
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	h := sha256.New()
	if _, err := io.Copy(h, io.LimitReader(file, artifact.Bytes+1)); err != nil {
		return err
	}
	if hex.EncodeToString(h.Sum(nil)) != artifact.SHA256 {
		return fmt.Errorf("analysis artifact %q digest does not match", artifact.Path)
	}
	return nil
}

func readRegularFile(path string, limit int) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() >= int64(limit) {
		return nil, errors.New("file is unavailable, unsafe, or exceeds its limit")
	}
	return os.ReadFile(path)
}

func validDigest(value string) bool {
	if len(value) != 64 {
		return false
	}
	return validHex(value)
}

func validHex(value string) bool {
	_, err := hex.DecodeString(value)
	return err == nil
}
