import { describe, expect, it } from 'vitest'
import { chapterStatusLabel, filterInbox, relativeTime } from './lib'
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
    expect(filterInbox(items, 'credentials', 'all', 'all', 'all')).toHaveLength(1)
    expect(filterInbox(items, 'acme/api', 'all', 'all', 'all')).toHaveLength(2)
    expect(filterInbox(items, 'morgan', 'all', 'all', 'all')[0].ref.number).toBe(77)
    expect(filterInbox(items, '42', 'all', 'all', 'all')[0].title).toBe('Rotate credentials')
  })

  it('combines relationship, repository, and analysis filters', () => {
    const authored = pr({relationships: ['authored'], analysisStatus: 'notStarted'})
    expect(filterInbox([pr(), authored], '', 'authored', 'acme/api', 'notStarted')).toEqual([authored])
    expect(filterInbox([pr()], '', 'assigned', 'all', 'all')).toEqual([])
  })
})

describe('display helpers', () => {
  it('formats relative time and all chapter statuses', () => {
    expect(relativeTime('2026-07-11T11:58:00Z', new Date('2026-07-11T12:00:00Z').getTime())).toBe('2m ago')
    expect(chapterStatusLabel('needsClarification')).toBe('Needs clarification')
    expect(chapterStatusLabel('blocked')).toBe('Blocked')
  })
})
