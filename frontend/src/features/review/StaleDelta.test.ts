import { describe, expect, it } from 'vitest'
import type { RevisionDelta, RevisionDeltaFile } from '../../types'
import { revisionDeltaSummary } from './StaleDelta'

const file = (path: string, extras: Partial<RevisionDeltaFile> = {}): RevisionDeltaFile => ({
  file: {path, previousPath: '', status: 'modified', additions: 1, deletions: 0, isBinary: false},
  hasDraftComment: false,
  ...extras,
})

const delta = (files: RevisionDeltaFile[], commitCount = 2): RevisionDelta => ({
  available: true,
  fromHeadSha: 'a'.repeat(40),
  toHeadSha: 'b'.repeat(40),
  baseChanged: false,
  commitCount,
  commits: [],
  files,
})

describe('revisionDeltaSummary', () => {
  it('reports a rebase-only delta without file changes', () => {
    expect(revisionDeltaSummary(delta([], 1))).toBe('1 commit · no file content changed')
  })

  it('counts changed files without review annotations', () => {
    expect(revisionDeltaSummary(delta([file('a.go'), file('b.go')]))).toBe('2 commits · 2 files changed')
  })

  it('counts files cited by findings or carrying drafts once each', () => {
    const files = [
      file('cited.go', {citedByFindings: ['Retry exhaustion can drop webhooks']}),
      file('both.go', {citedByFindings: ['Idempotency coverage is unclear'], hasDraftComment: true}),
      file('draft.go', {hasDraftComment: true}),
      file('plain.go'),
    ]
    expect(revisionDeltaSummary(delta(files))).toBe('2 commits · 4 files changed · 3 tied to your review')
  })
})
