import type { CliUsageInfo, CliUsageKind } from './usage'

export const SECRETARY_SCHEMA_VERSION = 2

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

export type SecretaryMessageRole = 'user' | 'assistant'

export type SecretaryMessageType = 'chat' | 'plan' | 'approval' | 'needs-user' | 'final-report' | 'error'

export interface SecretaryProjectRef {
  id: string
  name: string
  folderPath: string | null
}

export interface SecretarySettings {
  configured: boolean
  model: string
  usage: SecretaryUsageStats
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

export interface SecretaryAssignment {
  id: string
  panelId: string | null
  kind: CliUsageKind
  title: string
  instruction: string
  rationale: string
  usageNote: string
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
}

export interface SecretaryThread {
  id: string
  projectId: string
  title: string
  status: SecretaryThreadStatus
  createdAt: number
  updatedAt: number
}

export interface SecretaryMessage {
  id: string
  threadId: string
  runId: string | null
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
  createdAt: number
  updatedAt: number
}

export interface SecretaryThreadDetail {
  thread: SecretaryThread
  messages: SecretaryMessage[]
  runs: SecretaryRun[]
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

export type SecretaryEvent =
  | {
      type: 'run-report'
      projectId: string
      runId: string
      reply: string
      /** Git snapshot facts captured by the main process, not CLI claims. */
      changedFiles: string[]
      unverifiedReportedFiles: string[]
      /** Panel/session IDs that produced the report facts. */
      panelIds: string[]
    }
  | {
      type: 'run-followup'
      projectId: string
      completedRunId: string
      runId: string
      reply: string
      plan: SecretaryPlan
      openKinds: CliUsageKind[]
    }
  | {
      type: 'run-needs-user'
      projectId: string
      runId: string
      message: string
    }
  | {
      type: 'run-failed'
      projectId: string
      runId: string
      message: string
    }

export const SECRETARY_IPC = {
  GET_SETTINGS: 'secretary:getSettings',
  SAVE_KEY: 'secretary:saveKey',
  CLEAR_KEY: 'secretary:clearKey',
  RESET_USAGE: 'secretary:resetUsage',
  UPDATE_SETTINGS: 'secretary:updateSettings',
  CREATE_PLAN: 'secretary:createPlan',
  CHAT: 'secretary:chat',
  LIST_THREADS: 'secretary:listThreads',
  CREATE_THREAD: 'secretary:createThread',
  GET_THREAD: 'secretary:getThread',
  LIST_RUNS: 'secretary:listRuns',
  GET_RUN: 'secretary:getRun',
  APPROVE_PLAN: 'secretary:approvePlan',
  REJECT_PLAN: 'secretary:rejectPlan',
  REVISE_PLAN: 'secretary:revisePlan',
  CANCEL_RUN: 'secretary:cancelRun',
  PREPARE_RUN: 'secretary:prepareRun',
  FAIL_APPROVED_RUN: 'secretary:failApprovedRun',
  DISPATCH_RUN: 'secretary:dispatchRun',
  COMPLETE_RUN: 'secretary:completeRun',
  EVENT: 'secretary:event'
} as const
