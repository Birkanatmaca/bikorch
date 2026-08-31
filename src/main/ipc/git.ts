import { ipcMain } from 'electron'
import {
  type GitDiffRequest,
  type GitDiscardRequest,
  type GitFileRequest,
  type GitCommitRequest,
  type GitDiscoverRequest,
  type GitCheckoutBranchRequest,
  type GitStatusRequest,
  GIT_IPC
} from '@shared/contracts/git'
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
}
