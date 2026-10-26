import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  claudeKeychainService,
  inspectClaudeLogin,
  inspectClaudeLoginFiles
} from '../claude-credential'

const dirs: string[] = []
function profileDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bikorch-claude-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('claude login detection', () => {
  it('is not ready for an empty profile', () => {
    expect(inspectClaudeLoginFiles(profileDir())).toEqual({ ready: false })
  })

  it('treats the oauthAccount record as a finished login (macOS keeps the token in Keychain)', () => {
    const dir = profileDir()
    writeFileSync(
      join(dir, '.claude.json'),
      JSON.stringify({ oauthAccount: { emailAddress: 'dev@example.com' } })
    )
    expect(inspectClaudeLoginFiles(dir)).toEqual({ ready: true, email: 'dev@example.com' })
  })

  it('still accepts a plaintext credentials file', () => {
    const dir = profileDir()
    writeFileSync(
      join(dir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'x' } })
    )
    expect(inspectClaudeLoginFiles(dir).ready).toBe(true)
  })

  it('accepts an API key login', () => {
    const dir = profileDir()
    writeFileSync(join(dir, '.claude.json'), JSON.stringify({ primaryApiKey: 'sk-ant-test' }))
    expect(inspectClaudeLoginFiles(dir).ready).toBe(true)
  })

  it('does not consult the Keychain off macOS', async () => {
    expect(await inspectClaudeLogin(profileDir(), 'linux')).toEqual({ ready: false })
  })

  it('derives a per-directory Keychain service name', () => {
    expect(claudeKeychainService(null)).toBe('Claude Code-credentials')
    const a = claudeKeychainService('/tmp/a')
    expect(a).toMatch(/^Claude Code-credentials-[0-9a-f]{8}$/)
    expect(claudeKeychainService('/tmp/b')).not.toBe(a)
  })
})
