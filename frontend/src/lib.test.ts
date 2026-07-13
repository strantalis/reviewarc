import { describe, expect, it } from 'vitest'
import { chapterStatusLabel, filterInbox, primaryRelationship, relativeTime } from './lib'
import type { PullRequestSummary } from './types'

function pr(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    ref: {repository: {host: 'github.com', owner: 'acme', name: 'api', cloneUrl: '', databaseId: ''}, number: 42},
    title: 'Rotate credentials', url: '', author: {login: 'jamie', name: '', avatarUrl: ''}, updatedAt: '2026-07-11T12:00:00Z',
    isDraft: false, additions: 12, deletions: 3, changedFiles: 2, relationships: ['reviewRequested'], labels: [],
    analysisStatus: 'ready', progress: {total: 2, reviewed: 1, blocked: 0, clarify: 0, percent: 50}, riskLevel: 'high', ...overrides,
  }
}

describe('inbox behavior', () => {
  it('searches title, repository, author, and number', () => {
    const items = [pr(), pr({ref: {...pr().ref, number: 77}, title: 'Billing retry', author: {login: 'morgan', name: '', avatarUrl: ''}})]
    expect(filterInbox(items, 'credentials', 'all', 'all', 'all', 'all')).toHaveLength(1)
    expect(filterInbox(items, 'acme/api', 'all', 'all', 'all', 'all')).toHaveLength(2)
    expect(filterInbox(items, 'morgan', 'all', 'all', 'all', 'all')[0].ref.number).toBe(77)
    expect(filterInbox(items, '42', 'all', 'all', 'all', 'all')[0].title).toBe('Rotate credentials')
  })

  it('combines relationship, repository, and analysis filters', () => {
    const authored = pr({relationships: ['authored'], analysisStatus: 'notStarted'})
    expect(filterInbox([pr(), authored], '', 'authored', 'acme/api', 'all', 'notStarted')).toEqual([authored])
    expect(filterInbox([pr()], '', 'assigned', 'all', 'all', 'all')).toEqual([])
  })

  it('searches and filters by GitHub label', () => {
    const security = pr({labels: ['security', 'backend']})
    const docs = pr({ref: {...pr().ref, number: 77}, labels: ['Documentation']})
    expect(filterInbox([security, docs], 'backend', 'all', 'all', 'all', 'all')).toEqual([security])
    expect(filterInbox([security, docs], '', 'all', 'all', 'documentation', 'all')).toEqual([docs])
  })

  it('prioritizes actionable relationships over selected repository', () => {
    expect(primaryRelationship(['selectedRepo', 'authored', 'assigned', 'reviewRequested'])).toBe('reviewRequested')
    expect(primaryRelationship(['selectedRepo', 'authored', 'assigned'])).toBe('assigned')
    expect(primaryRelationship(['selectedRepo', 'authored'])).toBe('authored')
    expect(primaryRelationship(['selectedRepo'])).toBe('selectedRepo')
  })
})

describe('display helpers', () => {
  it('formats relative time and all chapter statuses', () => {
    expect(relativeTime('2026-07-11T11:58:00Z', new Date('2026-07-11T12:00:00Z').getTime())).toBe('2m ago')
    expect(chapterStatusLabel('needsClarification')).toBe('Needs clarification')
    expect(chapterStatusLabel('blocked')).toBe('Blocked')
  })
})
