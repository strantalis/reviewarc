package git

import (
	"bytes"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"reviewarc/internal/domain"
)

func parseNameStatus(data []byte) ([]domain.ChangedFile, error) {
	parts := bytes.Split(data, []byte{0})
	if len(parts) > 0 && len(parts[len(parts)-1]) == 0 {
		parts = parts[:len(parts)-1]
	}
	files := make([]domain.ChangedFile, 0)
	i := 0
	for i < len(parts) {
		status := string(parts[i])
		i++
		if status == "" || i >= len(parts) {
			return nil, errors.New("malformed git name-status output")
		}
		code := status[0]
		file := domain.ChangedFile{}
		switch code {
		case 'A':
			file.Status = domain.FileAdded
		case 'M', 'T':
			file.Status = domain.FileModified
		case 'D':
			file.Status = domain.FileDeleted
		case 'R':
			file.Status = domain.FileRenamed
		case 'C':
			file.Status = domain.FileCopied
		default:
			return nil, fmt.Errorf("unsupported git file status %q", status)
		}
		if code == 'R' || code == 'C' {
			if i+1 >= len(parts) {
				return nil, errors.New("malformed rename output")
			}
			file.PreviousPath = string(parts[i])
			file.Path = string(parts[i+1])
			i += 2
		} else {
			file.Path = string(parts[i])
			i++
		}
		if ValidatePath(file.Path) != nil || (file.PreviousPath != "" && ValidatePath(file.PreviousPath) != nil) {
			return nil, ErrUnsafePath
		}
		files = append(files, file)
	}
	return files, nil
}

type fileStat struct {
	additions, deletions int
	binary               bool
}

func parseNumstat(data []byte) (map[string]fileStat, error) {
	parts := bytes.Split(data, []byte{0})
	if len(parts) > 0 && len(parts[len(parts)-1]) == 0 {
		parts = parts[:len(parts)-1]
	}
	out := map[string]fileStat{}
	for i := 0; i < len(parts); i++ {
		fields := strings.Split(string(parts[i]), "\t")
		if len(fields) != 3 {
			return nil, errors.New("malformed git numstat output")
		}
		pathName := fields[2]
		if pathName == "" {
			if i+2 >= len(parts) {
				return nil, errors.New("malformed rename numstat output")
			}
			i += 2
			pathName = string(parts[i])
		}
		if ValidatePath(pathName) != nil {
			return nil, ErrUnsafePath
		}
		s := fileStat{}
		if fields[0] == "-" || fields[1] == "-" {
			s.binary = true
		} else {
			var err error
			s.additions, err = strconv.Atoi(fields[0])
			if err != nil {
				return nil, err
			}
			s.deletions, err = strconv.Atoi(fields[1])
			if err != nil {
				return nil, err
			}
		}
		out[pathName] = s
	}
	return out, nil
}
