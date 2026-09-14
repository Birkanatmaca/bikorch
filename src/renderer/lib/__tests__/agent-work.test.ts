import { describe, expect, it } from 'vitest'
import type { IsolationFoldSession, IsolationLane } from '@shared/contracts/git'
import {
  buildAgentWorkCards,
  fileCountLabel,
  friendlyAgentWorkError,
  groupAgentWork,
  overlapChangedLine,
  setupFailureDetail,
  validationSummary
} from '../agent-work'

function lane(patch: Partial<IsolationLane> & Pick<IsolationLane, 'panelId' | 'title' | 'kind'>): IsolationLane {
  return {
    runId: patch.panelId,
    worktreePath: '/tmp/wt',
    branch: 'bikorch/cursor-a82f',
    files: [],
    summary: [],
    targetBranch: 'develop',
    baseSha: '2af31c',
    isolationPolicy: 'isolated',
    isolationState: 'ready',
    attached: true,
    runStatus: 'running',
    writerLocked: false,
    ...patch
  }
}

function fold(
  patch: Partial<IsolationFoldSession> & Pick<IsolationFoldSession, 'panelId' | 'status'>
): IsolationFoldSession {
  return {
    id: patch.panelId,
    runId: patch.panelId,
    kind: 'cursor',
    title: 'Login system',
    branch: 'bikorch/cursor-a82f',
    agentWorktreePath: '/tmp/wt',
    targetBranch: 'develop',
    baseSha: '2af31c',
    targetSha: '2af31c',
    stale: false,
    files: [],
    conflicts: [],
    ...patch
  }
}

describe('agent work presentation', () => {
  it('hides git jargon in user-facing errors', () => {
    expect(friendlyAgentWorkError('Nothing to accept')).toBe('Nothing to apply.')
    expect(friendlyAgentWorkError('Target develop moved since this review. Sync before accepting.')).toBe(
      'The project changed. Review again, then apply.'
    )
    expect(friendlyAgentWorkError('Fold failed')).toBe('Could not apply these changes.')
  })

  it('groups a busy agent as working and a finished agent as ready with a work summary', () => {
    const cards = buildAgentWorkCards({
      lanes: [
        lane({
          panelId: 'cursor-1',
          kind: 'cursor',
          title: 'Login system',
          files: ['src/auth.ts', 'src/login.tsx', 'src/auth.test.ts'],
          summary: ['Updated authentication flow', 'Added refresh token handling', 'Added login tests']
        }),
        lane({ panelId: 'claude-1', kind: 'claude', title: 'Dashboard refactor' })
      ],
      overlaps: [],
      fold: null,
      sessions: {
        'cursor-1': 'waiting',
        'claude-1': 'busy'
      }
    })
    const groups = groupAgentWork(cards)
    expect(groups.ready[0]?.title).toBe('Login system')
    expect(groups.ready[0]?.summary).toEqual([
      'Updated authentication flow',
      'Added refresh token handling',
      'Added login tests'
    ])
    expect(groups.ready[0]?.detail).toBe(fileCountLabel(3))
    expect(groups.working[0]?.title).toBe('Dashboard refactor')
    expect(groups.working[0]?.statusLabel).toBe('Working…')
  })

  it('treats overlapping files as review recommended, not a merge conflict', () => {
    const cards = buildAgentWorkCards({
      lanes: [
        lane({
          panelId: 'codex-1',
          kind: 'codex',
          title: 'Tests',
          files: ['src/auth.ts']
        }),
        lane({
          panelId: 'claude-1',
          kind: 'claude',
          title: 'Login system',
          files: ['src/auth.ts']
        })
      ],
      overlaps: [
        { path: 'src/auth.ts', panelIds: ['codex-1', 'claude-1'], labels: ['Tests', 'Login system'] }
      ],
      fold: null,
      sessions: {}
    })
    const groups = groupAgentWork(cards)
    expect(groups.attention).toHaveLength(0)
    expect(groups.review).toHaveLength(2)
    expect(groups.review[0]?.statusLabel).toBe('Review recommended')
    expect(groups.review.some((card) => card.detail === 'Both Codex and Claude changed src/auth.ts')).toBe(true)
  })

  it('treats a failed combine as needs attention', () => {
    const cards = buildAgentWorkCards({
      lanes: [
        lane({
          panelId: 'cursor-1',
          kind: 'cursor',
          title: 'Login system',
          files: ['src/auth.ts']
        })
      ],
      overlaps: [],
      fold: fold({
        panelId: 'cursor-1',
        status: 'conflict',
        conflicts: [
          { path: 'src/auth.ts', absolutePath: '/tmp/auth.ts' },
          { path: 'src/session.ts', absolutePath: '/tmp/session.ts' }
        ]
      }),
      sessions: {}
    })
    const attention = groupAgentWork(cards).attention
    expect(attention).toHaveLength(1)
    expect(attention[0]?.statusLabel).toBe('Needs attention')
    expect(attention[0]?.detail).toBe('2 changes could not be combined')
  })

  it('summarizes validation as Tests passed', () => {
    expect(validationSummary({ ranAt: 1, test: { ok: true, summary: 'ok' } })).toBe('Tests passed')
  })

  it('formats setup failures with the command and exit code', () => {
    expect(
      setupFailureDetail({ command: 'pnpm', args: ['install'], output: 'ERR', exitCode: 1 })
    ).toBe('pnpm install exited with code 1')
    expect(overlapChangedLine(['Cursor', 'Claude'], 'auth.ts')).toBe('Both Cursor and Claude changed auth.ts')
  })
})
