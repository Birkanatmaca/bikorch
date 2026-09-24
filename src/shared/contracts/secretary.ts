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
      runId: string
      assignmentId: string
      assignmentTitle: string
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
  ANSWER_RUN: 'secretary:answerRun',
  PREPARE_RUN: 'secretary:prepareRun',
  FAIL_APPROVED_RUN: 'secretary:failApprovedRun',
  DISPATCH_RUN: 'secretary:dispatchRun',
  COMPLETE_RUN: 'secretary:completeRun',
  EVENT: 'secretary:event'
} as const
