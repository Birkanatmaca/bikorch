import { copyFile, lstat, symlink } from 'fs/promises'
import { join } from 'path'
import { constants } from 'fs'
import { pathExists } from './git-exec'

const ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local'] as const

async function copyMissingFile(fromRoot: string, toRoot: string, name: string): Promise<void> {
  const source = join(fromRoot, name)
  const dest = join(toRoot, name)
  if (!(await pathExists(source)) || (await pathExists(dest))) return
  await copyFile(source, dest, constants.COPYFILE_EXCL).catch(() => undefined)
}

async function linkNodeModules(fromRoot: string, toRoot: string): Promise<void> {
  const source = join(fromRoot, 'node_modules')
  const dest = join(toRoot, 'node_modules')
  if (!(await pathExists(source)) || (await pathExists(dest))) return
  const sourceStat = await lstat(source).catch(() => null)
  if (!sourceStat?.isDirectory() && !sourceStat?.isSymbolicLink()) return
  const type = process.platform === 'win32' ? 'junction' : 'dir'
  await symlink(source, dest, type).catch(() => undefined)
}

/** Copy local env files and share node_modules so an agent worktree can actually run. */
export async function provisionWorktree(repoRoot: string, worktreePath: string): Promise<void> {
  if (repoRoot === worktreePath) return
  for (const name of ENV_FILES) {
    await copyMissingFile(repoRoot, worktreePath, name)
  }
  await linkNodeModules(repoRoot, worktreePath)
}
