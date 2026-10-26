import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Circle, LoaderCircle } from 'lucide-react'
import { AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import { gitSetupReady, type GitSetupStatus } from '@shared/contracts/git'
import type { Project } from '@shared/types'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'
import { useCliStore } from '@renderer/stores/cli-store'
import { useSecretaryStore } from '@renderer/stores/secretary-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { cn } from '@renderer/lib/utils'

/** Git readiness per project folder, shared by the checklist and the Start work gate. */
const gitStatusCache = new Map<string, GitSetupStatus>()

export async function readGitSetup(folderPath: string, refresh = false): Promise<GitSetupStatus | null> {
  if (!refresh && gitStatusCache.has(folderPath)) return gitStatusCache.get(folderPath) ?? null
  try {
    const status = await window.api.git.setupInspect(folderPath)
    gitStatusCache.set(folderPath, status)
    return status
  } catch {
    return null
  }
}

function Step({
  done,
  title,
  detail,
  children
}: {
  done: boolean
  title: string
  detail?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <li className={cn('manager-ready-step', done && 'is-done')}>
      {done ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1">
        <span className="manager-ready-title">{title}</span>
        {!done && detail && <span className="manager-ready-detail">{detail}</span>}
        {!done && children && <div className="manager-ready-actions">{children}</div>}
      </div>
    </li>
  )
}

/**
 * Three things a new user needs before the Manager can build anything: a brain
 * (an OpenAI key or a signed-in CLI), a ready coding CLI, and a Git project.
 * Each missing step gets the one button that fixes it. Hidden once all are done.
 */
export function ManagerReadiness({
  project,
  onOpenSettings,
  attention = 0
}: {
  project: Project
  onOpenSettings: () => void
  /** Bumped when Start work was blocked, to re-check and draw the eye here. */
  attention?: number
}): React.JSX.Element | null {
  const settings = useSecretaryStore((state) => state.settings)
  const accounts = useAiAccountsStore((state) => state.accounts)
  const installedByKind = useCliStore((state) => state.installedByKind)
  const selectLeftSidebar = useWorkspaceStore((state) => state.selectLeftSidebar)
  const [git, setGit] = useState<GitSetupStatus | null>(null)
  const [busy, setBusy] = useState<'git' | 'tools' | 'connect' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  const readyAccounts = useMemo(
    () => accounts.filter((account) => account.profileReady && installedByKind[account.kind] === true),
    [accounts, installedByKind]
  )

  const refreshGit = useCallback(async () => {
    if (!project.folderPath) return
    setGit(await readGitSetup(project.folderPath, true))
  }, [project.folderPath])

  useEffect(() => {
    if (attention > 0) void refreshGit()
  }, [attention, refreshGit])

  useEffect(() => {
    void refreshGit()
    // Coming back from Apple's installer or a terminal should update the checklist.
    window.addEventListener('focus', refreshGit)
    return () => window.removeEventListener('focus', refreshGit)
  }, [refreshGit])

  const brainReady = settings.configured
  const workersReady = readyAccounts.length > 0
  const gitReady = git ? gitSetupReady(git) : true
  if (brainReady && workersReady && gitReady) return null

  const useCliAsBrain = async (): Promise<void> => {
    const account = readyAccounts[0]
    if (!account) return
    setBusy('connect')
    await useSecretaryStore.getState().updateProvider({
      source: 'cli',
      cli: { kind: account.kind, accountId: account.id }
    })
    setBusy(null)
  }

  const initGit = async (): Promise<void> => {
    if (!project.folderPath) return
    setBusy('git')
    setMessage(null)
    try {
      const result = await window.api.git.setupInit({ projectRoot: project.folderPath, name, email })
      gitStatusCache.set(project.folderPath, result.status)
      setGit(result.status)
      if (!result.ok) setMessage(result.error ?? 'Could not set up Git')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not set up Git')
    } finally {
      setBusy(null)
    }
  }

  const installTools = async (): Promise<void> => {
    setBusy('tools')
    try {
      setMessage((await window.api.git.setupInstallTools()).message)
    } finally {
      setBusy(null)
    }
  }

  const first = readyAccounts[0]
  return (
    <section key={attention} className={cn('manager-ready', attention > 0 && 'is-attention')} aria-label="Get the Manager ready">
      <p className="manager-ready-heading">Before the Manager can build</p>
      <ol className="manager-ready-list">
        <Step
          done={workersReady}
          title="A coding CLI that is installed and signed in"
          detail="The Manager hands the coding to a CLI such as Codex or Claude Code."
        >
          <button type="button" onClick={() => selectLeftSidebar(project.id, 'clis')}>Open CLI setup</button>
        </Step>
        <Step
          done={brainReady}
          title="A way for the Manager to think"
          detail={first ? `It can use your ${AI_ACCOUNT_LABELS[first.kind]} account, or an OpenAI API key.` : 'Use a signed-in CLI account, or an OpenAI API key.'}
        >
          {first && (
            <button type="button" className="is-primary" disabled={busy !== null} onClick={() => void useCliAsBrain()}>
              {busy === 'connect' ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> : null}
              Use {AI_ACCOUNT_LABELS[first.kind]}
            </button>
          )}
          <button type="button" onClick={() => selectLeftSidebar(project.id, 'apiKeys')}>Add an OpenAI key</button>
          <button type="button" onClick={onOpenSettings}>Settings</button>
        </Step>
        {git && (
          <Step
            done={gitReady}
            title="Git for this project"
            detail={
              !git.gitInstalled
                ? 'Git is not installed. Each task runs in its own Git worktree so your files stay safe.'
                : !git.isRepo
                  ? 'This folder is not a Git repository yet.'
                  : 'The repository has no commits yet.'
            }
          >
            {!git.gitInstalled ? (
              <button type="button" className="is-primary" disabled={busy !== null} onClick={() => void installTools()}>
                {busy === 'tools' ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> : null}
                Install Git
              </button>
            ) : (
              <>
                {!git.identityConfigured && (
                  <div className="manager-ready-identity">
                    <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" aria-label="Your name for commits" />
                    <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" aria-label="Your email for commits" />
                  </div>
                )}
                <button
                  type="button"
                  className="is-primary"
                  disabled={busy !== null || (!git.identityConfigured && (!name.trim() || !email.trim()))}
                  onClick={() => void initGit()}
                  title="Runs git init if needed, adds a starter .gitignore when there is none, and commits the current files"
                >
                  {busy === 'git' ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> : null}
                  {git.isRepo ? 'Make the first commit' : 'Set up Git'}
                </button>
              </>
            )}
            <button type="button" onClick={() => void refreshGit()}>Check again</button>
          </Step>
        )}
      </ol>
      {message && <p className="manager-ready-message">{message}</p>}
    </section>
  )
}
