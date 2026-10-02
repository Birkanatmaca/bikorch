import { createHash, randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

export function hostSocketPath(root: string, platform = process.platform): string {
  if (platform !== 'win32') return join(root, 'pty-host.sock')
  const key = createHash('sha256').update(resolve(root).toLowerCase()).digest('hex').slice(0, 32)
  return `\\\\.\\pipe\\bikorch-pty-${key}`
}

export function hostConnectionToken(root: string): string {
  const path = join(root, 'pty-host-token')
  if (!existsSync(path)) {
    try { writeFileSync(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }) }
    catch (error) { if (!existsSync(path)) throw error }
  }
  const token = readFileSync(path, 'utf8').trim()
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid terminal host connection token')
  return token
}
