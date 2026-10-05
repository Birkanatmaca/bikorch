import { describe, expect, it } from 'vitest'
import type { PanelDefinition } from '@shared/types'
import type { PtySessionStatus } from '@shared/contracts/pty'
import { fingerprint, managerFailureSignals } from '../manager-watch'

const panel: PanelDefinition = { id: 'cli-1', type: 'codex', title: 'Project agent', zone: 'center' }

function signals(output: string, status: PtySessionStatus = 'waiting', error?: string) {
  return managerFailureSignals([panel], { [panel.id]: status }, { [panel.id]: error }, { [panel.id]: output })
}

describe('Manager failure signals', () => {
  it.each([
    'TypeError: Cannot read properties of undefined (reading "name")',
    'src/app.ts(12,4): error TS2322: Type string is not assignable to number.',
    'Error: Cannot find module ./app',
    'fatal: not a git repository',
    'zsh: command not found: missing-command',
    'connect ECONNREFUSED 127.0.0.1:3000',
    'Build failed with 2 errors',
    'Traceback (most recent call last):\n  File "app.py", line 3\nValueError: invalid literal',
    'npm ERR! code ERESOLVE\nnpm ERR! unable to resolve dependency tree',
    ' FAIL  src/app.test.ts > submits form',
    'Tests  1 failed | 12 passed (13)',
    'FAILED tests/test_app.py::test_save - AssertionError: expected saved item'
  ])('recognizes a real diagnostic: %s', (output) => {
    expect(signals(output)).toHaveLength(1)
  })

  it.each([
    'No errors found.',
    '0 errors, 0 failed',
    'Errors: 0',
    '✓ handles TypeError when the server is unavailable',
    'Add a test for ReferenceError and SyntaxError.',
    'Read the TypeError documentation before continuing.',
    'The old compiler diagnostic was TS2322.',
    'All tests passed. Build completed successfully.'
  ])('ignores non-failure text: %s', (output) => {
    expect(signals(output)).toEqual([])
  })

  it('does not discard a real test failure because the same line says no compiler errors', () => {
    expect(signals('0 errors, 1 test failed')).toHaveLength(1)
  })

  it('ignores an old diagnostic after an explicit successful test run', () => {
    expect(signals('TypeError: old failure\nTests  4 passed (4)\n')).toEqual([])
  })

  it('still detects a new failure after an earlier success', () => {
    expect(signals('Tests  4 passed (4)\nTypeError: new failure\n')).toHaveLength(1)
  })

  it('recognizes the same error again after a successful recovery with the original diagnostic identity', () => {
    expect(signals('TypeError: repeat failure\nTests  4 passed (4)\nTypeError: repeat failure\n'))
      .toEqual(signals('TypeError: repeat failure\n'))
  })

  it('reports a failed session even when no output diagnostic was captured', () => {
    expect(signals('', 'error', 'Authentication required')).toEqual([
      { key: `cli-1:${fingerprint('Authentication required')}`, title: 'Project agent' }
    ])
    expect(signals('', 'error')).toHaveLength(1)
  })

  it.each(['starting', 'busy'] as const)('waits for %s sessions to finish emitting output', (status) => {
    expect(signals('TypeError: failure', status)).toEqual([])
  })

  it('ignores panels without a session and surfaces unrelated to terminals', () => {
    const browser: PanelDefinition = { id: 'browser', type: 'browser', title: 'Preview', zone: 'center' }
    expect(managerFailureSignals([panel], {}, {}, { [panel.id]: 'TypeError: failure' })).toEqual([])
    expect(managerFailureSignals([browser], { browser: 'error' }, { browser: 'Failed' }, { browser: 'TypeError: failure' })).toEqual([])
  })

  it('diagnoses an ordinary terminal when its output is available', () => {
    const shell: PanelDefinition = { id: 'shell', type: 'terminal', title: 'Shell', zone: 'bottom' }
    expect(managerFailureSignals([shell], { shell: 'running' }, {}, { shell: 'Error: failed to listen on port 3000' }))
      .toEqual([{ key: expect.stringMatching(/^shell:[a-z0-9]+$/), title: 'Shell' }])
  })

  it('uses a stable key across ANSI styling and unrelated later output', () => {
    const first = signals('TypeError: cannot read item\n')
    const later = signals('\u001b[31mTypeError: cannot read item\u001b[0m\nWaiting for input…\n')
    expect(later).toEqual(first)
  })

  it('changes the key for a different diagnostic without exposing the raw output', () => {
    const first = signals('TypeError: first-private-error')[0]
    const second = signals('TypeError: second-private-error')[0]
    expect(second.key).not.toBe(first.key)
    expect(first.key).not.toContain('private-error')
    expect(first).toEqual({ key: expect.stringMatching(/^cli-1:[a-z0-9]+$/), title: 'Project agent' })
  })

  it('keeps identical diagnostics from different panels independent', () => {
    const second = { ...panel, id: 'cli-2' }
    const found = managerFailureSignals([panel, second], { 'cli-1': 'waiting', 'cli-2': 'waiting' }, {}, {
      'cli-1': 'TypeError: same failure', 'cli-2': 'TypeError: same failure'
    })
    expect(found).toHaveLength(2)
    expect(found[0].key).not.toBe(found[1].key)
  })
})
