import { describe, expect, it } from 'vitest'
import type { IsolationLane } from '@shared/contracts/git'
import {
  buildAgentWorkCards,
  fileCountLabel,
  friendlyAgentWorkError,
  groupAgentWork,
  validationSummary
} from '../agent-work'

function lane(patch: Partial<IsolationLane> & Pick<IsolationLane, 'panelId' | 'title' | 'kind'>): IsolationLane {
  return {
    runId: patch.panelId,
    worktreePath: '/tmp/wt',
    branch: 'bikorch/cursor-a82f',
    files: [],
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

describe('agent work presentation', () => {
  it('hides git jargon in user-facing errors', () => {
    expect(friendlyAgentWorkError('Nothing to accept')).toBe('Nothing to apply.')
    expect(friendlyAgentWorkError('Target develop moved since this review. Sync before accepting.')).toBe(
      'The project changed. Review again, then apply.'
    )
    expect(friendlyAgentWorkError('Fold failed')).toBe('Could not apply these changes.')
  })

  it('groups a busy agent as working and a finished agent as ready', () => {
    const cards = buildAgentWorkCards({
      lanes: [
        lane({ panelId: 'cursor-1', kind: 'cursor', title: 'Login system', files: ['src/auth.ts'] }),
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
    expect(groups.ready[0]?.detail).toBe(fileCountLabel(1))
    expect(groups.working[0]?.title).toBe('Dashboard refactor')
    expect(groups.working[0]?.statusLabel).toBe('Working…')
  })

  it('treats overlapping files as needs attention without merge language', () => {
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
    const attention = groupAgentWork(cards).attention
    expect(attention).toHaveLength(2)
    expect(attention[0]?.statusLabel).toBe('Needs attention')
    expect(attention.some((card) => card.detail.includes('Also changed by'))).toBe(true)
  })

  it('summarizes validation as Tests passed', () => {
    expect(validationSummary({ ranAt: 1, test: { ok: true, summary: 'ok' } })).toBe('Tests passed')
  })
})
