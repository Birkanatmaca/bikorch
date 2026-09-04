import type { GitChangeStatus } from './git'
import type { Project, ProjectWorkspaceState } from '../types'
import type { AiAccount, ActiveAccountByKind } from './accounts'
import type { ProjectTask } from './tasks'
import type { CliUsageInfo } from './usage'

export interface PersistedUsageSnapshot {
  providers: CliUsageInfo[]
  checkedAtByAccountId: Record<string, number>
}

export function createEmptyUsageSnapshot(): PersistedUsageSnapshot {
  return {
    providers: [],
    checkedAtByAccountId: {}
  }
}

export interface PersistedEditorState {
  selectedFileByProject: Record<string, string | null>
  activeDiffByProject: Record<
    string,
    {
      filePath: string
      status: GitChangeStatus | null
      index: number
      mode?: 'diff' | 'file'
      absolutePath?: string
    } | null
  >
}

export interface PersistedSnapshot {
  projects: Project[]
  activeProjectId: string | null
  workspaces: Record<string, ProjectWorkspaceState>
  editor: PersistedEditorState
  accounts: AiAccount[]
  activeAccountByKind: ActiveAccountByKind
  tasksByProject: Record<string, ProjectTask[]>
  usage: PersistedUsageSnapshot
}

export const PERSISTENCE_IPC = {
  LOAD: 'persistence:load',
  SAVE: 'persistence:save'
} as const

export const PERSISTENCE_SCHEMA_VERSION = 1
