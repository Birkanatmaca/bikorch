import { spawn } from 'child_process'
import { app } from 'electron'
import { access, mkdir, rm } from 'fs/promises'
import { dirname } from 'path'
import type { AgentWorktreeKind } from '@shared/contracts/git'
import { buildAgentWorktreePath, isManagedWorktreePath } from './worktree-paths'

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
        return
      }
      reject(new Error(stderr.trim() || `git exited with code ${code}`))
    })
  })
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function resolveRepoRoot(projectRoot: string): Promise<string | null> {
  try {
    const toplevel = (await runGit(projectRoot, ['rev-parse', '--show-toplevel'])).trim()
    return toplevel || null
  } catch {
    return null
  }
}

function listWorktreePaths(porcelain: string): string[] {
  return porcelain
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter(Boolean)
}

function worktreeBaseDir(): string {
  return app.getPath('userData')
}

export async function ensureAgentWorktree(input: {
  projectRoot: string
  kind: AgentWorktreeKind
  panelId: string
  baseDir?: string
}): Promise<{ ok: true; worktreePath: string | null } | { ok: false; error: string }> {
  const repoRoot = await resolveRepoRoot(input.projectRoot)
  if (!repoRoot) return { ok: true, worktreePath: null }

  const baseDir = input.baseDir ?? worktreeBaseDir()
  const worktreePath = buildAgentWorktreePath(baseDir, repoRoot, input.kind, input.panelId)

  try {
    const listed = listWorktreePaths(await runGit(repoRoot, ['worktree', 'list', '--porcelain']))
    const alreadyLinked = listed.some((path) => path.toLowerCase() === worktreePath.toLowerCase())
    if (alreadyLinked && (await exists(worktreePath))) {
      return { ok: true, worktreePath }
    }

    if (await exists(worktreePath)) {
      await runGit(repoRoot, ['worktree', 'remove', '--force', worktreePath]).catch(async () => {
        await rm(worktreePath, { recursive: true, force: true })
        await runGit(repoRoot, ['worktree', 'prune']).catch(() => undefined)
      })
    }

    await mkdir(dirname(worktreePath), { recursive: true })
    await runGit(repoRoot, ['worktree', 'add', '--detach', worktreePath])
    return { ok: true, worktreePath }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not isolate this agent' }
  }
}

export async function removeAgentWorktree(input: {
  projectRoot: string
  worktreePath: string
  baseDir?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const baseDir = input.baseDir ?? worktreeBaseDir()
  if (!isManagedWorktreePath(baseDir, input.worktreePath)) {
    return { ok: false, error: 'Worktree path is not managed by Bikorch' }
  }

  const repoRoot = (await resolveRepoRoot(input.projectRoot)) ?? input.projectRoot
  try {
    await runGit(repoRoot, ['worktree', 'remove', '--force', input.worktreePath])
  } catch {
    await rm(input.worktreePath, { recursive: true, force: true }).catch(() => undefined)
    await runGit(repoRoot, ['worktree', 'prune']).catch(() => undefined)
  }
  return { ok: true }
}
