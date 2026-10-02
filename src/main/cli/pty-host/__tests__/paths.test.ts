import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { hostConnectionToken, hostSocketPath } from '../paths'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
describe('durable host connection', () => {
  it('uses Windows named pipes and keeps different user data roots separate', () => {
    const root = join(tmpdir(), 'Bikorch User ü')
    const pipe = hostSocketPath(root, 'win32')
    expect(pipe.startsWith('\\\\.\\pipe\\bikorch-pty-')).toBe(true)
    expect(hostSocketPath(root, 'win32')).toBe(pipe)
    expect(hostSocketPath(root + '-other', 'win32')).not.toBe(pipe)
    expect(hostSocketPath(root, 'linux')).toBe(join(root, 'pty-host.sock'))
  })
  it('keeps the private connection token stable across application restarts', () => {
    const root = mkdtempSync(join(tmpdir(), 'bikorch-host-token-'))
    roots.push(root)
    const token = hostConnectionToken(root)
    expect(token).toMatch(/^[a-f0-9]{64}$/)
    expect(hostConnectionToken(root)).toBe(token)
  })
})
