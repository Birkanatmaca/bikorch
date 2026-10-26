import { describe, expect, it } from 'vitest'
import { readSecretaryCliResult, wrapSecretaryCliInstruction, secretaryResultToken } from '../secretary-result-protocol'

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
      needsUser: null
    })
  })
})

describe('per-task result tokens', () => {
  const token = secretaryResultToken('11111111-2222-3333-4444-555555555555', 'assignment-2')
  const result = (task: string, summary: string): string =>
    `<BIKORCH_RESULT>{"task":"${task}","status":"completed","summary":"${summary}","changedFiles":[],"needsUser":null}</BIKORCH_RESULT>`

  it('asks the CLI to echo the token', () => {
    expect(wrapSecretaryCliInstruction('Add subtract', { resultToken: token })).toContain(`task (exactly "${token}")`)
  })

  it('ignores the previous task result still visible in a reused terminal', () => {
    const output = result('11111111-assignment-1', 'add done')
    expect(readSecretaryCliResult(output, token)).toBeNull()
    expect(readSecretaryCliResult(`${output}\n${result(token, 'subtract done')}`, token)?.summary).toBe('subtract done')
  })
})
