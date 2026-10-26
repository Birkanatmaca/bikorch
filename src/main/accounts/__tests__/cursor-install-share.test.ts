import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, safeStorage: {} }))
vi.mock('../cursor-credential', () => ({ readCursorKeychainTokens: vi.fn() }))
import { shareCursorInstall } from '../cursor-profile'

let root = ''
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'bikorch-cursor-share-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('shareCursorInstall', () => {
  it('replaces downloaded copies in a profile with a link to the real install', () => {
    const real = join(root, 'real')
    const profile = join(root, 'profile')
    mkdirSync(join(real, '.local', 'share', 'cursor-agent', 'versions', 'v3'), { recursive: true })
    const copy = join(profile, '.local', 'share', 'cursor-agent', 'versions', 'v1')
    mkdirSync(copy, { recursive: true })
    writeFileSync(join(copy, 'cursor-agent'), 'old copy')

    shareCursorInstall(profile, real)

    const local = join(profile, '.local', 'share', 'cursor-agent')
    expect(lstatSync(local).isSymbolicLink()).toBe(true)
    expect(readlinkSync(local)).toBe(join(real, '.local', 'share', 'cursor-agent'))
    expect(existsSync(join(local, 'versions', 'v3'))).toBe(true)
    // The real install is never touched.
    expect(existsSync(join(real, '.local', 'share', 'cursor-agent', 'versions', 'v3'))).toBe(true)
  })

  it('does nothing when Cursor is not installed', () => {
    const profile = join(root, 'profile')
    shareCursorInstall(profile, join(root, 'missing'))
    expect(existsSync(join(profile, '.local'))).toBe(false)
  })
})
