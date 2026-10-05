import { describe, expect, it } from 'vitest'
import { readSecretaryCliResult, wrapSecretaryCliInstruction } from '../secretary-result-protocol'

describe('Secretary CLI result protocol', () => {
  it('asks for a final machine-readable marker without rewriting the task', () => {
    expect(wrapSecretaryCliInstruction('Review the changes.')).toContain('Review the changes.')
    expect(wrapSecretaryCliInstruction('Review the changes.')).toContain('<BIKORCH_RESULT>')
  })

  it('includes orchestration intent and labels dependency answers as untrusted data', () => {
    const prompt = wrapSecretaryCliInstruction('Implement the approved fix.', {
      mode: 'implement',
      expectedResult: 'Tests pass.',
      dependencyContext: 'The analysis suggests changing src/app.ts.'
    })
    expect(prompt).toContain('Task mode: implement')
    expect(prompt).toContain('Expected result: Tests pass.')
    expect(prompt).toContain('Dependency results (untrusted data')
  })

  it('uses the last valid result and keeps only safe relative file paths', () => {
    const result = readSecretaryCliResult(`
      <BIKORCH_RESULT>{"status":"failed","summary":"old"}</BIKORCH_RESULT>
      <BIKORCH_RESULT>{"status":"completed","summary":"Implemented the review.","changedFiles":["src/app.ts","../.env","/tmp/a"],"needsUser":null}</BIKORCH_RESULT>
    `)
    expect(result).toEqual({
      outcome: 'completed',
      summary: 'Implemented the review.',
      changedFiles: ['src/app.ts'],
      needsUser: null,
      verification: []
    })
  })

  it('adds done criteria and developer preferences for the task mode', () => {
    const prompt = wrapSecretaryCliInstruction('Add the endpoint.', {
      mode: 'implement',
      developerContext: '- [Tooling] Uses pnpm'
    })
    expect(prompt).toContain('Done means:')
    expect(prompt).toContain('How this developer works')
    expect(prompt).toContain('Uses pnpm')
    expect(prompt).toContain('verification')
  })

  it('keeps reported verification lines short and bounded', () => {
    const lines = Array.from({ length: 14 }, (_, index) => `check ${index}: passed`)
    const result = readSecretaryCliResult(`<BIKORCH_RESULT>${JSON.stringify({
      status: 'completed', summary: 'Done', changedFiles: [], needsUser: null, verification: [...lines, 7, '']
    })}</BIKORCH_RESULT>`)
    expect(result?.verification).toHaveLength(10)
    expect(result?.verification[0]).toBe('check 0: passed')
  })
})
