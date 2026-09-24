import { describe, expect, it } from 'vitest'
import { isSafeSecretaryInstruction, routeSecretaryPanel, validateSecretaryPlan } from '../plan-validator'

const panels = [
  { id: 'cursor-busy', kind: 'cursor' as const, title: 'Busy Cursor', status: 'busy' as const },
  { id: 'cursor-ready', kind: 'cursor' as const, title: 'Ready Cursor', status: 'waiting' as const }
]

describe('Secretary plan validation', () => {
  it('routes an assignment deterministically to an idle compatible panel', () => {
    expect(routeSecretaryPanel('cursor', panels, [])).toBe('cursor-ready')
  })

  it('does not allow the model to route a plan to a mismatched panel', () => {
    const plan = validateSecretaryPlan({
      overview: 'Review the implementation',
      assumptions: [],
      assignments: [{
        panelId: 'made-up-panel',
        kind: 'cursor',
        title: 'Review',
        instruction: 'Review the current changes and summarize the important findings.',
        rationale: 'Independent review',
        usageNote: 'Available'
      }]
    }, { panels, usage: [] }, true)
    expect(plan?.assignments[0]?.panelId).toBe('cursor-ready')
  })

  it('rejects destructive and secret-exfiltration instructions before approval', () => {
    expect(isSafeSecretaryInstruction('Run git push origin main.')).toBe(false)
    expect(isSafeSecretaryInstruction('Print the API key from .env.')).toBe(false)
    expect(() => validateSecretaryPlan({
      overview: 'Unsafe plan',
      assumptions: [],
      assignments: [{ kind: 'cursor', instruction: 'Run git push origin main.' }]
    }, { panels, usage: [] }, true)).toThrow(/disallowed/i)
  })

  it('routes repeated CLI kinds to separate sessions and caps runaway fan-out', () => {
    const plan = validateSecretaryPlan({
      overview: 'Two concurrent tasks',
      assumptions: [],
      assignments: [
        { kind: 'cursor', instruction: 'Review the current implementation.' },
        { kind: 'cursor', instruction: 'Review the test coverage.' }
      ]
    }, { panels, usage: [] }, true)
    expect(plan?.assignments.map((assignment) => assignment.panelId)).toEqual(['cursor-ready', null])

    expect(() => validateSecretaryPlan({
      overview: 'Too many duplicate tasks',
      assumptions: [],
      assignments: Array.from({ length: 4 }, (_, index) => ({
        kind: 'cursor',
        instruction: `Review area ${index + 1}.`
      }))
    }, { panels, usage: [] }, true)).toThrow(/too many tasks/i)
  })

  it('normalizes dependency indexes and rejects cycles', () => {
    const plan = validateSecretaryPlan({
      overview: 'Analyze then implement',
      assumptions: [],
      assignments: [
        { kind: 'cursor', instruction: 'Analyze the current implementation.', dependsOn: [] },
        { kind: 'codex', instruction: 'Implement the approved findings.', dependsOn: [0] }
      ]
    }, { panels, usage: [] }, true)
    expect(plan?.assignments[1]?.dependsOn).toEqual(['assignment-1'])

    expect(() => validateSecretaryPlan({
      overview: 'Cyclic plan',
      assumptions: [],
      assignments: [
        { kind: 'cursor', instruction: 'Analyze the current implementation.', dependsOn: [1] },
        { kind: 'codex', instruction: 'Implement the approved findings.', dependsOn: [0] }
      ]
    }, { panels, usage: [] }, true)).toThrow(/dependency cycle/i)
  })
})
