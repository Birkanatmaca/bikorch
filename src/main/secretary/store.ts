import { createHash, randomUUID } from 'crypto'
import type { Database } from 'sql.js'
import {
  SECRETARY_ASSIGNMENT_MODES,
  SECRETARY_SCHEMA_VERSION,
  type SecretaryAssignmentMode,
  type SecretaryChatTurn,
  type SecretaryMessage,
  type SecretaryMessageCursor,
  type SecretaryMessageRole,
  type SecretaryMessageType,
  type SecretaryPlan,
  type SecretaryRun,
  type SecretaryRunEvidence,
  type SecretaryRunStatus,
  type SecretarySessionBinding,
  type SecretaryThread,
  type SecretaryThreadStatus
} from '@shared/contracts/secretary'
import type { CliUsageKind } from '@shared/contracts/usage'
import { redactSecrets } from '../developer-intelligence/redaction'
import { getPersistenceDatabase, schedulePersistToDisk } from '../persistence/database'

type Row = Record<string, unknown>

const RUN_STATUSES = new Set<SecretaryRunStatus>([
  'planning',
  'awaiting-approval',
  'approved',
  'running',
  'needs-user',
  'completed',
  'rejected',
  'failed',
  'cancelled',
  'interrupted'
])

const THREAD_STATUSES = new Set<SecretaryThreadStatus>(['active', 'archived'])
const MESSAGE_ROLES = new Set<SecretaryMessageRole>(['user', 'assistant'])
const MESSAGE_TYPES = new Set<SecretaryMessageType>(['chat', 'plan', 'approval', 'needs-user', 'final-report', 'error'])
const CLI_KINDS = new Set<CliUsageKind>(['claude', 'cursor', 'gemini', 'antigravity', 'codex'])
const RETAINABLE_RUN_STATUSES = ['completed', 'rejected', 'failed', 'cancelled', 'interrupted'] as const

const RUN_TRANSITIONS: Record<SecretaryRunStatus, ReadonlySet<SecretaryRunStatus>> = {
  planning: new Set(['awaiting-approval', 'completed', 'failed', 'interrupted']),
  'awaiting-approval': new Set(['approved', 'rejected', 'cancelled', 'interrupted']),
  approved: new Set(['running', 'failed', 'cancelled', 'interrupted']),
  running: new Set(['needs-user', 'completed', 'failed', 'cancelled', 'interrupted']),
  'needs-user': new Set(['running', 'failed', 'cancelled', 'interrupted']),
  completed: new Set(),
  rejected: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  interrupted: new Set()
}

export function isValidSecretaryRunTransition(from: SecretaryRunStatus, to: SecretaryRunStatus): boolean {
  return from === to || RUN_TRANSITIONS[from].has(to)
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null
}

function toRows(db: Database, sql: string, params: unknown[] = []): Row[] {
  const statement = db.prepare(sql)
  statement.bind(params as never)
  const rows: Row[] = []
  while (statement.step()) rows.push(statement.getAsObject() as Row)
  statement.free()
  return rows
}

function sanitizedText(value: string, maxLength: number): string {
  return redactSecrets(value).text.trim().slice(0, maxLength)
}

function parsePlan(value: unknown): SecretaryPlan | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = JSON.parse(value) as Partial<SecretaryPlan>
    if (!parsed || typeof parsed !== 'object' || typeof parsed.overview !== 'string' || !Array.isArray(parsed.assignments)) {
      return null
    }
    const assignments = parsed.assignments.flatMap((assignment, index) => {
      if (!assignment || typeof assignment !== 'object') return []
      const item = assignment as Partial<SecretaryPlan['assignments'][number]>
      if (!CLI_KINDS.has(item.kind as CliUsageKind) || typeof item.instruction !== 'string' || !item.instruction.trim()) return []
      return [{
        id: typeof item.id === 'string' && item.id ? item.id.slice(0, 100) : `assignment-${index + 1}`,
        panelId: typeof item.panelId === 'string' && item.panelId ? item.panelId.slice(0, 100) : null,
        kind: item.kind as CliUsageKind,
        mode: typeof item.mode === 'string' && SECRETARY_ASSIGNMENT_MODES.includes(item.mode as SecretaryAssignmentMode)
          ? item.mode as SecretaryAssignmentMode
          : 'implement',
        title: typeof item.title === 'string' && item.title.trim() ? item.title.trim().slice(0, 120) : `Task ${index + 1}`,
        instruction: item.instruction.trim().slice(0, 6000),
        expectedResult: typeof item.expectedResult === 'string' && item.expectedResult.trim()
          ? item.expectedResult.trim().slice(0, 1000)
          : 'Complete the assigned task and provide a concise, evidence-based result.',
        rationale: typeof item.rationale === 'string' ? item.rationale.slice(0, 500) : 'Selected by the planner.',
        usageNote: typeof item.usageNote === 'string' ? item.usageNote.slice(0, 240) : 'Review account availability before dispatching.',
        dependsOn: Array.isArray(item.dependsOn)
          ? item.dependsOn.filter((dependency): dependency is string => typeof dependency === 'string').slice(0, 8)
          : []
      }]
    })
    if (assignments.length === 0) return null
    const assignmentIds = new Set(assignments.map((assignment) => assignment.id))
    return {
      overview: parsed.overview.slice(0, 1000),
      assumptions: Array.isArray(parsed.assumptions)
        ? parsed.assumptions.filter((item): item is string => typeof item === 'string').slice(0, 6)
        : [],
      assignments: assignments.map((assignment) => ({
        ...assignment,
        dependsOn: assignment.dependsOn.filter((dependency) => assignmentIds.has(dependency) && dependency !== assignment.id)
      })),
      approvalRequired: true
    }
  } catch {
    return null
  }
}

function sanitizePlan(plan: SecretaryPlan | null): SecretaryPlan | null {
  if (!plan) return null
  return parsePlan(redactSecrets(JSON.stringify(plan)).text)
}

function parseOpenKinds(value: unknown): CliUsageKind[] {
  if (typeof value !== 'string') return []
  try {
    const raw = JSON.parse(value) as unknown
    if (!Array.isArray(raw)) return []
    const kinds: CliUsageKind[] = []
    for (const item of raw) {
      if (typeof item !== 'string' || !CLI_KINDS.has(item as CliUsageKind) || kinds.includes(item as CliUsageKind)) continue
      kinds.push(item as CliUsageKind)
    }
    return kinds
  } catch {
    return []
  }
}

function parseSessionBindings(value: unknown): SecretarySessionBinding[] {
  if (typeof value !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, 8).flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const binding = item as Partial<SecretarySessionBinding>
      if (typeof binding.assignmentId !== 'string' || typeof binding.sessionId !== 'string') return []
      return [{
        assignmentId: binding.assignmentId.slice(0, 100),
        sessionId: binding.sessionId.slice(0, 100),
        accountId: typeof binding.accountId === 'string' ? binding.accountId.slice(0, 100) : null
      }]
    })
  } catch {
    return []
  }
}

function parseRunEvidence(value: unknown): SecretaryRunEvidence | null {
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value) as Partial<SecretaryRunEvidence>
    if (!parsed || !Array.isArray(parsed.assignments) || !Array.isArray(parsed.changedFiles) ||
        !Array.isArray(parsed.unverifiedReportedFiles) ||
        !['git-observed', 'cli-reported', 'inferred'].includes(parsed.verificationLevel ?? '')) return null
    return parsed as SecretaryRunEvidence
  } catch {
    return null
  }
}

function rowToThread(row: Row): SecretaryThread | null {
  const id = text(row['id'])
  const projectId = text(row['project_id'])
  const title = text(row['title'])
  const status = text(row['status']) as SecretaryThreadStatus | null
  const createdAt = integer(row['created_at'])
  const updatedAt = integer(row['updated_at'])
  if (!id || !projectId || !title || !status || !THREAD_STATUSES.has(status) || createdAt === null || updatedAt === null) return null
  return { id, projectId, title, status, createdAt, updatedAt }
}

function rowToMessage(row: Row): SecretaryMessage | null {
  const id = text(row['id'])
  const threadId = text(row['thread_id'])
  const role = text(row['role']) as SecretaryMessageRole | null
  const type = text(row['type']) as SecretaryMessageType | null
  const content = text(row['content'])
  const createdAt = integer(row['created_at'])
  if (!id || !threadId || !role || !MESSAGE_ROLES.has(role) || !type || !MESSAGE_TYPES.has(type) || content === null || createdAt === null) {
    return null
  }
  return { id, threadId, runId: text(row['run_id']), assignmentId: text(row['assignment_id']), role, type, content, createdAt }
}

function rowToRun(row: Row): SecretaryRun | null {
  const id = text(row['id'])
  const threadId = text(row['thread_id'])
  const projectId = text(row['project_id'])
  const status = text(row['status']) as SecretaryRunStatus | null
  const requestText = text(row['request_text'])
  const createdAt = integer(row['created_at'])
  const updatedAt = integer(row['updated_at'])
  if (!id || !threadId || !projectId || !status || !RUN_STATUSES.has(status) || requestText === null || createdAt === null || updatedAt === null) {
    return null
  }
  const plan = parsePlan(row['plan_json'])
  return {
    id,
    threadId,
    projectId,
    status,
    requestText,
    reply: text(row['reply']),
    plan,
    planRevision: Math.max(0, integer(row['plan_revision']) ?? (plan ? 1 : 0)),
    openKinds: parseOpenKinds(row['open_kinds_json']),
    errorCode: text(row['error_code']),
    errorMessage: text(row['error_message']),
    sessionBindings: parseSessionBindings(row['session_bindings_json']),
    evidence: parseRunEvidence(row['evidence_json']),
    createdAt,
    updatedAt
  }
}

function planHash(plan: SecretaryPlan): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex')
}

export function initSecretarySchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS secretary_threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      context_summary TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  const threadColumns = toRows(db, 'PRAGMA table_info(secretary_threads)')
  if (!threadColumns.some((column) => text(column['name']) === 'context_summary')) {
    db.run("ALTER TABLE secretary_threads ADD COLUMN context_summary TEXT NOT NULL DEFAULT ''")
  }
  db.run('CREATE INDEX IF NOT EXISTS secretary_threads_project ON secretary_threads (project_id, updated_at DESC);')

  db.run(`
    CREATE TABLE IF NOT EXISTS secretary_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      run_id TEXT,
      assignment_id TEXT,
      role TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `)
  const messageColumns = toRows(db, 'PRAGMA table_info(secretary_messages)')
  if (!messageColumns.some((column) => text(column['name']) === 'assignment_id')) {
    db.run('ALTER TABLE secretary_messages ADD COLUMN assignment_id TEXT')
  }
  db.run('CREATE INDEX IF NOT EXISTS secretary_messages_thread ON secretary_messages (thread_id, created_at);')

  db.run(`
    CREATE TABLE IF NOT EXISTS secretary_runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      request_text TEXT NOT NULL,
      reply TEXT,
      plan_json TEXT,
      plan_revision INTEGER NOT NULL DEFAULT 0,
      open_kinds_json TEXT NOT NULL DEFAULT '[]',
      error_code TEXT,
      error_message TEXT,
      session_bindings_json TEXT NOT NULL DEFAULT '[]',
      evidence_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  const runColumns = toRows(db, 'PRAGMA table_info(secretary_runs)')
  if (!runColumns.some((column) => text(column['name']) === 'plan_revision')) {
    db.run('ALTER TABLE secretary_runs ADD COLUMN plan_revision INTEGER NOT NULL DEFAULT 0')
  }
  if (!runColumns.some((column) => text(column['name']) === 'session_bindings_json')) {
    db.run("ALTER TABLE secretary_runs ADD COLUMN session_bindings_json TEXT NOT NULL DEFAULT '[]'")
  }
  if (!runColumns.some((column) => text(column['name']) === 'evidence_json')) {
    db.run('ALTER TABLE secretary_runs ADD COLUMN evidence_json TEXT')
  }
  db.run('CREATE INDEX IF NOT EXISTS secretary_runs_project ON secretary_runs (project_id, created_at DESC);')
  db.run('CREATE INDEX IF NOT EXISTS secretary_runs_thread ON secretary_runs (thread_id, created_at);')
  db.run('CREATE INDEX IF NOT EXISTS secretary_runs_status ON secretary_runs (status);')

  db.run(`
    CREATE TABLE IF NOT EXISTS secretary_assignments (
      run_id TEXT NOT NULL,
      assignment_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      status TEXT NOT NULL,
      assignment_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (run_id, assignment_id)
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS secretary_approvals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      plan_hash TEXT,
      decision TEXT NOT NULL,
      decided_at INTEGER NOT NULL
    );
  `)
  db.run('CREATE INDEX IF NOT EXISTS secretary_approvals_run ON secretary_approvals (run_id, decided_at DESC);')

  db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'secretary_schema_version',
    String(SECRETARY_SCHEMA_VERSION)
  ])
}

export interface SecretaryRunPatch {
  status?: SecretaryRunStatus
  reply?: string | null
  plan?: SecretaryPlan | null
  openKinds?: CliUsageKind[]
  errorCode?: string | null
  errorMessage?: string | null
  sessionBindings?: SecretarySessionBinding[]
  evidence?: SecretaryRunEvidence | null
}

export interface SecretaryStore {
  createThread(input: { projectId: string; title: string }): SecretaryThread
  listThreads(projectId: string): SecretaryThread[]
  getThread(id: string): SecretaryThread | null
  getThreadContextSummary(id: string): string
  setThreadContextSummary(id: string, summary: string): void
  appendMessage(input: {
    threadId: string
    runId?: string | null
    assignmentId?: string | null
    role: SecretaryMessageRole
    type: SecretaryMessageType
    content: string
  }): SecretaryMessage
  listMessages(threadId: string, limit?: number, before?: SecretaryMessageCursor): SecretaryMessage[]
  listContextMessages(threadId: string, limit?: number): SecretaryMessage[]
  createRun(input: { threadId: string; projectId: string; requestText: string }): SecretaryRun
  getRun(id: string): SecretaryRun | null
  listRuns(projectId: string, threadId?: string): SecretaryRun[]
  listRunsByIds(threadId: string, runIds: string[]): SecretaryRun[]
  countFollowUpRuns(threadId: string): number
  updateRun(id: string, patch: SecretaryRunPatch): SecretaryRun | null
  decidePlan(id: string, decision: 'approved' | 'rejected'): SecretaryRun | null
  markStaleRunsInterrupted(): number
  deleteExpired(cutoff: number): { runs: number; messages: number; assignments: number; approvals: number; threads: number }
}

export class SqlSecretaryStore implements SecretaryStore {
  constructor(private readonly db: Database) {}

  createThread(input: { projectId: string; title: string }): SecretaryThread {
    const now = Date.now()
    const thread: SecretaryThread = {
      id: randomUUID(),
      projectId: input.projectId,
      title: sanitizedText(input.title, 160) || 'Secretary conversation',
      status: 'active',
      createdAt: now,
      updatedAt: now
    }
    this.db.run(
      'INSERT INTO secretary_threads (id, project_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [thread.id, thread.projectId, thread.title, thread.status, thread.createdAt, thread.updatedAt]
    )
    schedulePersistToDisk()
    return thread
  }

  listThreads(projectId: string): SecretaryThread[] {
    return toRows(this.db, 'SELECT * FROM secretary_threads WHERE project_id = ? ORDER BY updated_at DESC', [projectId])
      .map(rowToThread)
      .filter((thread): thread is SecretaryThread => Boolean(thread))
  }

  getThread(id: string): SecretaryThread | null {
    const row = toRows(this.db, 'SELECT * FROM secretary_threads WHERE id = ?', [id])[0]
    return row ? rowToThread(row) : null
  }

  getThreadContextSummary(id: string): string {
    const row = toRows(this.db, 'SELECT context_summary FROM secretary_threads WHERE id = ?', [id])[0]
    return text(row?.['context_summary']) ?? ''
  }

  setThreadContextSummary(id: string, summary: string): void {
    const safe = sanitizedText(summary, 2_000)
    if (safe === this.getThreadContextSummary(id)) return
    this.db.run('UPDATE secretary_threads SET context_summary = ? WHERE id = ?', [safe, id])
    schedulePersistToDisk()
  }

  appendMessage(input: {
    threadId: string
    runId?: string | null
    assignmentId?: string | null
    role: SecretaryMessageRole
    type: SecretaryMessageType
    content: string
  }): SecretaryMessage {
    const now = Date.now()
    const message: SecretaryMessage = {
      id: randomUUID(),
      threadId: input.threadId,
      runId: input.runId ?? null,
      assignmentId: input.assignmentId ?? null,
      role: input.role,
      type: input.type,
      content: sanitizedText(input.content, 8_000),
      createdAt: now
    }
    this.db.run(
      'INSERT INTO secretary_messages (id, thread_id, run_id, assignment_id, role, type, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [message.id, message.threadId, message.runId, message.assignmentId, message.role, message.type, message.content, message.createdAt]
    )
    this.db.run('UPDATE secretary_threads SET updated_at = ? WHERE id = ?', [now, message.threadId])
    schedulePersistToDisk()
    return message
  }

  listMessages(threadId: string, limit = 100, before?: SecretaryMessageCursor): SecretaryMessage[] {
    const normalizedLimit = Math.min(Math.max(1, Math.floor(limit)), 200)
    return toRows(
      this.db,
      `SELECT * FROM secretary_messages WHERE thread_id = ?
       ${before ? 'AND (created_at < ? OR (created_at = ? AND id < ?))' : ''}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      before
        ? [threadId, before.createdAt, before.createdAt, before.id, normalizedLimit]
        : [threadId, normalizedLimit]
    )
      .map(rowToMessage)
      .filter((message): message is SecretaryMessage => Boolean(message))
      .reverse()
  }

  listContextMessages(threadId: string, limit = 20): SecretaryMessage[] {
    const normalizedLimit = Math.min(Math.max(1, Math.floor(limit)), 40)
    return toRows(
      this.db,
      "SELECT * FROM secretary_messages WHERE thread_id = ? AND type IN ('chat', 'final-report') ORDER BY created_at DESC, id DESC LIMIT ?",
      [threadId, normalizedLimit]
    )
      .map(rowToMessage)
      .filter((message): message is SecretaryMessage => Boolean(message))
      .reverse()
  }

  createRun(input: { threadId: string; projectId: string; requestText: string }): SecretaryRun {
    const now = Date.now()
    const run: SecretaryRun = {
      id: randomUUID(),
      threadId: input.threadId,
      projectId: input.projectId,
      status: 'planning',
      requestText: sanitizedText(input.requestText, 8_000),
      reply: null,
      plan: null,
      planRevision: 0,
      openKinds: [],
      errorCode: null,
      errorMessage: null,
      sessionBindings: [],
      evidence: null,
      createdAt: now,
      updatedAt: now
    }
    this.db.run(
      `INSERT INTO secretary_runs (
        id, thread_id, project_id, status, request_text, reply, plan_json, plan_revision, open_kinds_json,
        error_code, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, '[]', NULL, NULL, ?, ?)`,
      [run.id, run.threadId, run.projectId, run.status, run.requestText, run.createdAt, run.updatedAt]
    )
    schedulePersistToDisk()
    return run
  }

  getRun(id: string): SecretaryRun | null {
    const row = toRows(this.db, 'SELECT * FROM secretary_runs WHERE id = ?', [id])[0]
    return row ? rowToRun(row) : null
  }

  listRuns(projectId: string, threadId?: string): SecretaryRun[] {
    const sql = threadId
      ? 'SELECT * FROM secretary_runs WHERE project_id = ? AND thread_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM secretary_runs WHERE project_id = ? ORDER BY created_at DESC'
    const params = threadId ? [projectId, threadId] : [projectId]
    return toRows(this.db, sql, params)
      .map(rowToRun)
      .filter((run): run is SecretaryRun => Boolean(run))
  }

  listRunsByIds(threadId: string, runIds: string[]): SecretaryRun[] {
    const ids = [...new Set(runIds)].slice(0, 101)
    if (ids.length === 0) return []
    return toRows(
      this.db,
      `SELECT * FROM secretary_runs WHERE thread_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
      [threadId, ...ids]
    )
      .map(rowToRun)
      .filter((run): run is SecretaryRun => Boolean(run))
  }

  countFollowUpRuns(threadId: string): number {
    const row = toRows(
      this.db,
      'SELECT COUNT(*) AS total FROM secretary_runs WHERE thread_id = ? AND request_text LIKE ?',
      [threadId, 'Follow-up requested after CLI result for:%']
    )[0]
    return integer(row?.['total']) ?? 0
  }

  updateRun(id: string, patch: SecretaryRunPatch): SecretaryRun | null {
    const existing = this.getRun(id)
    if (!existing) return null
    if (patch.status !== undefined && !isValidSecretaryRunTransition(existing.status, patch.status)) return null
    const now = Date.now()
    const planChanged = patch.plan !== undefined
    const plan = planChanged ? sanitizePlan(patch.plan ?? null) : existing.plan
    const next: SecretaryRun = {
      ...existing,
      ...patch,
      ...(patch.reply !== undefined ? { reply: patch.reply === null ? null : sanitizedText(patch.reply, 8_000) } : {}),
      ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode === null ? null : sanitizedText(patch.errorCode, 120) } : {}),
      ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage === null ? null : sanitizedText(patch.errorMessage, 1_000) } : {}),
      plan,
      planRevision: planChanged ? existing.planRevision + 1 : existing.planRevision,
      openKinds: patch.openKinds === undefined ? existing.openKinds : parseOpenKinds(JSON.stringify(patch.openKinds)),
      sessionBindings: patch.sessionBindings === undefined
        ? existing.sessionBindings
        : parseSessionBindings(JSON.stringify(patch.sessionBindings)),
      evidence: patch.evidence === undefined
        ? existing.evidence
        : patch.evidence === null ? null : parseRunEvidence(redactSecrets(JSON.stringify(patch.evidence)).text),
      updatedAt: now
    }
    this.db.run(
      `UPDATE secretary_runs SET
        status = ?, reply = ?, plan_json = ?, plan_revision = ?, open_kinds_json = ?, error_code = ?, error_message = ?, session_bindings_json = ?, evidence_json = ?, updated_at = ?
      WHERE id = ?`,
      [
        next.status,
        next.reply,
        next.plan ? JSON.stringify(next.plan) : null,
        next.planRevision,
        JSON.stringify(next.openKinds),
        next.errorCode,
        next.errorMessage,
        JSON.stringify(next.sessionBindings),
        next.evidence ? JSON.stringify(next.evidence) : null,
        next.updatedAt,
        id
      ]
    )

    if (patch.plan !== undefined) {
      this.db.run('DELETE FROM secretary_assignments WHERE run_id = ?', [id])
      for (const [ordinal, assignment] of (next.plan?.assignments ?? []).entries()) {
        const assignmentJson = redactSecrets(JSON.stringify(assignment)).text
        this.db.run(
          `INSERT INTO secretary_assignments (run_id, assignment_id, ordinal, status, assignment_json, created_at, updated_at)
           VALUES (?, ?, ?, 'proposed', ?, ?, ?)`,
          [id, assignment.id, ordinal, assignmentJson, now, now]
        )
      }
    }
    schedulePersistToDisk()
    return next
  }

  decidePlan(id: string, decision: 'approved' | 'rejected'): SecretaryRun | null {
    const run = this.getRun(id)
    if (!run || run.status !== 'awaiting-approval') return null
    const now = Date.now()
    const hash = run.plan ? planHash(run.plan) : null
    this.db.run(
      'INSERT INTO secretary_approvals (id, run_id, plan_hash, decision, decided_at) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), run.id, hash, decision, now]
    )
    return this.updateRun(id, { status: decision === 'approved' ? 'approved' : 'rejected' })
  }

  markStaleRunsInterrupted(): number {
    const rows = toRows(this.db, "SELECT id FROM secretary_runs WHERE status IN ('planning', 'running', 'needs-user')")
    let interrupted = 0
    for (const row of rows) {
      const id = text(row['id'])
      if (!id) continue
      const run = this.getRun(id)
      const message = 'Bikorch restarted while this task was active, so its CLI result listener could not be restored. The CLI terminal may still be open; inspect it before starting another task.'
      const updated = this.updateRun(id, {
        status: 'interrupted',
        errorCode: 'APP_RESTARTED',
        errorMessage: message
      })
      if (!updated) continue
      interrupted += 1
      this.appendMessage({
        threadId: run?.threadId ?? updated.threadId,
        runId: id,
        role: 'assistant',
        type: 'error',
        content: message
      })
    }
    return interrupted
  }

  deleteExpired(cutoff: number): { runs: number; messages: number; assignments: number; approvals: number; threads: number } {
    const terminalStatuses = RETAINABLE_RUN_STATUSES.map(() => '?').join(', ')
    const deleteRows = (sql: string, params: unknown[]): number => {
      this.db.run(sql, params)
      return this.db.getRowsModified()
    }
    // Conversation text and run plans remain available across long projects.
    // These rows duplicate the plan/decision already present in secretary_runs.
    const assignments = deleteRows(
      `DELETE FROM secretary_assignments
       WHERE run_id IN (SELECT id FROM secretary_runs WHERE updated_at < ? AND status IN (${terminalStatuses}))`,
      [cutoff, ...RETAINABLE_RUN_STATUSES]
    )
    const approvals = deleteRows(
      `DELETE FROM secretary_approvals
       WHERE run_id IN (SELECT id FROM secretary_runs WHERE updated_at < ? AND status IN (${terminalStatuses}))`,
      [cutoff, ...RETAINABLE_RUN_STATUSES]
    )
    if (assignments || approvals) schedulePersistToDisk()
    return { runs: 0, messages: 0, assignments, approvals, threads: 0 }
  }
}

export function getSecretaryStore(): SecretaryStore | null {
  const db = getPersistenceDatabase()
  return db ? new SqlSecretaryStore(db) : null
}

export function messagesToChatTurns(messages: SecretaryMessage[]): SecretaryChatTurn[] {
  return messages
    .filter((message) => (message.type === 'chat' || message.type === 'final-report') && message.content.trim())
    .slice(-20)
    .map((message) => ({ role: message.role, content: message.content.slice(0, 2_400) }))
}
