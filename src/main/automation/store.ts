import type { Database } from 'sql.js'
import { getPersistenceDatabase, schedulePersistToDisk } from '../persistence/database'
import {
  AUTOMATION_ACTIVE_RUN_STATUSES,
  AUTOMATION_SCHEMA_VERSION,
  createDefaultAutomationSettings,
  validateAutomationSchedule,
  type AutomationDefinition,
  type AutomationExecutorKind,
  type AutomationNetworkPolicy,
  type AutomationPermissionProfile,
  type AutomationRun,
  type AutomationRunStatus,
  type AutomationRunTrigger,
  type AutomationSchedule,
  type AutomationSettings,
  type AutomationWorktreeMode
} from '@shared/contracts/automation'

type Row = Record<string, unknown>

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function integer(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value)
  return null
}

function bool(value: unknown): boolean {
  return value === 1 || value === true
}

export function initAutomationSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS automation_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      project_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      executor_kind TEXT NOT NULL,
      account_id TEXT,
      schedule_json TEXT NOT NULL,
      time_zone TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      worktree_mode TEXT NOT NULL,
      permission_profile TEXT NOT NULL,
      network_policy TEXT NOT NULL,
      timeout_ms INTEGER NOT NULL,
      max_retries INTEGER NOT NULL DEFAULT 1,
      next_run_at INTEGER,
      pending_catch_up INTEGER NOT NULL DEFAULT 0,
      pending_scheduled_for INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  db.run(
    'CREATE INDEX IF NOT EXISTS automation_definitions_enabled_next_run ON automation_definitions (enabled, next_run_at);'
  )
  db.run(
    'CREATE INDEX IF NOT EXISTS automation_definitions_project ON automation_definitions (project_id, enabled);'
  )
  db.run(
    'CREATE INDEX IF NOT EXISTS automation_definitions_pending ON automation_definitions (pending_catch_up);'
  )

  db.run(`
    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      trigger TEXT NOT NULL,
      scheduled_for INTEGER,
      slot_key TEXT,
      status TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER,
      finished_at INTEGER,
      exit_code INTEGER,
      provider_session_id TEXT,
      worktree_path TEXT,
      summary TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  db.run(
    'CREATE UNIQUE INDEX IF NOT EXISTS automation_runs_slot ON automation_runs (automation_id, slot_key) WHERE slot_key IS NOT NULL;'
  )
  db.run('CREATE INDEX IF NOT EXISTS automation_runs_automation ON automation_runs (automation_id);')
  db.run('CREATE INDEX IF NOT EXISTS automation_runs_status ON automation_runs (status);')

  db.run(`
    CREATE TABLE IF NOT EXISTS automation_run_events (
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      occurred_at INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT,
      PRIMARY KEY (run_id, sequence)
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS automation_settings (
      id TEXT PRIMARY KEY DEFAULT 'default',
      background_mode INTEGER NOT NULL DEFAULT 0,
      start_at_login INTEGER NOT NULL DEFAULT 0,
      notify_on_success INTEGER NOT NULL DEFAULT 0,
      notify_on_failure INTEGER NOT NULL DEFAULT 1,
      global_pause INTEGER NOT NULL DEFAULT 0,
      concurrency INTEGER NOT NULL DEFAULT 2,
      run_retention_days INTEGER NOT NULL DEFAULT 90,
      event_retention_days INTEGER NOT NULL DEFAULT 30,
      tab_education_shown INTEGER NOT NULL DEFAULT 0
    );
  `)

  db.run('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)', [
    'automation_schema_version',
    String(AUTOMATION_SCHEMA_VERSION)
  ])
}

function rowToDefinition(row: Row): AutomationDefinition | null {
  const id = text(row['id'])
  const name = text(row['name'])
  const projectId = text(row['project_id'])
  const prompt = text(row['prompt'])
  const executorKind = text(row['executor_kind']) as AutomationExecutorKind | null
  const scheduleJson = text(row['schedule_json'])
  const timeZone = text(row['time_zone'])
  const worktreeMode = text(row['worktree_mode']) as AutomationWorktreeMode | null
  const permissionProfile = text(row['permission_profile']) as AutomationPermissionProfile | null
  const networkPolicy = text(row['network_policy']) as AutomationNetworkPolicy | null
  const timeoutMs = integer(row['timeout_ms'])
  const createdAt = integer(row['created_at'])
  const updatedAt = integer(row['updated_at'])

  if (
    !id ||
    !name ||
    !projectId ||
    !prompt ||
    !executorKind ||
    !scheduleJson ||
    !timeZone ||
    !worktreeMode ||
    !permissionProfile ||
    !networkPolicy ||
    timeoutMs === null ||
    createdAt === null ||
    updatedAt === null
  ) {
    return null
  }

  let schedule: AutomationSchedule
  try {
    schedule = JSON.parse(scheduleJson) as AutomationSchedule
  } catch {
    return null
  }
  if (!validateAutomationSchedule(schedule)) return null

  return {
    id,
    name,
    projectId,
    prompt,
    executorKind,
    accountId: text(row['account_id']),
    schedule,
    timeZone,
    enabled: bool(row['enabled']),
    worktreeMode,
    permissionProfile,
    networkPolicy,
    timeoutMs,
    maxRetries: integer(row['max_retries']) ?? 1,
    nextRunAt: integer(row['next_run_at']),
    pendingCatchUp: bool(row['pending_catch_up']),
    pendingScheduledFor: integer(row['pending_scheduled_for']),
    createdAt,
    updatedAt
  }
}

function rowToRun(row: Row): AutomationRun | null {
  const id = text(row['id'])
  const automationId = text(row['automation_id'])
  const projectId = text(row['project_id'])
  const trigger = text(row['trigger']) as AutomationRunTrigger | null
  const status = text(row['status']) as AutomationRunStatus | null
  const createdAt = integer(row['created_at'])
  const updatedAt = integer(row['updated_at'])

  if (!id || !automationId || !projectId || !trigger || !status || createdAt === null || updatedAt === null) {
    return null
  }

  return {
    id,
    automationId,
    projectId,
    trigger,
    scheduledFor: integer(row['scheduled_for']),
    slotKey: text(row['slot_key']),
    status,
    attempt: integer(row['attempt']) ?? 0,
    startedAt: integer(row['started_at']),
    finishedAt: integer(row['finished_at']),
    exitCode: integer(row['exit_code']),
    providerSessionId: text(row['provider_session_id']),
    worktreePath: text(row['worktree_path']),
    summary: text(row['summary']),
    errorCode: text(row['error_code']),
    errorMessage: text(row['error_message']),
    createdAt,
    updatedAt
  }
}

function toRows(db: Database, sql: string, params: unknown[] = []): Row[] {
  const stmt = db.prepare(sql)
  stmt.bind(params as never)
  const rows: Row[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as Row)
  }
  stmt.free()
  return rows
}

export interface AutomationDefinitionRepository {
  list(): AutomationDefinition[]
  listEnabled(): AutomationDefinition[]
  get(id: string): AutomationDefinition | null
  upsert(definition: AutomationDefinition): void
  remove(id: string): void
  setNextRunAt(id: string, nextRunAt: number | null): void
  markCatchUpPending(id: string, scheduledFor: number): void
  clearCatchUp(id: string): void
  setEnabled(id: string, enabled: boolean): void
}

export class SqlAutomationDefinitionRepository implements AutomationDefinitionRepository {
  constructor(private readonly db: Database) {}

  list(): AutomationDefinition[] {
    return toRows(this.db, 'SELECT * FROM automation_definitions ORDER BY created_at DESC')
      .map(rowToDefinition)
      .filter((item): item is AutomationDefinition => Boolean(item))
  }

  listEnabled(): AutomationDefinition[] {
    return this.list().filter((definition) => definition.enabled)
  }

  get(id: string): AutomationDefinition | null {
    const rows = toRows(this.db, 'SELECT * FROM automation_definitions WHERE id = ?', [id])
    return rows[0] ? rowToDefinition(rows[0]) : null
  }

  upsert(definition: AutomationDefinition): void {
    this.db.run(
      `INSERT OR REPLACE INTO automation_definitions (
        id, name, project_id, prompt, executor_kind, account_id, schedule_json, time_zone,
        enabled, worktree_mode, permission_profile, network_policy, timeout_ms, max_retries,
        next_run_at, pending_catch_up, pending_scheduled_for, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        definition.id,
        definition.name,
        definition.projectId,
        definition.prompt,
        definition.executorKind,
        definition.accountId,
        JSON.stringify(definition.schedule),
        definition.timeZone,
        definition.enabled ? 1 : 0,
        definition.worktreeMode,
        definition.permissionProfile,
        definition.networkPolicy,
        definition.timeoutMs,
        definition.maxRetries,
        definition.nextRunAt,
        definition.pendingCatchUp ? 1 : 0,
        definition.pendingScheduledFor,
        definition.createdAt,
        definition.updatedAt
      ]
    )
    schedulePersistToDisk()
  }

  remove(id: string): void {
    this.db.run('DELETE FROM automation_definitions WHERE id = ?', [id])
    this.db.run('DELETE FROM automation_runs WHERE automation_id = ?', [id])
    schedulePersistToDisk()
  }

  setNextRunAt(id: string, nextRunAt: number | null): void {
    this.db.run('UPDATE automation_definitions SET next_run_at = ?, updated_at = ? WHERE id = ?', [
      nextRunAt,
      Date.now(),
      id
    ])
    schedulePersistToDisk()
  }

  markCatchUpPending(id: string, scheduledFor: number): void {
    this.db.run(
      'UPDATE automation_definitions SET pending_catch_up = 1, pending_scheduled_for = ?, updated_at = ? WHERE id = ?',
      [scheduledFor, Date.now(), id]
    )
    schedulePersistToDisk()
  }

  clearCatchUp(id: string): void {
    this.db.run(
      'UPDATE automation_definitions SET pending_catch_up = 0, pending_scheduled_for = NULL, updated_at = ? WHERE id = ?',
      [Date.now(), id]
    )
    schedulePersistToDisk()
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db.run('UPDATE automation_definitions SET enabled = ?, updated_at = ? WHERE id = ?', [
      enabled ? 1 : 0,
      Date.now(),
      id
    ])
    schedulePersistToDisk()
  }
}

export interface AutomationRunRepository {
  list(automationId?: string): AutomationRun[]
  get(id: string): AutomationRun | null
  hasActiveRun(automationId: string): boolean
  /** Returns false if a run already exists for this automation+slot (idempotent claim). */
  claim(input: {
    id: string
    automationId: string
    projectId: string
    trigger: AutomationRunTrigger
    scheduledFor: number | null
    slotKey: string | null
  }): boolean
  update(id: string, patch: Partial<AutomationRun>): void
  markStaleActiveRunsInterrupted(): number
}

export class SqlAutomationRunRepository implements AutomationRunRepository {
  constructor(private readonly db: Database) {}

  list(automationId?: string): AutomationRun[] {
    const rows = automationId
      ? toRows(
          this.db,
          'SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY created_at DESC',
          [automationId]
        )
      : toRows(this.db, 'SELECT * FROM automation_runs ORDER BY created_at DESC')
    return rows.map(rowToRun).filter((item): item is AutomationRun => Boolean(item))
  }

  get(id: string): AutomationRun | null {
    const rows = toRows(this.db, 'SELECT * FROM automation_runs WHERE id = ?', [id])
    return rows[0] ? rowToRun(rows[0]) : null
  }

  hasActiveRun(automationId: string): boolean {
    const placeholders = AUTOMATION_ACTIVE_RUN_STATUSES.map(() => '?').join(', ')
    const rows = toRows(
      this.db,
      `SELECT id FROM automation_runs WHERE automation_id = ? AND status IN (${placeholders}) LIMIT 1`,
      [automationId, ...AUTOMATION_ACTIVE_RUN_STATUSES]
    )
    return rows.length > 0
  }

  claim(input: {
    id: string
    automationId: string
    projectId: string
    trigger: AutomationRunTrigger
    scheduledFor: number | null
    slotKey: string | null
  }): boolean {
    const now = Date.now()
    try {
      this.db.run(
        `INSERT INTO automation_runs (
          id, automation_id, project_id, trigger, scheduled_for, slot_key, status, attempt,
          started_at, finished_at, exit_code, provider_session_id, worktree_path, summary,
          error_code, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
        [
          input.id,
          input.automationId,
          input.projectId,
          input.trigger,
          input.scheduledFor,
          input.slotKey,
          now,
          now
        ]
      )
      schedulePersistToDisk()
      return true
    } catch {
      // Unique (automation_id, slot_key) violation means this slot was already claimed.
      return false
    }
  }

  update(id: string, patch: Partial<AutomationRun>): void {
    const existing = this.get(id)
    if (!existing) return
    const next: AutomationRun = { ...existing, ...patch, updatedAt: Date.now() }
    this.db.run(
      `UPDATE automation_runs SET
        status = ?, attempt = ?, started_at = ?, finished_at = ?, exit_code = ?,
        provider_session_id = ?, worktree_path = ?, summary = ?, error_code = ?,
        error_message = ?, updated_at = ?
      WHERE id = ?`,
      [
        next.status,
        next.attempt,
        next.startedAt,
        next.finishedAt,
        next.exitCode,
        next.providerSessionId,
        next.worktreePath,
        next.summary,
        next.errorCode,
        next.errorMessage,
        next.updatedAt,
        id
      ]
    )
    schedulePersistToDisk()
  }

  markStaleActiveRunsInterrupted(): number {
    const rows = toRows(this.db, "SELECT id FROM automation_runs WHERE status IN ('preparing', 'running')")
    for (const row of rows) {
      const id = text(row['id'])
      if (id) this.update(id, { status: 'interrupted' })
    }
    return rows.length
  }
}

function rowToSettings(row: Row | undefined): AutomationSettings {
  if (!row) return createDefaultAutomationSettings()
  return {
    backgroundMode: bool(row['background_mode']),
    startAtLogin: bool(row['start_at_login']),
    notifyOnSuccess: bool(row['notify_on_success']),
    notifyOnFailure: bool(row['notify_on_failure']),
    globalPause: bool(row['global_pause']),
    concurrency: integer(row['concurrency']) ?? 2,
    runRetentionDays: integer(row['run_retention_days']) ?? 90,
    eventRetentionDays: integer(row['event_retention_days']) ?? 30,
    tabEducationShown: bool(row['tab_education_shown'])
  }
}

export interface AutomationSettingsRepository {
  get(): AutomationSettings
  update(patch: Partial<AutomationSettings>): AutomationSettings
}

export class SqlAutomationSettingsRepository implements AutomationSettingsRepository {
  constructor(private readonly db: Database) {}

  get(): AutomationSettings {
    const rows = toRows(this.db, "SELECT * FROM automation_settings WHERE id = 'default'")
    return rowToSettings(rows[0])
  }

  update(patch: Partial<AutomationSettings>): AutomationSettings {
    const next = { ...this.get(), ...patch }
    this.db.run(
      `INSERT OR REPLACE INTO automation_settings (
        id, background_mode, start_at_login, notify_on_success, notify_on_failure,
        global_pause, concurrency, run_retention_days, event_retention_days, tab_education_shown
      ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        next.backgroundMode ? 1 : 0,
        next.startAtLogin ? 1 : 0,
        next.notifyOnSuccess ? 1 : 0,
        next.notifyOnFailure ? 1 : 0,
        next.globalPause ? 1 : 0,
        next.concurrency,
        next.runRetentionDays,
        next.eventRetentionDays,
        next.tabEducationShown ? 1 : 0
      ]
    )
    schedulePersistToDisk()
    return next
  }
}

export function getAutomationDefinitionRepository(): AutomationDefinitionRepository | null {
  const db = getPersistenceDatabase()
  return db ? new SqlAutomationDefinitionRepository(db) : null
}

export function getAutomationRunRepository(): AutomationRunRepository | null {
  const db = getPersistenceDatabase()
  return db ? new SqlAutomationRunRepository(db) : null
}

export function getAutomationSettingsRepository(): AutomationSettingsRepository | null {
  const db = getPersistenceDatabase()
  return db ? new SqlAutomationSettingsRepository(db) : null
}
