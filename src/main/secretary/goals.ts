import { randomUUID } from 'crypto'
import type { Database } from 'sql.js'
import type {
  SecretaryGoal,
  SecretaryGoalCriterion,
  SecretaryGoalStatus,
  SecretaryGoalVerification
} from '@shared/contracts/secretary'
import { getPersistenceDatabase, schedulePersistToDisk } from '../persistence/database'

/**
 * Goals ("work until it is done") live in their own tables next to the Manager's
 * runs. A goal owns several runs, one per round.
 */

export const DEFAULT_GOAL_ROUNDS = 4
export const MAX_GOAL_ROUNDS = 8

const STATUSES = new Set<SecretaryGoalStatus>(['draft', 'active', 'met', 'blocked', 'exhausted', 'stopped'])

type Row = Record<string, unknown>

let schemaReady = false

function db(): Database {
  const database = getPersistenceDatabase()
  if (!database) throw new Error('Manager storage is not ready yet')
  if (!schemaReady) {
    database.run(`
      CREATE TABLE IF NOT EXISTS secretary_goals (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        objective TEXT NOT NULL,
        criteria_json TEXT NOT NULL,
        verify_json TEXT NOT NULL,
        max_rounds INTEGER NOT NULL,
        round INTEGER NOT NULL,
        status TEXT NOT NULL,
        criteria_status_json TEXT NOT NULL DEFAULT '[]',
        verification_json TEXT NOT NULL DEFAULT '[]',
        summary TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    database.run(`
      CREATE TABLE IF NOT EXISTS secretary_goal_runs (
        run_id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL,
        round INTEGER NOT NULL
      );
    `)
    database.run('CREATE INDEX IF NOT EXISTS secretary_goals_thread ON secretary_goals (thread_id, updated_at DESC);')
    schemaReady = true
  }
  return database
}

function rows(sql: string, params: unknown[] = []): Row[] {
  const statement = db().prepare(sql)
  statement.bind(params as never)
  const result: Row[] = []
  while (statement.step()) result.push(statement.getAsObject() as Row)
  statement.free()
  return result
}

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function toGoal(row: Row): SecretaryGoal | null {
  const status = String(row.status) as SecretaryGoalStatus
  if (!STATUSES.has(status)) return null
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    projectId: String(row.project_id),
    objective: String(row.objective),
    criteria: json<string[]>(row.criteria_json, []),
    verifyCommands: json<string[]>(row.verify_json, []),
    maxRounds: Number(row.max_rounds),
    round: Number(row.round),
    status,
    criteriaStatus: json<SecretaryGoalCriterion[]>(row.criteria_status_json, []),
    lastVerification: json<SecretaryGoalVerification[]>(row.verification_json, []),
    summary: String(row.summary ?? ''),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  }
}

export function getGoal(id: string): SecretaryGoal | null {
  const row = rows('SELECT * FROM secretary_goals WHERE id = ?', [id])[0]
  return row ? toGoal(row) : null
}

export function goalForRun(runId: string): SecretaryGoal | null {
  const link = rows('SELECT goal_id FROM secretary_goal_runs WHERE run_id = ?', [runId])[0]
  return link ? getGoal(String(link.goal_id)) : null
}

export function createGoalDraft(input: {
  threadId: string
  projectId: string
  runId: string
  objective: string
  criteria: string[]
  verifyCommands: string[]
  maxRounds?: number
}): SecretaryGoal {
  const now = Date.now()
  const id = randomUUID()
  const maxRounds = Math.min(MAX_GOAL_ROUNDS, Math.max(1, Math.floor(input.maxRounds ?? DEFAULT_GOAL_ROUNDS)))
  db().run(
    `INSERT INTO secretary_goals (id, thread_id, project_id, objective, criteria_json, verify_json, max_rounds, round, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'draft', ?, ?)`,
    [id, input.threadId, input.projectId, input.objective, JSON.stringify(input.criteria), JSON.stringify(input.verifyCommands), maxRounds, now, now]
  )
  linkRunToGoal(input.runId, id, 1)
  return getGoal(id)!
}

export function linkRunToGoal(runId: string, goalId: string, round: number): void {
  db().run('INSERT OR REPLACE INTO secretary_goal_runs (run_id, goal_id, round) VALUES (?, ?, ?)', [runId, goalId, round])
  schedulePersistToDisk()
}

export function updateGoal(
  id: string,
  patch: Partial<Pick<SecretaryGoal, 'status' | 'round' | 'maxRounds' | 'criteriaStatus' | 'lastVerification' | 'summary'>>
): SecretaryGoal | null {
  const current = getGoal(id)
  if (!current) return null
  const next = { ...current, ...patch, updatedAt: Date.now() }
  db().run(
    `UPDATE secretary_goals SET status = ?, round = ?, max_rounds = ?, criteria_status_json = ?, verification_json = ?, summary = ?, updated_at = ?
     WHERE id = ?`,
    [next.status, next.round, next.maxRounds, JSON.stringify(next.criteriaStatus), JSON.stringify(next.lastVerification), next.summary, next.updatedAt, id]
  )
  schedulePersistToDisk()
  return getGoal(id)
}

/** Approving the first plan of a draft goal starts the goal. */
export function activateGoalForRun(runId: string): SecretaryGoal | null {
  const goal = goalForRun(runId)
  if (!goal || goal.status !== 'draft') return goal
  return updateGoal(goal.id, { status: 'active' })
}

export function goalsForThread(threadId: string): SecretaryGoal[] {
  return rows('SELECT * FROM secretary_goals WHERE thread_id = ? ORDER BY updated_at DESC', [threadId])
    .map(toGoal)
    .filter((goal): goal is SecretaryGoal => Boolean(goal))
}

/** Tests only. */
export function resetGoalSchemaForTests(): void {
  schemaReady = false
}
