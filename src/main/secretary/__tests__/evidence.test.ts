import { describe, expect, it } from 'vitest'
import type { SecretaryCliResult } from '../service'
import { buildSecretaryRunEvidence } from '../evidence'

const base: SecretaryCliResult = {
  assignmentId: 'assignment-1',
  kind: 'codex',
  mode: 'implement',
  title: 'Implement change',
  expectedResult: 'Tests pass',
  summary: 'Done',
  output: 'Tests pass',
  outcome: 'completed',
  completionEvidence: 'cli-reported',
  git: {
    available: true,
    changedFiles: [],
    commits: [],
    preexistingChangedFiles: [],
    reportedChangedFiles: [],
    unverifiedReportedFiles: [],
    patchCheckExitCode: 0
  }
}

describe('Secretary run evidence', () => {
  it('does not promote a CLI test claim to independent verification', () => {
    const evidence = buildSecretaryRunEvidence([base], [{
      assignmentId: base.assignmentId,
      sessionId: 'panel-1',
      accountId: 'account-1'
    }], 123)
    expect(evidence.verificationLevel).toBe('cli-reported')
    expect(evidence.assignments[0]).toMatchObject({ sessionId: 'panel-1', accountId: 'account-1' })
    expect(evidence).not.toHaveProperty('testsPassed')
  })

  it('keeps Git observations and pre-existing edits distinct', () => {
    const evidence = buildSecretaryRunEvidence([{
      ...base,
      git: {
        ...base.git,
        changedFiles: ['src/changed.ts'],
        preexistingChangedFiles: ['src/changed.ts'],
        unverifiedReportedFiles: ['claimed-only.ts']
      }
    }], [], 123)
    expect(evidence.verificationLevel).toBe('git-observed')
    expect(evidence.changedFiles).toEqual(['src/changed.ts'])
    expect(evidence.assignments[0]?.preexistingChangedFiles).toEqual(['src/changed.ts'])
    expect(evidence.unverifiedReportedFiles).toEqual(['claimed-only.ts'])
  })

  it('keeps idle-based completion unverified when Git has no activity', () => {
    expect(buildSecretaryRunEvidence([{ ...base, completionEvidence: 'terminal-idle-inferred' }], []).verificationLevel).toBe('inferred')
  })
})
