import { describe, expect, it } from 'vitest'
import type { PanelDefinition, ProjectWorkspaceState } from '@shared/types'
import { DEFAULT_LAYOUT } from '@shared/types'
import {
  didProcessFinish,
  findPanelProject,
  isWatchedCliPanel,
  processNoticeBody,
  formatElapsed,
  sessionSignal,
  summarizeProjectSessions
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

describe('sessionSignal', () => {
  it('puts a question to the user above everything else', () => {
    expect(sessionSignal({ status: 'busy', asking: true })).toBe('asking')
    expect(sessionSignal({ status: 'waiting', asking: true, unseen: 'done' })).toBe('asking')
    expect(sessionSignal({ status: 'stopped', asking: true })).toBe('off')
  })

  it('reads errors, work, unseen results and rest', () => {
    expect(sessionSignal({ status: 'error' })).toBe('error')
    expect(sessionSignal({ status: 'waiting', unseen: 'error' })).toBe('error')
    expect(sessionSignal({ status: 'busy', unseen: 'done' })).toBe('working')
    expect(sessionSignal({ status: 'waiting', unseen: 'done' })).toBe('done')
    expect(sessionSignal({ status: 'waiting' })).toBe('idle')
    expect(sessionSignal({ status: 'stopped' })).toBe('off')
  })
})

describe('summarizeProjectSessions', () => {
  it('counts each signal and ranks the most urgent first', () => {
    const summary = summarizeProjectSessions({
      panels: [cursorPanel, otherPanel],
      sessions: { 'cli-1': 'busy', 'cli-2': 'waiting' },
      asking: { 'cli-2': true },
      busySince: { 'cli-1': 1_000 },
      attention: []
    })
    expect(summary.top).toBe('asking')
    expect(summary.counts).toMatchObject({ asking: 1, working: 1 })
    expect(summary.rows).toEqual([
      { panelId: 'cli-2', title: 'Claude Code', signal: 'asking' },
      { panelId: 'cli-1', title: 'Cursor CLI', signal: 'working', since: 1_000 }
    ])
  })

  it('keeps a finished session marked until it is seen, and counts Manager notices', () => {
    const summary = summarizeProjectSessions({
      panels: [cursorPanel],
      sessions: { 'cli-1': 'waiting' },
      attention: [
        { panelId: 'cli-1', title: 'Cursor CLI', outcome: 'done', at: 2 },
        { panelId: 'secretary:run-1', title: 'Manager', outcome: 'error', at: 3 }
      ]
    })
    expect(summary.top).toBe('error')
    expect(summary.counts).toMatchObject({ done: 1, error: 1 })
  })

  it('is quiet when nothing is going on', () => {
    expect(summarizeProjectSessions({ panels: [cursorPanel], sessions: { 'cli-1': 'waiting' }, attention: [] }).top).toBeNull()
  })
})

describe('formatElapsed', () => {
  it('reads like a clock a person would say', () => {
    expect(formatElapsed(0, 42_000)).toBe('42s')
    expect(formatElapsed(0, 5 * 60_000)).toBe('5m')
    expect(formatElapsed(0, 125 * 60_000)).toBe('2h 5m')
  })
})

describe('processNoticeBody', () => {
  it('matches the macOS notification body', () => {
    expect(processNoticeBody('done', 'Cursor CLI', 'shop')).toBe('Cursor CLI finished in shop')
    expect(processNoticeBody('error', 'Claude Code', 'shop')).toBe('Claude Code failed in shop')
  })
})

describe('isWatchedCliPanel', () => {
  it('tracks agent CLIs and ignores plain terminals', () => {
    expect(isWatchedCliPanel(cursorPanel)).toBe(true)
    expect(
      isWatchedCliPanel({
        id: 'term-1',
        type: 'terminal',
        title: 'Terminal',
        zone: 'bottom'
      })
    ).toBe(false)
  })
})
