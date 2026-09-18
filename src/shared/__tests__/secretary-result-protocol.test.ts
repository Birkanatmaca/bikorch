import { describe, expect, it } from 'vitest'
import { readSecretaryCliResult, wrapSecretaryCliInstruction } from '../secretary-result-protocol'

describe('Secretary CLI result protocol', () => {
  it('asks for a final machine-readable marker without rewriting the task', () => {
    expect(wrapSecretaryCliInstruction('Review the changes.')).toContain('Review the changes.')
    expect(wrapSecretaryCliInstruction('Review the changes.')).toContain('<BIKORCH_RESULT>')
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
