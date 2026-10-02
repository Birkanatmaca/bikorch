import { existsSync, renameSync } from 'fs'
import { rm } from 'fs/promises'
import { resolve, sep } from 'path'
import { managedCliPaths } from './managed-paths'

function assertManaged(path: string): void {
  if (!resolve(path).startsWith(resolve(managedCliPaths().root) + sep)) throw new Error('Invalid managed tool path')
}

export function recoverDirectory(target: string): void {
  assertManaged(target)
  if (!existsSync(target) && existsSync(`${target}.previous`)) renameSync(`${target}.previous`, target)
}

export async function replaceDirectory(source: string, target: string): Promise<void> {
  assertManaged(source)
  assertManaged(target)
  recoverDirectory(target)
  const backup = `${target}.previous`
  await rm(backup, { recursive: true, force: true })
  if (existsSync(target)) renameSync(target, backup)
  try { renameSync(source, target) }
  catch (error) { recoverDirectory(target); throw error }
  // A cleanup failure must not turn a verified installation into a failure.
  await rm(backup, { recursive: true, force: true }).catch(() => undefined)
}
