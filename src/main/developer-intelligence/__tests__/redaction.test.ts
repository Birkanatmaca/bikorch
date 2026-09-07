import { describe, expect, it } from 'vitest'
import { looksLikeSecret, redactSecrets, REDACTED } from '../redaction'

describe('redactSecrets', () => {
  it('leaves ordinary prompts untouched', () => {
    const input = 'Refactor the TerminalView component to use a smaller hook and add tests.'
    const result = redactSecrets(input)
    expect(result.text).toBe(input)
    expect(result.redactedCount).toBe(0)
  })

  it('redacts provider API keys wherever they appear', () => {
    const result = redactSecrets('use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 for auth')
    expect(result.text).toBe(`use ${REDACTED} for auth`)
    expect(result.redactedCount).toBe(1)
  })

  it('redacts env-style assignments only when the key looks sensitive', () => {
    const result = redactSecrets('OPENAI_API_KEY=abcd1234efgh5678\nNODE_ENV=production')
    expect(result.text).toBe(`OPENAI_API_KEY=${REDACTED}\nNODE_ENV=production`)
    expect(result.redactedCount).toBe(1)
  })

  it('redacts quoted json secrets', () => {
    const result = redactSecrets('{"password": "hunter2!!", "username": "birkan"}')
    expect(result.text).toContain(`"password": "${REDACTED}"`)
    expect(result.text).toContain('"username": "birkan"')
  })

  it('redacts bearer and basic authorization headers', () => {
    const result = redactSecrets('curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop"')
    expect(result.text).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(result.redactedCount).toBeGreaterThan(0)
  })

  it('redacts credentials embedded in connection strings but keeps the host', () => {
    const result = redactSecrets('DATABASE_URL=postgres://app:s3cr3t-pass@db.internal:5432/prod')
    expect(result.text).toContain('db.internal:5432/prod')
    expect(result.text).not.toContain('s3cr3t-pass')
  })

  it('redacts private key blocks entirely', () => {
    const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----'
    const result = redactSecrets(`here is my key ${key} thanks`)
    expect(result.text).toBe(`here is my key ${REDACTED} thanks`)
  })

  it('redacts github, aws, google and slack tokens', () => {
    const result = redactSecrets(
      [
        'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        'AKIAABCDEFGHIJKLMNOP',
        'AIzaSyA-abcdefghijklmnopqrstuvwxyz0123456',
        'xoxb-1234567890-abcdefghij'
      ].join(' ')
    )
    expect(result.redactedCount).toBe(4)
    expect(result.text.split(REDACTED).length - 1).toBe(4)
  })

  it('redacts cli flags carrying secrets', () => {
    const result = redactSecrets('mysql -u root --password=SuperSecret1 -h localhost')
    expect(result.text).toBe(`mysql -u root --password=${REDACTED} -h localhost`)
  })

  it('exposes a boolean helper', () => {
    expect(looksLikeSecret('token=abcdefgh12345')).toBe(true)
    expect(looksLikeSecret('please add a loading state')).toBe(false)
  })

  it('is idempotent', () => {
    const once = redactSecrets('API_KEY=abcdef123456')
    const twice = redactSecrets(once.text)
    expect(twice.text).toBe(once.text)
    expect(twice.redactedCount).toBe(0)
  })
})
