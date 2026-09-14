import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type {
  AgentRunRecord,
  AgentWorktreeKind,
  IsolationFoldSession,
  WorkspaceIsolation
} from '@shared/contracts/git'
import { AGENT_WORKTREE_KINDS } from '@shared/contracts/git'
import { hashRepoRoot } from './worktree-paths'

export interface RepoIsolationState {
  repoRoot: string
  targetBranch: string
  targetSha: string
  runs: AgentRunRecord[]
  fold: IsolationFoldSession | null
}

const memory = new Map<string, RepoIsolationState>()

function storePath(baseDir: string, repoRoot: string): string {
  return join(baseDir, 'merge-queue', `${hashRepoRoot(repoRoot)}.json`)
}

function isKind(value: unknown): value is AgentWorktreeKind {
  return typeof value === 'string' && (AGENT_WORKTREE_KINDS as readonly string[]).includes(value)
}

function isPolicy(value: unknown): value is WorkspaceIsolation {
  return value === 'isolated' || value === 'shared'
}

function parseRun(raw: unknown): AgentRunRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as AgentRunRecord
  if (typeof row.id !== 'string' || row.id.length < 8) return null
  if (!isKind(row.kind)) return null
  if (typeof row.title !== 'string' || typeof row.branch !== 'string') return null
  if (typeof row.worktreePath !== 'string' || typeof row.targetBranch !== 'string') return null
  if (typeof row.baseSha !== 'string') return null
  if (!isPolicy(row.isolationPolicy)) return null
  return {
    id: row.id,
    kind: row.kind,
    title: row.title.slice(0, 200),
    branch: row.branch.slice(0, 255),
    worktreePath: row.worktreePath.slice(0, 1000),
    targetBranch: row.targetBranch.slice(0, 255),
    baseSha: row.baseSha.slice(0, 64),
    isolationPolicy: row.isolationPolicy,
    status: row.status ?? 'active',
    attachedPanelId: typeof row.attachedPanelId === 'string' ? row.attachedPanelId : null,
    createdAt: typeof row.createdAt === 'number' ? row.createdAt : Date.now(),
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : Date.now()
  }
}

function emptyState(repoRoot: string): RepoIsolationState {
  return {
    repoRoot,
    targetBranch: 'main',
    targetSha: '',
    runs: [],
    fold: null
  }
}

export async function loadRepoIsolation(repoRoot: string, baseDir: string): Promise<RepoIsolationState> {
  const cached = memory.get(repoRoot)
  if (cached) return cached
  const file = storePath(baseDir, repoRoot)
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<RepoIsolationState>
    const state: RepoIsolationState = {
      repoRoot,
      targetBranch: typeof parsed.targetBranch === 'string' ? parsed.targetBranch : 'main',
      targetSha: typeof parsed.targetSha === 'string' ? parsed.targetSha : '',
      runs: Array.isArray(parsed.runs) ? parsed.runs.map(parseRun).filter((run): run is AgentRunRecord => Boolean(run)) : [],
      fold: parsed.fold && typeof parsed.fold === 'object' ? (parsed.fold as IsolationFoldSession) : null
    }
    memory.set(repoRoot, state)
    return state
  } catch {
    const state = emptyState(repoRoot)
    memory.set(repoRoot, state)
    return state
  }
}

export async function saveRepoIsolation(state: RepoIsolationState, baseDir: string): Promise<void> {
  memory.set(state.repoRoot, state)
  const file = storePath(baseDir, state.repoRoot)
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
  await rename(tmp, file)
}

export function upsertAgentRun(state: RepoIsolationState, patch: AgentRunRecord): AgentRunRecord {
  const now = Date.now()
  const existing = state.runs.find((run) => run.id === patch.id)
  const next: AgentRunRecord = existing
    ? { ...existing, ...patch, createdAt: existing.createdAt, updatedAt: now }
    : { ...patch, createdAt: patch.createdAt || now, updatedAt: now }
  state.runs = [...state.runs.filter((run) => run.id !== patch.id), next]
  return next
}

export function clearRepoIsolationMemory(): void {
  memory.clear()
}
