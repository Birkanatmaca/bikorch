import { createHash } from 'crypto'
import { isAbsolute, join, relative, resolve } from 'path'
import { AGENT_WORKTREE_KINDS, type AgentWorktreeKind } from '@shared/contracts/git'

export function isAgentWorktreeKind(value: string): value is AgentWorktreeKind {
  return (AGENT_WORKTREE_KINDS as readonly string[]).includes(value)
}

export function hashRepoRoot(repoRoot: string): string {
  return createHash('sha1').update(resolve(repoRoot)).digest('hex').slice(0, 12)
}

export function sanitizeWorktreeSlot(kind: string, panelId: string): string {
  const safeKind = kind.replace(/[^a-z0-9-]/gi, '').toLowerCase().slice(0, 20)
  const safeId = panelId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)
  if (!safeKind || safeId.length < 8) throw new Error('Invalid worktree slot')
  return `${safeKind}-${safeId}`
}

export function agentBranchName(kind: string, panelId: string): string {
  return `bikorch/${sanitizeWorktreeSlot(kind, panelId)}`
}

export function integrationBranchName(panelId: string): string {
  const safeId = panelId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)
  if (safeId.length < 8) throw new Error('Invalid worktree slot')
  return `bikorch/integrate-${safeId}`
}

export function buildAgentWorktreePath(
  baseDir: string,
  repoRoot: string,
  kind: string,
  panelId: string
): string {
  return join(resolve(baseDir), 'agent-worktrees', hashRepoRoot(repoRoot), sanitizeWorktreeSlot(kind, panelId))
}

export function buildIntegrationWorktreePath(baseDir: string, repoRoot: string, panelId: string): string {
  const safeId = panelId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)
  if (safeId.length < 8) throw new Error('Invalid worktree slot')
  return join(resolve(baseDir), 'agent-worktrees', hashRepoRoot(repoRoot), `integrate-${safeId}`)
}

export function isManagedWorktreePath(baseDir: string, worktreePath: string): boolean {
  const root = resolve(baseDir, 'agent-worktrees')
  const target = resolve(worktreePath)
  const rel = relative(root, target)
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel)
}
