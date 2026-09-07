import { existsSync, lstatSync, realpathSync } from 'fs'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'path'

const UNSAFE_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g
const RESERVED_WINDOWS = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'lpt1',
  'lpt2',
  'lpt3'
])

export function sanitizeFilename(name: string, fallback = 'download'): string {
  const trimmed = name
    .normalize('NFKC')
    .replace(UNSAFE_CHARS, '_')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)

  const stem = trimmed || fallback
  const lower = stem.toLowerCase()
  if (RESERVED_WINDOWS.has(lower)) return `${fallback}-${stem}`
  if (/^\.+$/.test(stem)) return fallback
  return stem
}

export function uniqueFilename(directory: string, base: string, ext: string): string {
  const safeBase = sanitizeFilename(base)
  const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
  let candidate = `${safeBase}${normalizedExt}`
  let index = 1
  while (existsSync(resolve(directory, candidate))) {
    candidate = `${safeBase} (${index})${normalizedExt}`
    index += 1
    if (index > 500) {
      candidate = `${safeBase}-${Date.now()}${normalizedExt}`
      break
    }
  }
  return candidate
}

function realExisting(path: string): string {
  return existsSync(path) ? realpathSync(path) : path
}

export function assertPathInside(root: string, target: string): string {
  if (!root) throw new Error('Download root is not configured')
  const resolvedRoot = realExisting(resolve(root))
  const resolvedTarget = isAbsolute(target) ? resolve(target) : resolve(resolvedRoot, target)

  if (existsSync(resolvedTarget)) {
    const stat = lstatSync(resolvedTarget)
    if (stat.isSymbolicLink()) {
      throw new Error('Symbolic links are not allowed as download destinations')
    }
  }

  const realTarget = realExisting(resolvedTarget)
  if (resolvedRoot === realTarget) return realTarget
  const rel = relative(resolvedRoot, realTarget)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Path is outside the managed download folder')
  }
  if (rel.split(sep).some((part) => part === '..')) {
    throw new Error('Path is outside the managed download folder')
  }
  return realTarget
}

export function assertParentInside(root: string, filePath: string): string {
  const parent = dirname(resolve(filePath))
  assertPathInside(root, parent)
  return resolve(filePath)
}

export function isManagedFilename(name: string): boolean {
  const file = basename(name)
  return file.length > 0 && !file.includes('..') && !file.includes('/') && !file.includes('\\')
}

export function replaceExtension(filePath: string, ext: string): string {
  const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`
  return `${filePath.slice(0, filePath.length - extname(filePath).length)}${normalizedExt}`
}

export function tempSidecars(outputPath: string): string[] {
  return [`${outputPath}.part`, `${outputPath}.ytdl`, `${replaceExtension(outputPath, '.part')}`]
}
