import type { CliUsageInfo, CliUsageKind } from './usage'

export const SECRETARY_SCHEMA_VERSION = 6

export type SecretaryThreadStatus = 'active' | 'archived'

export type SecretaryRunStatus =
  | 'planning'
  | 'awaiting-approval'
  | 'approved'
  | 'running'
  | 'needs-user'
  | 'completed'
  | 'rejected'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

/** How the Secretary learned that a CLI assignment had finished. Neither value is independent validation. */
export type SecretaryCompletionEvidence = 'cli-reported' | 'terminal-idle-inferred'

/** A terminal completion signal never proves the requested work succeeded. */
export type SecretaryVerificationLevel = 'git-observed' | 'cli-reported' | 'inferred'

export interface SecretarySessionBinding {
  assignmentId: string
  sessionId: string
  accountId: string | null
}

export interface SecretaryRunEvidence {
  capturedAt: number
  verificationLevel: SecretaryVerificationLevel
  changedFiles: string[]
  unverifiedReportedFiles: string[]
  assignments: Array<{
    assignmentId: string
    sessionId: string
    accountId: string | null
    kind: CliUsageKind
    title: string
    outcome: 'completed' | 'failed' | 'needs-user'
    completionEvidence: SecretaryCompletionEvidence
    changedFiles: string[]
    preexistingChangedFiles: string[]
    commits: Array<{ shortHash: string; subject: string }>
    /** git diff --check HEAD checks tracked patch whitespace, not tests or untracked files. */
    patchCheckExitCode: number | null
  }>
}

export type SecretaryMessageRole = 'user' | 'assistant'

export type SecretaryMessageType = 'chat' | 'plan' | 'approval' | 'needs-user' | 'final-report' | 'error'

export interface SecretaryProjectRef {
  id: string
  name: string
  folderPath: string | null
}

export type ManagerProviderSource = 'api' | 'cli'

/** Shown when CLI cannot yet return a normalized Manager response. Never a fake success. */
export const CLI_MANAGER_PROVIDER_UNAVAILABLE = 'CLI Manager provider is not available yet'

export interface ManagerProviderSettings {
  source: ManagerProviderSource
  api: {
    provider: 'openai'
    model: string
  }
  cli: {
    kind: CliUsageKind | null
    accountId: string | null
    model: string | null
  }
  fallbackToApi: boolean
}

export interface ManagerProviderPatch {
  source?: ManagerProviderSource
  api?: { model?: string }
  cli?: {
    kind?: CliUsageKind | null
    accountId?: string | null
    model?: string | null
  }
  fallbackToApi?: boolean
}

export type ManagerApiConnectionStatus =
  | 'configured'
  | 'connected'
  | 'invalid-key'
  | 'unreachable'
  | 'not-configured'

export type ManagerCliConnectionStatus =
  | 'ready'
  | 'cli-unavailable'
  | 'account-unavailable'
  | 'authentication-required'
  | 'unavailable'

export const MANAGER_API_STATUS_LABEL: Record<ManagerApiConnectionStatus, string> = {
  configured: 'Configured',
  connected: 'Connected',
  'invalid-key': 'Invalid API key',
  unreachable: 'Connection failed',
  'not-configured': 'No API key'
}

export const MANAGER_CLI_STATUS_LABEL: Record<ManagerCliConnectionStatus, string> = {
  ready: 'Ready',
  'cli-unavailable': 'CLI not installed',
  'account-unavailable': 'No account selected',
  'authentication-required': 'Authentication required',
  unavailable: 'Unavailable'
}

/** Renderer view. The API key stays in secure storage and is never part of this object. */
export interface ManagerProviderView extends ManagerProviderSettings {
  api: ManagerProviderSettings['api'] & {
    hasKey: boolean
    status: ManagerApiConnectionStatus
    statusLabel: string
  }
  cli: ManagerProviderSettings['cli'] & {
    status: ManagerCliConnectionStatus
    statusLabel: string
    generationAvailable: boolean
    /** Thinking session owned by Manager. Coding-agent PTY sessions are never reused. */
    session: 'dedicated-manager'
  }
}

export interface ManagerConnectionTest {
  source: ManagerProviderSource
  status: ManagerApiConnectionStatus | ManagerCliConnectionStatus
  message: string
}

export function defaultManagerProviderView(model = 'gpt-5'): ManagerProviderView {
  return {
    source: 'api',
    api: {
      provider: 'openai',
      model,
      hasKey: false,
      status: 'not-configured',
      statusLabel: MANAGER_API_STATUS_LABEL['not-configured']
    },
    cli: {
      kind: null,
      accountId: null,
      model: null,
      status: 'account-unavailable',
      statusLabel: MANAGER_CLI_STATUS_LABEL['account-unavailable'],
      generationAvailable: true,
      session: 'dedicated-manager'
    },
    fallbackToApi: false
  }
}

export interface SecretarySettings {
  configured: boolean
  model: string
  usage: SecretaryUsageStats
  provider: ManagerProviderView
}

export interface SecretaryUsageStats {
  requests: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd: number | null
  lastRequestAt: number | null
}

export interface SecretaryPanelContext {
  id: string
  kind: CliUsageKind
  accountId?: string
  title: string
  status: 'waiting' | 'busy' | 'stopped' | 'error' | 'starting' | 'running'
}

export interface SecretaryPlanRequest {
  project: SecretaryProjectRef
  brief: string
  panels: SecretaryPanelContext[]
  usage: CliUsageInfo[]
}

export const SECRETARY_ASSIGNMENT_MODES = ['analyze', 'implement', 'review', 'validate'] as const
export type SecretaryAssignmentMode = typeof SECRETARY_ASSIGNMENT_MODES[number]

export interface SecretaryAssignment {
  id: string
  panelId: string | null
  kind: CliUsageKind
  /** Defines how this CLI contributes to the orchestration instead of treating every prompt alike. */
  mode: SecretaryAssignmentMode
  title: string
  instruction: string
  /** Concrete completion evidence the Secretary will evaluate after the CLI responds. */
  expectedResult: string
  rationale: string
  usageNote: string
  /** Validated assignment IDs that must complete before this task starts. */
  dependsOn?: string[]
}

export interface SecretaryPlan {
  overview: string
  assumptions: string[]
  assignments: SecretaryAssignment[]
  approvalRequired: true
}

export interface SecretaryChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface SecretaryChatRequest {
  project: SecretaryProjectRef
  /** Omitting this starts a new persisted project thread when storage is available. */
  threadId?: string
  message: string
  history: SecretaryChatTurn[]
  panels: SecretaryPanelContext[]
  usage: CliUsageInfo[]
}

export interface SecretaryChatResponse {
  reply: string
  plan: SecretaryPlan | null
  openKinds: CliUsageKind[]
  /** Present when the local persistence database is available. */
  threadId?: string
  /** Present when the local persistence database is available. */
  runId?: string
  runStatus?: SecretaryRunStatus
  /** Version of the persisted plan when a run was created. */
  planRevision?: number
  /** Set when this turn saved or updated developer skills. */
  savedSkills?: { id: string; name: string }[]
  /** Surfaces Manager opened in this turn. CLI prompts still require plan approval. */
  actions?: ManagerAppAction[]
}

/** One practical lesson for a local calendar day, written from work memories. */
export interface DailyLearnLesson {
  date: string
  topic: string
  body: string
  basis: string
}

export type DailyLearnView =
  | { status: 'ready'; lesson: DailyLearnLesson }
  | { status: 'memory-off' | 'empty' | 'unconfigured' | 'unavailable'; lesson: null }

export const MANAGER_APP_ACTIONS = [
  'show-files',
  'show-changes',
  'show-accounts',
  'show-memory',
  'show-tasks',
  'show-profile',
  'show-music',
  'show-timer',
  'open-terminal',
  'open-browser',
  'open-player',
  'open-timer',
  'open-ios-preview',
  'open-android-preview',
  'layout-free',
  'layout-tiled',
  'layout-grid-2x2',
  'layout-cols-4'
] as const

export type ManagerAppAction = (typeof MANAGER_APP_ACTIONS)[number]

export function parseManagerAppActions(value: unknown): ManagerAppAction[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set<string>(MANAGER_APP_ACTIONS)
  const actions: ManagerAppAction[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.has(item) || actions.includes(item as ManagerAppAction)) continue
    actions.push(item as ManagerAppAction)
    if (actions.length === 4) break
  }
  return actions
}

export interface SecretaryThread {
  id: string
  projectId: string
  title: string
  status: SecretaryThreadStatus
  createdAt: number
  updatedAt: number
}

export type SecretarySessionWorkStatus = 'completed' | 'failed' | 'cancelled' | 'rejected' | 'interrupted' | 'active'

export interface SecretarySessionWork {
  label: string
  status: SecretarySessionWorkStatus
}

/** A saved Manager conversation, with the work that session actually ran. */
export interface SecretarySessionSummary {
  id: string
  projectId: string
  title: string
  status: SecretaryThreadStatus
  createdAt: number
  updatedAt: number
  messageCount: number
  work: SecretarySessionWork[]
}

export interface SecretaryThreadRenameRequest {
  threadId: string
  projectId: string
  title: string
}

export interface SecretaryThreadDeleteRequest {
  threadId: string
  projectId: string
}

export interface SecretaryMessage {
  id: string
  threadId: string
  runId: string | null
  /** Present for CLI questions and the user answers routed back to that assignment. */
  assignmentId: string | null
  role: SecretaryMessageRole
  type: SecretaryMessageType
  /** Stored after local secret redaction. */
  content: string
  createdAt: number
}

export interface SecretaryRun {
  id: string
  threadId: string
  projectId: string
  status: SecretaryRunStatus
  requestText: string
  reply: string | null
  plan: SecretaryPlan | null
  /** Increments whenever a pending plan is persisted or revised. */
  planRevision: number
  openKinds: CliUsageKind[]
  errorCode: string | null
  errorMessage: string | null
  /** Persisted before dispatch so an interrupted task can still point to its CLI panels. */
  sessionBindings: SecretarySessionBinding[]
  /** Git observations and CLI claims only; no independently executed tests are implied. */
  evidence: SecretaryRunEvidence | null
  createdAt: number
  updatedAt: number
}

export interface SecretaryThreadDetail {
  thread: SecretaryThread
  messages: SecretaryMessage[]
  runs: SecretaryRun[]
  hasOlderMessages: boolean
}

export interface SecretaryMessageCursor {
  createdAt: number
  id: string
}

export interface SecretaryThreadCreateRequest {
  project: SecretaryProjectRef
  title?: string
}

/** Renderer supplies only session bindings; instructions remain in the persisted plan. */
export interface SecretaryRunDispatchRequest {
  runId: string
  projectId: string
  assignments: Array<{
    assignmentId: string
    sessionId: string
  }>
}

/** Read-only handshake used immediately before approval/dispatch. */
export interface SecretaryRunPreparationResult {
  runId: string
  projectId: string
  preparedAssignmentIds: string[]
}

/**
 * The renderer may revise wording before approval, but cannot replace the
 * persisted assignment identity, CLI kind, or safety policy.
 */
export interface SecretaryPlanRevisionRequest {
  runId: string
  projectId: string
  /** Reject stale editor saves instead of overwriting a newer revision. */
  expectedRevision: number
  overview: string
  assignments: Array<{
    id: string
    title: string
    instruction: string
  }>
  panels: SecretaryPanelContext[]
  usage: CliUsageInfo[]
}

export interface SecretaryRunDispatchResult {
  run: SecretaryRun
  dispatchedAssignmentIds: string[]
}

export interface SecretaryRunCancelRequest {
  runId: string
  projectId: string
}

export interface SecretaryRunAnswerRequest {
  runId: string
  projectId: string
  /** Routes the answer when more than one parallel assignment is waiting. */
  assignmentId?: string
  message: string
}

export type SecretaryEvent =
  | {
      type: 'run-report'
      projectId: string
      threadId: string
      runId: string
      reply: string
      /** Git snapshot facts captured by the main process, not CLI claims. */
      changedFiles: string[]
      unverifiedReportedFiles: string[]
      /** Completion signals from CLI protocol output versus terminal-activity inference. */
      completionEvidence: { cliReported: number; terminalIdleInferred: number }
      /** Panel/session IDs that produced the report facts. */
      panelIds: string[]
      evidence: SecretaryRunEvidence
    }
  | {
      type: 'run-followup'
      projectId: string
      threadId: string
      completedRunId: string
      runId: string
      reply: string
      plan: SecretaryPlan
      openKinds: CliUsageKind[]
      completedEvidence: SecretaryRunEvidence
    }
  | {
      type: 'run-needs-user'
      projectId: string
      threadId: string
      runId: string
      assignmentId: string
      assignmentTitle: string
      message: string
    }
  | {
      type: 'run-failed'
      projectId: string
      threadId: string
      runId: string
      message: string
    }

export const SECRETARY_IPC = {
  GET_SETTINGS: 'secretary:getSettings',
  SAVE_KEY: 'secretary:saveKey',
  CLEAR_KEY: 'secretary:clearKey',
  RESET_USAGE: 'secretary:resetUsage',
  UPDATE_SETTINGS: 'secretary:updateSettings',
  TEST_CONNECTION: 'secretary:testConnection',
  CREATE_PLAN: 'secretary:createPlan',
  CHAT: 'secretary:chat',
  GET_DAILY_LEARN: 'secretary:getDailyLearn',
  LIST_THREADS: 'secretary:listThreads',
  LIST_SESSIONS: 'secretary:listSessions',
  CREATE_THREAD: 'secretary:createThread',
  RENAME_THREAD: 'secretary:renameThread',
  DELETE_THREAD: 'secretary:deleteThread',
  GET_THREAD: 'secretary:getThread',
  LIST_RUNS: 'secretary:listRuns',
  GET_RUN: 'secretary:getRun',
  APPROVE_PLAN: 'secretary:approvePlan',
  REJECT_PLAN: 'secretary:rejectPlan',
  REVISE_PLAN: 'secretary:revisePlan',
  CANCEL_RUN: 'secretary:cancelRun',
  ANSWER_RUN: 'secretary:answerRun',
  PREPARE_RUN: 'secretary:prepareRun',
  FAIL_APPROVED_RUN: 'secretary:failApprovedRun',
  DISPATCH_RUN: 'secretary:dispatchRun',
  COMPLETE_RUN: 'secretary:completeRun',
  EVENT: 'secretary:event'
} as const
