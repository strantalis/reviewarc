import { describe, expect, it } from 'vitest'
import type { CheckRun, EvidenceReference, ReviewAnalysis, ReviewJudgment, ReviewRisk } from '../../types'
import { buildAgentReviewBrief, reviewGate } from './decision'

const check = (id: number, name: string, status: string, conclusion = ''): CheckRun => ({
  id,
  name,
  status,
  conclusion,
  appName: 'GitHub Actions',
  url: `https://github.com/acme/api/actions/runs/${id}`,
  detailsUrl: '',
  startedAt: '',
  completedAt: '',
})

describe('reviewGate', () => {
  it('allows repositories that report no checks', () => {
    expect(reviewGate([])).toMatchObject({status: 'unknown', passing: [], waiting: [], failing: []})
  })

  it('treats success, neutral, and skipped conclusions as complete', () => {
    const gate = reviewGate([check(1, 'test', 'completed', 'success'), check(2, 'docs', 'completed', 'neutral'), check(3, 'preview', 'completed', 'skipped')])
    expect(gate.status).toBe('clear')
    expect(gate.passing).toHaveLength(3)
  })

  it('waits for unfinished or cancelled checks', () => {
    const gate = reviewGate([check(1, 'test', 'in_progress'), check(2, 'lint', 'completed', 'cancelled')])
    expect(gate.status).toBe('waiting')
    expect(gate.waiting.map((item) => item.name)).toEqual(['test', 'lint'])
  })

  it('lets a failing check take precedence over pending work', () => {
    const gate = reviewGate([check(1, 'test', 'in_progress'), check(2, 'lint', 'completed', 'timed_out')])
    expect(gate.status).toBe('blocked')
    expect(gate.failing.map((item) => item.name)).toEqual(['lint'])
  })
})

const evidence = (id: string, path: string, startLine = 10, endLine = 20): EvidenceReference => ({
  id,
  path,
  revision: 'head',
  startLine,
  endLine,
  symbol: 'Limiter.Allow',
  validationStatus: 'valid',
  validationMessage: '',
})

function analysisWithRisks(risks: ReviewRisk[], chapterRisks: ReviewRisk[] = [], judgments?: ReviewJudgment[]): ReviewAnalysis {
  return {
    schemaVersion: 1,
    baseSha: 'base',
    headSha: 'head',
    summary: 'Adds recorder callbacks.',
    summaryEvidence: [],
    summaryValidation: 'valid',
    affectedAreas: [],
    behavioralChanges: [],
    risks,
    facts: [],
    inferences: [],
    unknowns: [],
    judgments,
    createdAt: '',
    validationIssues: [],
    chapters: [{
      id: 'runtime',
      order: 1,
      title: 'Runtime behavior',
      description: '',
      purpose: 'Review callback execution.',
      status: 'notReviewed',
      evidence: [],
      files: [],
      symbols: [],
      behavioralChanges: [],
      risks: chapterRisks,
      facts: [],
      inferences: [],
      unknowns: [],
      relatedTests: [],
      suggestedQuestions: [],
    }],
  }
}

describe('buildAgentReviewBrief judgments', () => {
  it('uses an explicit model judgment to group related observations', () => {
    const location = evidence('lock', 'quota/limiter.go', 39, 62)
    const brief = buildAgentReviewBrief(analysisWithRisks([
      {id: 'global-lock', title: 'External callback is inside the global limiter lock', description: 'Every Allow call uses the same mutex, and the callback runs before deferred unlock. Slow or re-entrant recorder implementations can therefore cause contention or deadlock.', level: 'high', evidence: [location]},
    ], [
      {id: 'callback-lock', title: 'Caller-provided recording executes under the limiter mutex', description: 'A slow Recorder.Record implementation can extend the critical section and serialize Allow calls. A recorder that synchronously re-enters the same Limiter can deadlock because sync.Mutex is non-reentrant.', level: 'high', evidence: [{...location, id: 'callback'}]},
    ], [{
      id: 'limiter-callback-lock',
      title: 'Recorder callbacks execute inside the limiter lock',
      description: 'The callback extends the critical section and can deadlock when it re-enters the limiter.',
      kind: 'risk',
      level: 'high',
      groupingRationale: 'Both observations are caused by the callback executing before the same mutex is released and are resolved by changing that lock scope.',
      observations: [
        {id: 'global-lock', title: 'External callback is inside the global limiter lock', description: 'Every Allow call uses the same mutex.', evidence: [location]},
        {id: 'callback-lock', title: 'Caller-provided recording executes under the limiter mutex', description: 'A re-entrant recorder can deadlock.', evidence: [{...location, id: 'callback'}]},
      ],
    }]))

    expect(brief.findings).toHaveLength(1)
    expect(brief.findings[0].title).toBe('Recorder callbacks execute inside the limiter lock')
    expect(brief.findings[0].observations.map((observation) => observation.title)).toEqual([
      'External callback is inside the global limiter lock',
      'Caller-provided recording executes under the limiter mutex',
    ])
    expect(brief.findings[0].evidence).toHaveLength(1)
  })

  it('keeps same-titled risks in separate code paths as separate judgments', () => {
    const brief = buildAgentReviewBrief(analysisWithRisks([
      {id: 'admin-auth', title: 'Missing authorization check', description: 'An administrator route does not verify the caller.', level: 'high', evidence: [evidence('admin', 'api/admin.ts')]},
      {id: 'billing-auth', title: 'Missing authorization check', description: 'A billing route does not verify the caller.', level: 'high', evidence: [evidence('billing', 'api/billing.ts')]},
    ]))

    expect(brief.findings).toHaveLength(2)
    expect(brief.findings.every((finding) => finding.observations.length === 1)).toBe(true)
  })

  it('does not infer a grouping from similar text and overlapping evidence', () => {
    const testLocation = evidence('test', 'quota/limiter_test.go', 33, 49)
    const brief = buildAgentReviewBrief(analysisWithRisks([
      {id: 'global-coverage', title: 'The stated concurrency focus lacks corresponding supplied coverage', description: 'The only added recorder test is sequential and does not establish concurrent behavior.', level: 'medium', evidence: [testLocation]},
    ], [
      {id: 'callback-coverage', title: 'Concurrent callback behavior is not covered by the added test', description: 'The added test invokes Allow sequentially and verifies only basic decision values; it does not exercise concurrent traffic, slow callbacks, re-entry, or concurrent recorder configuration.', level: 'medium', evidence: [{...testLocation, id: 'chapter-test'}]},
    ]))

    expect(brief.findings).toHaveLength(2)
    expect(brief.findings.every((finding) => finding.observations.length === 1)).toBe(true)
  })
})
