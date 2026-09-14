import { spawn } from 'child_process'
import { access } from 'fs/promises'
import { resolve } from 'path'

export function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
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
        resolvePromise(stdout)
        return
      }
      reject(new Error(stderr.trim() || stdout.trim() || `git exited with code ${code}`))
    })
  })
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function tryRepoRoot(projectRoot: string): Promise<string | null> {
  const toplevel = (await runGit(projectRoot, ['rev-parse', '--show-toplevel']).catch(() => '')).trim()
  return toplevel || null
}

export async function resolveRepoRoot(projectRoot: string): Promise<string> {
  return (await tryRepoRoot(projectRoot)) || resolve(projectRoot)
}

export async function currentBranch(cwd: string): Promise<string | null> {
  const name = (await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim()
  if (!name || name === 'HEAD') return null
  return name
}

export async function headSha(cwd: string): Promise<string> {
  return (await runGit(cwd, ['rev-parse', 'HEAD']).catch(() => '')).trim()
}

export async function isWorkingTreeDirty(cwd: string): Promise<boolean> {
  const porcelain = (await runGit(cwd, ['status', '--porcelain']).catch(() => '')).trim()
  return porcelain.length > 0
}

export async function commitIfDirty(cwd: string, title: string): Promise<boolean> {
  await runGit(cwd, ['add', '-A']).catch(() => undefined)
  if (!(await isWorkingTreeDirty(cwd))) return false
  const message = `bikorch: ${title.trim().slice(0, 72) || 'agent work'}`
  try {
    await runGit(cwd, ['commit', '-m', message])
  } catch {
    await runGit(cwd, [
      '-c',
      'user.email=bikorch@local',
      '-c',
      'user.name=Bikorch',
      'commit',
      '-m',
      message
    ])
  }
  return true
}

export function foldCommitMessage(title: string): string {
  const trimmed = title.trim().replace(/^bikorch:\s*/i, '').slice(0, 72)
  return trimmed || 'Fold agent work'
}
