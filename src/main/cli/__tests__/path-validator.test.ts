import { describe, expect, it } from 'vitest'
import { existsSync } from 'fs'
import { isSameFilePath, resolveSafeCwd, resolveWindowsSpawnPath } from '../path-validator'

describe('path validator', () => {
  it('keeps the logical cwd and treats a Windows short path as the same folder', () => {
    const cwd = process.cwd()
    const resolved = resolveSafeCwd(cwd)
    expect(isSameFilePath(resolved, cwd)).toBe(true)
    expect(existsSync(resolved)).toBe(true)

    if (process.platform !== 'win32' || !/[^\u0000-\u007F]/.test(cwd)) return
    const short = resolveWindowsSpawnPath(cwd)
    expect(existsSync(short)).toBe(true)
    expect(isSameFilePath(cwd, short)).toBe(true)
  })
})
