import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import initSqlJs, { type Database } from 'sql.js'
import {
  type PersistedEditorState,
  type PersistedSnapshot,
  PERSISTENCE_SCHEMA_VERSION
} from '@shared/contracts/persistence'
import {
  type PanelDefinition,
  type PanelType,
  type Project,
  type ProjectWorkspaceState,
  type WorkspaceLayout,
  DEFAULT_LAYOUT,
  createDefaultPanels,
  sanitizeWorkspacePanels,
  normalizeLayoutForPanels
} from '@shared/types'
import {
  AI_ACCOUNT_KINDS,
  type AiAccount,
  createDefaultActiveAccountByKind,
  type ActiveAccountByKind
} from '@shared/contracts/accounts'
import type { ProjectTask, TaskPriority, TaskStatus } from '@shared/contracts/tasks'
import { v4 as uuidv4 } from 'uuid'

let db: Database | null = null
let dbFilePath: string | null = null

const VALID_PANEL_TYPES = new Set<PanelType>([
  'terminal',
  'claude',
  'cursor',
  'gemini',
  'antigravity',
  'codex',
  'chatgpt',
  'claude-chat',
  'file-explorer',
  'git-changes',
  'diff',
  'logs',
  'tasks'
])

function getDbPath(): string {
  const userData = app.getPath('userData')
  if (!existsSync(userData)) {
    mkdirSync(userData, { recursive: true })
  }
  return join(userData, 'workspace.db')
}

function getWasmPath(file: string): string {
  try {
    const require = createRequire(__filename)
    const sqlJsPath = require.resolve('sql.js/dist/sql-wasm.js')
    return join(dirname(sqlJsPath), file)
  } catch {
    return join(__dirname, '../../node_modules/sql.js/dist', file)
  }
}

function persistToDisk(): void {
  if (!db || !dbFilePath) return
  const data = db.export()
  writeFileSync(dbFilePath, Buffer.from(data))
}

function initSchema(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  database.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder_path TEXT,
      sort_order INTEGER NOT NULL
    );
  `)
  database.run(`
    CREATE TABLE IF NOT EXISTS project_workspaces (
      project_id TEXT PRIMARY KEY,
      panels_json TEXT NOT NULL,
      layout_json TEXT NOT NULL
    );
  `)
  database.run(`
    CREATE TABLE IF NOT EXISTS project_editor_state (
      project_id TEXT PRIMARY KEY,
      selected_file TEXT,
      active_diff_json TEXT
    );
  `)
  database.run(`
    CREATE TABLE IF NOT EXISTS project_tasks (
      project_id TEXT PRIMARY KEY,
      tasks_json TEXT NOT NULL
    );
  `)

  database.run('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)', [
    'schema_version',
    String(PERSISTENCE_SCHEMA_VERSION)
  ])
}

export async function initPersistenceDatabase(): Promise<void> {
  if (db) return

  try {
    const SQL = await initSqlJs({ locateFile: getWasmPath })
    dbFilePath = getDbPath()

    if (existsSync(dbFilePath)) {
      const fileBuffer = readFileSync(dbFilePath)
      db = new SQL.Database(fileBuffer)
    } else {
      db = new SQL.Database()
    }

    initSchema(db)
    persistToDisk()
  } catch (error) {
    console.error('Failed to initialize persistence database:', error)
    throw error
  }
}

export function closePersistenceDatabase(): void {
  if (db) {
    persistToDisk()
    db.close()
    db = null
  }
}

function getDb(): Database {
  if (!db) {
    throw new Error('Persistence database is not initialized')
  }
  return db
}

function parsePanels(raw: unknown): PanelDefinition[] {
  if (!Array.isArray(raw)) return createDefaultPanels()

  const panels: PanelDefinition[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const panel = item as PanelDefinition
    if (
      typeof panel.id === 'string' &&
      typeof panel.title === 'string' &&
      typeof panel.zone === 'string' &&
      VALID_PANEL_TYPES.has(panel.type as PanelType)
    ) {
      panels.push({
        id: panel.id,
        type: panel.type,
        title: panel.title,
        zone: panel.zone,
        ...(panel.launchMode === 'login' ? { launchMode: 'login' as const } : {}),
        ...(typeof panel.accountId === 'string' && panel.accountId.length <= 200
          ? { accountId: panel.accountId }
          : {})
      })
    }
  }

  return sanitizeWorkspacePanels(panels.length > 0 ? panels : createDefaultPanels())
}

function normalizeLeftSize(leftSize: number): number {
  // migrate previous default (22%) to the narrower sidebar default
  const size = leftSize === 22 ? DEFAULT_LAYOUT.leftSize : leftSize
  return Math.min(Math.max(size, 10), 32)
}

function parseLayout(raw: unknown): WorkspaceLayout {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LAYOUT }
  const layout = raw as WorkspaceLayout
  const leftSize = normalizeLeftSize(
    typeof layout.leftSize === 'number' ? layout.leftSize : DEFAULT_LAYOUT.leftSize
  )
  return {
    leftSize,
    centerSize:
      typeof layout.centerSize === 'number' ? layout.centerSize : DEFAULT_LAYOUT.centerSize,
    rightSize: typeof layout.rightSize === 'number' ? layout.rightSize : DEFAULT_LAYOUT.rightSize,
    bottomSize: typeof layout.bottomSize === 'number' ? layout.bottomSize : DEFAULT_LAYOUT.bottomSize,
    mainVerticalSize:
      typeof layout.mainVerticalSize === 'number'
        ? layout.mainVerticalSize
        : DEFAULT_LAYOUT.mainVerticalSize,
    leftCollapsed:
      typeof layout.leftCollapsed === 'boolean'
        ? layout.leftCollapsed
        : DEFAULT_LAYOUT.leftCollapsed,
    leftSidebarView:
      layout.leftSidebarView === 'changes'
        ? 'changes'
        : layout.leftSidebarView === 'accounts'
          ? 'accounts'
          : 'files',
    orchestratorDirection:
      layout.orchestratorDirection === 'horizontal' ||
      layout.orchestratorDirection === 'vertical'
        ? layout.orchestratorDirection
        : DEFAULT_LAYOUT.orchestratorDirection,
    centerPanelSizes:
      layout.centerPanelSizes && typeof layout.centerPanelSizes === 'object'
        ? (layout.centerPanelSizes as Record<string, number>)
        : DEFAULT_LAYOUT.centerPanelSizes,
    centerPanelRects:
      layout.centerPanelRects && typeof layout.centerPanelRects === 'object'
        ? layout.centerPanelRects
        : DEFAULT_LAYOUT.centerPanelRects
  }
}

function parseAccounts(raw: unknown): AiAccount[] {
  if (!Array.isArray(raw)) return []

  return raw.flatMap((item): AiAccount[] => {
    if (!item || typeof item !== 'object') return []
    const account = item as Partial<AiAccount>
    if (
      typeof account.id !== 'string' ||
      typeof account.kind !== 'string' ||
      !AI_ACCOUNT_KINDS.includes(account.kind as AiAccount['kind']) ||
      typeof account.name !== 'string'
    ) {
      return []
    }

    return [
      {
        id: account.id,
        kind: account.kind as AiAccount['kind'],
        name: account.name,
        email: typeof account.email === 'string' ? account.email : '',
        plan: typeof account.plan === 'string' ? account.plan : '',
        note: typeof account.note === 'string' ? account.note : '',
        createdAt: typeof account.createdAt === 'number' ? account.createdAt : Date.now(),
        source: account.source === 'discovered' ? 'discovered' : 'manual',
        lastSeenAt: typeof account.lastSeenAt === 'number' ? account.lastSeenAt : null,
        profileReady: account.profileReady === true,
        lastAuthenticatedAt:
          typeof account.lastAuthenticatedAt === 'number' ? account.lastAuthenticatedAt : null
      }
    ]
  })
}

function parseActiveAccountByKind(raw: unknown, accounts: AiAccount[]): ActiveAccountByKind {
  const defaults = createDefaultActiveAccountByKind()
  if (!raw || typeof raw !== 'object') return defaults

  const active = raw as Partial<ActiveAccountByKind>
  for (const kind of AI_ACCOUNT_KINDS) {
    const accountId = active[kind]
    defaults[kind] =
      typeof accountId === 'string' && accounts.some((account) => account.id === accountId)
        ? accountId
        : null
  }
  return defaults
}

function parseTasks(raw: unknown): ProjectTask[] {
  if (!Array.isArray(raw)) return []

  return raw.flatMap((item): ProjectTask[] => {
    if (!item || typeof item !== 'object') return []
    const task = item as Partial<ProjectTask>
    if (
      typeof task.id !== 'string' ||
      task.id.length === 0 ||
      task.id.length > 100 ||
      typeof task.title !== 'string' ||
      task.title.trim().length === 0 ||
      task.title.length > 500
    ) {
      return []
    }

    const status: TaskStatus =
      task.status === 'in-progress' || task.status === 'done' ? task.status : 'todo'
    const priority: TaskPriority =
      task.priority === 'low' || task.priority === 'high' ? task.priority : 'medium'

    return [
      {
        id: task.id,
        title: task.title.trim(),
        status,
        priority,
        createdAt: typeof task.createdAt === 'number' ? task.createdAt : Date.now(),
        updatedAt: typeof task.updatedAt === 'number' ? task.updatedAt : Date.now()
      }
    ]
  })
}

export function createDefaultSnapshot(): PersistedSnapshot {
  return {
    projects: [],
    activeProjectId: null,
    workspaces: {},
    editor: {
      selectedFileByProject: {},
      activeDiffByProject: {}
    },
    accounts: [],
    activeAccountByKind: createDefaultActiveAccountByKind(),
    tasksByProject: {}
  }
}

export function loadSnapshot(): PersistedSnapshot {
  const database = getDb()

  const projectResult = database.exec(
    'SELECT id, name, folder_path, sort_order FROM projects ORDER BY sort_order ASC'
  )

  if (projectResult.length === 0 || projectResult[0]?.values.length === 0) {
    const defaultSnapshot = createDefaultSnapshot()
    saveSnapshot(defaultSnapshot)
    return defaultSnapshot
  }

  const projectRows = projectResult[0].values as Array<[string, string, string | null, number]>
  const projects: Project[] = projectRows.map(([id, name, folderPath]) => ({
    id,
    name,
    folderPath
  }))

  const workspaces: Record<string, ProjectWorkspaceState> = {}

  for (const project of projects) {
    const stmt = database.prepare(
      'SELECT panels_json, layout_json FROM project_workspaces WHERE project_id = ?'
    )
    stmt.bind([project.id])
    const hasRow = stmt.step()

    if (hasRow) {
      const [panelsJson, layoutJson] = stmt.get() as [string, string]
      const panels = parsePanels(JSON.parse(panelsJson))
      workspaces[project.id] = {
        projectId: project.id,
        panels,
        layout: normalizeLayoutForPanels(parseLayout(JSON.parse(layoutJson)), panels)
      }
    } else {
      workspaces[project.id] = {
        projectId: project.id,
        panels: createDefaultPanels(),
        layout: { ...DEFAULT_LAYOUT }
      }
    }
    stmt.free()
  }

  const activeResult = database.exec(
    "SELECT value FROM meta WHERE key = 'active_project_id'"
  )
  const activeValue =
    activeResult.length > 0 && activeResult[0]?.values.length > 0
      ? (activeResult[0].values[0][0] as string)
      : null

  const activeProjectId =
    activeValue && projects.some((p) => p.id === activeValue)
      ? activeValue
      : projects[0]?.id ?? null

  const editor: PersistedEditorState = {
    selectedFileByProject: {},
    activeDiffByProject: {}
  }

  const editorResult = database.exec(
    'SELECT project_id, selected_file, active_diff_json FROM project_editor_state'
  )

  if (editorResult.length > 0) {
    for (const row of editorResult[0].values as Array<[string, string | null, string | null]>) {
      const [projectId, selectedFile, activeDiffJson] = row
      editor.selectedFileByProject[projectId] = selectedFile
      if (activeDiffJson) {
        try {
          editor.activeDiffByProject[projectId] = JSON.parse(activeDiffJson)
        } catch {
          editor.activeDiffByProject[projectId] = null
        }
      }
    }
  }

  const accountsResult = database.exec("SELECT value FROM meta WHERE key = 'ai_accounts'")
  let accounts: AiAccount[] = []
  if (accountsResult.length > 0 && accountsResult[0]?.values.length > 0) {
    try {
      accounts = parseAccounts(JSON.parse(accountsResult[0].values[0][0] as string))
    } catch {
      accounts = []
    }
  }

  const activeAccountsResult = database.exec(
    "SELECT value FROM meta WHERE key = 'active_ai_accounts'"
  )
  let activeAccountByKind = createDefaultActiveAccountByKind()
  if (activeAccountsResult.length > 0 && activeAccountsResult[0]?.values.length > 0) {
    try {
      activeAccountByKind = parseActiveAccountByKind(
        JSON.parse(activeAccountsResult[0].values[0][0] as string),
        accounts
      )
    } catch {
      activeAccountByKind = createDefaultActiveAccountByKind()
    }
  }

  const tasksByProject: Record<string, ProjectTask[]> = {}
  const tasksResult = database.exec('SELECT project_id, tasks_json FROM project_tasks')
  if (tasksResult.length > 0) {
    for (const row of tasksResult[0].values as Array<[string, string]>) {
      const [projectId, tasksJson] = row
      try {
        tasksByProject[projectId] = parseTasks(JSON.parse(tasksJson))
      } catch {
        tasksByProject[projectId] = []
      }
    }
  }

  return {
    projects,
    activeProjectId,
    workspaces,
    editor,
    accounts,
    activeAccountByKind,
    tasksByProject
  }
}

export function saveSnapshot(snapshot: PersistedSnapshot): void {
  const database = getDb()

  database.run('BEGIN TRANSACTION')

  try {
    database.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
      'ai_accounts',
      JSON.stringify(snapshot.accounts ?? [])
    ])
    database.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
      'active_ai_accounts',
      JSON.stringify(snapshot.activeAccountByKind ?? createDefaultActiveAccountByKind())
    ])
    database.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
      'active_project_id',
      snapshot.activeProjectId ?? ''
    ])

    const existingResult = database.exec('SELECT id FROM projects')
    const existingIds =
      existingResult.length > 0
        ? (existingResult[0].values.map((row: unknown[]) => row[0]) as string[])
        : []

    const incomingIds = new Set(snapshot.projects.map((p) => p.id))

    for (const id of existingIds) {
      if (!incomingIds.has(id)) {
        database.run('DELETE FROM projects WHERE id = ?', [id])
        database.run('DELETE FROM project_workspaces WHERE project_id = ?', [id])
        database.run('DELETE FROM project_editor_state WHERE project_id = ?', [id])
        database.run('DELETE FROM project_tasks WHERE project_id = ?', [id])
      }
    }

    snapshot.projects.forEach((project, index) => {
      database.run(
        'INSERT OR REPLACE INTO projects (id, name, folder_path, sort_order) VALUES (?, ?, ?, ?)',
        [project.id, project.name, project.folderPath, index]
      )

      const workspace = snapshot.workspaces[project.id] ?? {
        projectId: project.id,
        panels: createDefaultPanels(),
        layout: { ...DEFAULT_LAYOUT }
      }

      database.run(
        'INSERT OR REPLACE INTO project_workspaces (project_id, panels_json, layout_json) VALUES (?, ?, ?)',
        [project.id, JSON.stringify(workspace.panels), JSON.stringify(workspace.layout)]
      )

      const activeDiff = snapshot.editor.activeDiffByProject[project.id] ?? null

      database.run(
        'INSERT OR REPLACE INTO project_editor_state (project_id, selected_file, active_diff_json) VALUES (?, ?, ?)',
        [
          project.id,
          snapshot.editor.selectedFileByProject[project.id] ?? null,
          activeDiff ? JSON.stringify(activeDiff) : null
        ]
      )

      database.run(
        'INSERT OR REPLACE INTO project_tasks (project_id, tasks_json) VALUES (?, ?)',
        [project.id, JSON.stringify(snapshot.tasksByProject?.[project.id] ?? [])]
      )
    })

    database.run('COMMIT')
    persistToDisk()
  } catch (error) {
    database.run('ROLLBACK')
    throw error
  }
}
