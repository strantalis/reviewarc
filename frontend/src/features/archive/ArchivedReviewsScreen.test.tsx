import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ArchiveRetentionSettings, ArchivedReviewsScreen } from './ArchivedReviewsScreen'
import type { ReviewSession } from '../../types'

const archivedSession = {
  id: 'archived-session', archivedAt: '2026-07-01T00:00:00Z', status: 'ready', analysisStatus: 'ready', baseSha: 'base', headSha: 'head', chapters: [], notes: [], comments: [], progress: {total: 0, reviewed: 0, blocked: 0, clarify: 0, percent: 0}, isStale: false, createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z',
  pullRequest: {ref: {repository: {host: 'github.com', owner: 'acme', name: 'api', cloneUrl: '', databaseId: '1'}, number: 4}, title: 'Archive the completed review'},
} as unknown as ReviewSession

describe('archived reviews', () => {
  it('requires an explicit confirmation before deleting an archived review', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    window.go = {main: {App: {ListArchivedSessions: vi.fn().mockResolvedValue([archivedSession]), GetArchiveRetentionDays: vi.fn().mockResolvedValue(30), DeleteArchivedSession: remove, RestoreSession: vi.fn()}}}
    render(<ArchivedReviewsScreen onRestored={vi.fn()}/>)
    expect(await screen.findByText('Archive the completed review')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Delete now'}))
    expect(remove).not.toHaveBeenCalled()
    expect(screen.getByText('Delete saved analysis, notes, drafts, and history?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Confirm delete'}))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('archived-session'))
  })

  it('maps the Never retention choice to the backend zero-day contract', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    window.go = {main: {App: {GetArchiveRetentionDays: vi.fn().mockResolvedValue(30), SetArchiveRetentionDays: save}}}
    render(<ArchiveRetentionSettings/>)
    const select = await screen.findByLabelText('Delete archived reviews after')
    fireEvent.change(select, {target: {value: 'never'}})
    await waitFor(() => expect(save).toHaveBeenCalledWith(0))
  })
})
