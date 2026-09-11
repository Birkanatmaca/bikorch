import { describe, expect, it } from 'vitest'
import type { PanelDefinition, ProjectWorkspaceState } from '@shared/types'
import { DEFAULT_LAYOUT } from '@shared/types'
import {
  didProcessFinish,
  findPanelProject,
  processNoticeBody,
  summarizeProjectTabActivity
} from '../project-activity'

const cursorPanel: PanelDefinition = {
  id: 'cli-1',
  type: 'cursor',
  title: 'Cursor CLI',
  zone: 'center'
}

const otherPanel: PanelDefinition = {
  id: 'cli-2',
  type: 'claude',
  title: 'Claude Code',
  zone: 'center'
}

describe('didProcessFinish', () => {
  it('treats busy → waiting as finished work', () => {
    expect(didProcessFinish('busy', 'waiting')).toBe('done')
    expect(didProcessFinish('busy', 'stopped')).toBe('done')
    expect(didProcessFinish('busy', 'error')).toBe('error')
  })

  it('ignores boot and idle transitions', () => {
    expect(didProcessFinish('starting', 'waiting')).toBeNull()
    expect(didProcessFinish('waiting', 'busy')).toBeNull()
    expect(didProcessFinish(undefined, 'waiting')).toBeNull()
    expect(didProcessFinish('busy', 'busy')).toBeNull()
  })
})

describe('findPanelProject', () => {
  it('returns the workspace that owns the session', () => {
    const workspaces: Record<string, ProjectWorkspaceState> = {
      a: { projectId: 'a', panels: [cursorPanel], layout: { ...DEFAULT_LAYOUT } },
      b: { projectId: 'b', panels: [otherPanel], layout: { ...DEFAULT_LAYOUT } }
    }
    expect(findPanelProject('cli-2', workspaces)).toEqual({ projectId: 'b', panel: otherPanel })
  })
})

describe('summarizeProjectTabActivity', () => {
  it('shows working when any CLI is busy', () => {
    expect(
      summarizeProjectTabActivity({
        panels: [cursorPanel, otherPanel],
        sessions: { 'cli-1': 'busy', 'cli-2': 'waiting' },
        attention: [{ panelId: 'cli-2', title: 'Claude Code', outcome: 'done', at: 1 }]
      })
    ).toMatchObject({ signal: 'busy', busyCount: 1, label: 'Cursor CLI working' })
  })

  it('counts multiple busy agents', () => {
    expect(
      summarizeProjectTabActivity({
        panels: [cursorPanel, otherPanel],
        sessions: { 'cli-1': 'busy', 'cli-2': 'starting' },
        attention: []
      })
    ).toMatchObject({ signal: 'busy', busyCount: 2, label: '2 agents working' })
  })

  it('pings the tab after background work finishes', () => {
    expect(
      summarizeProjectTabActivity({
        panels: [cursorPanel],
        sessions: { 'cli-1': 'waiting' },
        attention: [{ panelId: 'cli-1', title: 'Cursor CLI', outcome: 'done', at: 2 }]
      })
    ).toMatchObject({
      signal: 'ready',
      label: 'Cursor CLI finished — open to review'
    })
  })

  it('prefers an error ping when the finished run failed', () => {
    expect(
      summarizeProjectTabActivity({
        panels: [cursorPanel],
        sessions: { 'cli-1': 'error' },
        attention: [{ panelId: 'cli-1', title: 'Cursor CLI', outcome: 'error', at: 2 }]
      })
    ).toMatchObject({
      signal: 'error',
      label: 'Cursor CLI failed — open to review'
    })
  })
})

describe('processNoticeBody', () => {
  it('names the project so the toast can send you back', () => {
    expect(processNoticeBody('done', 'Cursor CLI', 'shop')).toBe('Cursor CLI finished in shop')
    expect(processNoticeBody('error', 'Claude Code', 'shop')).toBe('Claude Code failed in shop')
  })
})
