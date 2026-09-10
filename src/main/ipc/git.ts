import { ipcMain } from 'electron'
import {
  type GitDiffRequest,
  type GitDiscardRequest,
  type GitFileRequest,
  type GitCommitRequest,
  type GitDiscoverRequest,
  type GitCheckoutBranchRequest,
  type GitEnsureWorktreeRequest,
  type GitRemoveWorktreeRequest,
  type GitSessionSnapshotRequest,
  type GitStatusRequest,
  type IsolationDiffRequest,
  type IsolationFoldRequest,
  type IsolationInspectRequest,
  type IsolationLaneInput,
  type IsolationProjectRequest,
  GIT_IPC
} from '@shared/contracts/git'
import { isAgentWorktreeKind } from '../git/worktree-paths'
import { abortFold, acceptFold, foldFileDiff, inspectIsolation, prepareFold } from '../git/isolation'
import { ensureAgentWorktree, removeAgentWorktree } from '../git/worktrees'
import { snapshotAgentGit } from '../git/session-snapshot'
import {
  checkoutGitBranch,
  commitGitChanges,
  discardFileChange,
  discoverGitRepos,
  getFileDiff,
  getGitStatus,
  stageAllGitChanges,
  stageGitFile,
  unstageAllGitChanges,
  unstageGitFile
} from '../git'

function validateDiscoverRequest(payload: unknown): payload is GitDiscoverRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as GitDiscoverRequest
  return typeof req.projectRoot === 'string' && req.projectRoot.length > 0
}

function validateStatusRequest(payload: unknown): payload is GitStatusRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as GitStatusRequest
  return typeof req.projectRoot === 'string' && req.projectRoot.length > 0
}

function validateCheckoutBranchRequest(payload: unknown): payload is GitCheckoutBranchRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as GitCheckoutBranchRequest
  return (
    typeof req.projectRoot === 'string' &&
    req.projectRoot.length > 0 &&
    typeof req.branch === 'string' &&
    req.branch.length > 0 &&
    req.branch.length <= 255
  )
}

function validateFileChangeRequest(
  payload: unknown
): payload is GitDiffRequest & GitDiscardRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as GitDiffRequest
  return (
    typeof req.projectRoot === 'string' &&
    req.projectRoot.length > 0 &&
    typeof req.filePath === 'string' &&
    req.filePath.length > 0 &&
    req.filePath.length <= 1000 &&
    (req.status === 'M' || req.status === 'A' || req.status === 'D' || req.status === 'U')
  )
}

function validateFileRequest(payload: unknown): payload is GitFileRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as GitFileRequest
  return (
    typeof req.projectRoot === 'string' &&
    req.projectRoot.length > 0 &&
    typeof req.filePath === 'string' &&
    req.filePath.length > 0 &&
    req.filePath.length <= 1000
  )
}

function validateCommitRequest(payload: unknown): payload is GitCommitRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as GitCommitRequest
  if (
    typeof req.projectRoot !== 'string' ||
    req.projectRoot.length === 0 ||
    typeof req.message !== 'string'
  ) {
    return false
  }
  const message = req.message.trim()
  return (
    message.length > 0 &&
    message.length <= 500
  )
}

function validateEnsureWorktreeRequest(payload: unknown): payload is GitEnsureWorktreeRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as GitEnsureWorktreeRequest
  return (
    typeof req.projectRoot === 'string' &&
    req.projectRoot.length > 0 &&
    typeof req.panelId === 'string' &&
    req.panelId.length >= 8 &&
    req.panelId.length <= 80 &&
    isAgentWorktreeKind(req.kind)
  )
}

function validateRemoveWorktreeRequest(payload: unknown): payload is GitRemoveWorktreeRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as GitRemoveWorktreeRequest
  return (
    typeof req.projectRoot === 'string' &&
    req.projectRoot.length > 0 &&
    typeof req.worktreePath === 'string' &&
    req.worktreePath.length > 0 &&
    req.worktreePath.length <= 1000
  )
}

function validateIsolationProjectRequest(payload: unknown): payload is IsolationProjectRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as IsolationProjectRequest
  return typeof req.projectRoot === 'string' && req.projectRoot.length > 0
}

function validateIsolationLane(value: unknown): value is IsolationLaneInput {
  if (!value || typeof value !== 'object') return false
  const lane = value as IsolationLaneInput
  return (
    typeof lane.panelId === 'string' &&
    lane.panelId.length >= 8 &&
    lane.panelId.length <= 80 &&
    isAgentWorktreeKind(lane.kind) &&
    typeof lane.title === 'string' &&
    lane.title.length > 0 &&
    lane.title.length <= 200 &&
    typeof lane.worktreePath === 'string' &&
    lane.worktreePath.length > 0 &&
    lane.worktreePath.length <= 1000
  )
}

function validateIsolationInspectRequest(payload: unknown): payload is IsolationInspectRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as IsolationInspectRequest
  return (
    typeof req.projectRoot === 'string' &&
    req.projectRoot.length > 0 &&
    Array.isArray(req.lanes) &&
    req.lanes.length <= 24 &&
    req.lanes.every(validateIsolationLane)
  )
}

function validateIsolationFoldRequest(payload: unknown): payload is IsolationFoldRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as IsolationFoldRequest
  return (
    typeof req.projectRoot === 'string' &&
    req.projectRoot.length > 0 &&
    typeof req.panelId === 'string' &&
    req.panelId.length >= 8 &&
    req.panelId.length <= 80 &&
    isAgentWorktreeKind(req.kind) &&
    typeof req.title === 'string' &&
    req.title.length > 0 &&
    req.title.length <= 200 &&
    typeof req.worktreePath === 'string' &&
    req.worktreePath.length > 0 &&
    req.worktreePath.length <= 1000
  )
}

function validateIsolationDiffRequest(payload: unknown): payload is IsolationDiffRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as IsolationDiffRequest
  return (
    typeof req.projectRoot === 'string' &&
    req.projectRoot.length > 0 &&
    typeof req.filePath === 'string' &&
    req.filePath.length > 0 &&
    req.filePath.length <= 1000
  )
}

export function registerGitHandlers(): void {
  ipcMain.handle(GIT_IPC.DISCOVER, async (_event, payload: unknown) => {
    if (!validateDiscoverRequest(payload)) {
      throw new Error('Invalid git discover request')
    }
    const repos = await discoverGitRepos(payload.projectRoot)
    return { repos }
  })

  ipcMain.handle(GIT_IPC.STATUS, async (_event, payload: unknown) => {
    if (!validateStatusRequest(payload)) {
      throw new Error('Invalid git status request')
    }

    return getGitStatus(payload.projectRoot)
  })

  ipcMain.handle(GIT_IPC.CHECKOUT_BRANCH, async (_event, payload: unknown) => {
    if (!validateCheckoutBranchRequest(payload)) {
      throw new Error('Invalid git checkout branch request')
    }

    await checkoutGitBranch(payload.projectRoot, payload.branch)
    return { ok: true }
  })

  ipcMain.handle(GIT_IPC.DIFF, async (_event, payload: unknown) => {
    if (!validateFileChangeRequest(payload)) {
      throw new Error('Invalid git diff request')
    }

    return getFileDiff(payload.projectRoot, payload.filePath, payload.status)
  })

  ipcMain.handle(GIT_IPC.DISCARD, async (_event, payload: unknown) => {
    if (!validateFileChangeRequest(payload)) {
      throw new Error('Invalid git discard request')
    }

    await discardFileChange(payload.projectRoot, payload.filePath, payload.status)
    return { ok: true }
  })

  ipcMain.handle(GIT_IPC.STAGE, async (_event, payload: unknown) => {
    if (!validateFileRequest(payload)) throw new Error('Invalid git stage request')
    await stageGitFile(payload.projectRoot, payload.filePath)
    return { ok: true }
  })

  ipcMain.handle(GIT_IPC.UNSTAGE, async (_event, payload: unknown) => {
    if (!validateFileRequest(payload)) throw new Error('Invalid git unstage request')
    await unstageGitFile(payload.projectRoot, payload.filePath)
    return { ok: true }
  })

  ipcMain.handle(GIT_IPC.STAGE_ALL, async (_event, payload: unknown) => {
    if (!validateStatusRequest(payload)) throw new Error('Invalid git stage-all request')
    await stageAllGitChanges(payload.projectRoot)
    return { ok: true }
  })

  ipcMain.handle(GIT_IPC.UNSTAGE_ALL, async (_event, payload: unknown) => {
    if (!validateStatusRequest(payload)) throw new Error('Invalid git unstage-all request')
    await unstageAllGitChanges(payload.projectRoot)
    return { ok: true }
  })

  ipcMain.handle(GIT_IPC.COMMIT, async (_event, payload: unknown) => {
    if (!validateCommitRequest(payload)) throw new Error('Invalid git commit request')
    await commitGitChanges(payload.projectRoot, payload.message)
    return { ok: true }
  })

  ipcMain.handle(GIT_IPC.ENSURE_WORKTREE, async (_event, payload: unknown) => {
    if (!validateEnsureWorktreeRequest(payload)) {
      throw new Error('Invalid git worktree request')
    }
    return ensureAgentWorktree(payload)
  })

  ipcMain.handle(GIT_IPC.REMOVE_WORKTREE, async (_event, payload: unknown) => {
    if (!validateRemoveWorktreeRequest(payload)) {
      throw new Error('Invalid git worktree remove request')
    }
    return removeAgentWorktree(payload)
  })

  ipcMain.handle(GIT_IPC.SESSION_SNAPSHOT, async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid git session snapshot request')
    const req = payload as GitSessionSnapshotRequest
    if (typeof req.cwd !== 'string' || req.cwd.length === 0 || req.cwd.length > 1000) {
      throw new Error('Invalid git session snapshot request')
    }
    const sinceSha =
      typeof req.sinceSha === 'string' && /^[a-fA-F0-9]{7,64}$/.test(req.sinceSha) ? req.sinceSha : undefined
    return snapshotAgentGit(req.cwd, sinceSha)
  })

  ipcMain.handle(GIT_IPC.ISOLATION_INSPECT, async (_event, payload: unknown) => {
    if (!validateIsolationInspectRequest(payload)) {
      throw new Error('Invalid isolation inspect request')
    }
    return inspectIsolation(payload)
  })

  ipcMain.handle(GIT_IPC.ISOLATION_FOLD, async (_event, payload: unknown) => {
    if (!validateIsolationFoldRequest(payload)) {
      throw new Error('Invalid isolation fold request')
    }
    return prepareFold(payload)
  })

  ipcMain.handle(GIT_IPC.ISOLATION_ACCEPT, async (_event, payload: unknown) => {
    if (!validateIsolationProjectRequest(payload)) {
      throw new Error('Invalid isolation accept request')
    }
    return acceptFold(payload)
  })

  ipcMain.handle(GIT_IPC.ISOLATION_ABORT, async (_event, payload: unknown) => {
    if (!validateIsolationProjectRequest(payload)) {
      throw new Error('Invalid isolation abort request')
    }
    return abortFold(payload)
  })

  ipcMain.handle(GIT_IPC.ISOLATION_DIFF, async (_event, payload: unknown) => {
    if (!validateIsolationDiffRequest(payload)) {
      throw new Error('Invalid isolation diff request')
    }
    return foldFileDiff(payload)
  })
}
