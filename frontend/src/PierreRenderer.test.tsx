import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffFile } from './types'

const {patchDiff} = vi.hoisted(() => ({patchDiff: vi.fn()}))

vi.mock('@pierre/diffs/react', () => ({
  PatchDiff: (props: unknown) => {
    patchDiff(props)
    return <div data-testid="patch-diff"/>
  },
}))

import { MAX_RENDERABLE_PATCH_CHARACTERS, PierreDiffRenderer } from './PierreRenderer'

const diff = (patch: string): DiffFile => ({
  file: {path: 'generated/output.ts', previousPath: '', status: 'modified', additions: 1, deletions: 1, isBinary: false},
  hunks: [],
  patch,
})

describe('PierreDiffRenderer size boundary', () => {
  beforeEach(() => patchDiff.mockClear())

  it('does not pass oversized patches to the interactive renderer', () => {
    render(<PierreDiffRenderer diff={diff('x'.repeat(MAX_RENDERABLE_PATCH_CHARACTERS + 1))} comments={[]} layout="unified" onCommentRange={vi.fn()}/>)

    expect(screen.getByRole('alert')).toHaveTextContent('Diff too large to display')
    expect(screen.getByText(/512K-character interactive rendering limit/)).toBeInTheDocument()
    expect(patchDiff).not.toHaveBeenCalled()
  })

  it('keeps patches at the boundary renderable', () => {
    render(<PierreDiffRenderer diff={diff('x'.repeat(MAX_RENDERABLE_PATCH_CHARACTERS))} comments={[]} layout="unified" onCommentRange={vi.fn()}/>)

    expect(screen.getByTestId('patch-diff')).toBeInTheDocument()
    expect(patchDiff).toHaveBeenCalledOnce()
  })
})
