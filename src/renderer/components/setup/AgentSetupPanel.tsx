import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, Download, LoaderCircle, LogIn, RefreshCw, Trash2, X } from 'lucide-react'
import { AI_ACCOUNT_KINDS, AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import type { SystemAuthDiscovery } from '@shared/contracts/auth-profiles'
import type { CliUsageKind } from '@shared/contracts/usage'
import { useCliStore } from '@renderer/stores/cli-store'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { getCliLogo } from '@renderer/lib/cli-logos'
import { openCliSignIn } from '@renderer/lib/cli-sign-in'
import { importSystemAccountForKind } from '@renderer/lib/system-auth-sync'
import { STANDALONE_SIGN_IN_KINDS, useSetupSignInStore } from '@renderer/lib/standalone-sign-in'
import { Button } from '@renderer/components/ui/Button'
import { ConfirmDialog } from '@renderer/components/ui/ConfirmDialog'
import { cn } from '@renderer/lib/utils'

const PHASE_LABEL = {
  checking: 'Checking',
  runtime: 'Preparing Node.js',
  installing: 'Downloading',
  verifying: 'Verifying',
  complete: 'Done',
  failed: 'Failed',
  interrupted: 'Interrupted'
} as const

function InstallLog({ lines }: { lines: string[] }): React.JSX.Element | null {
  if (lines.length === 0) return null
  return (
    <pre className="agent-setup-log" aria-label="Installer output">
      {lines.slice(-40).join('\n')}
    </pre>
  )
}

function AgentRow({
  kind,
  discovery,
  onImported
}: {
  kind: CliUsageKind
  discovery: SystemAuthDiscovery | undefined
  onImported: () => void
}): React.JSX.Element {
  const installed = useCliStore((state) => state.installedByKind[kind])
  const version = useCliStore((state) => state.versionByKind[kind])
  const managed = useCliStore((state) => state.managedByKind[kind])
  const error = useCliStore((state) => state.errorsByKind[kind])
  const installingKind = useCliStore((state) => state.installingKind)
  const installation = useCliStore((state) => (state.installation?.kind === kind ? state.installation : null))
  const readyAccount = useAiAccountsStore((state) =>
    state.accounts.find((account) => account.kind === kind && account.profileReady)
  )
  const hasProject = useWorkspaceStore((state) => Boolean(state.activeProjectId))
  const [busy, setBusy] = useState<'import' | 'signin' | 'remove' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const label = AI_ACCOUNT_LABELS[kind]
  const logo = getCliLogo(kind)
  const installing = installingKind === kind
  const otherInstalling = installingKind !== null && !installing
  const log = installation?.log ?? []
  const failed = installation?.phase === 'failed' || installation?.phase === 'interrupted'
  const canSignInHere = STANDALONE_SIGN_IN_KINDS.includes(kind) || hasProject

  useEffect(() => {
    if (installing || failed) setShowLog(true)
  }, [installing, failed])

  const signIn = async (): Promise<void> => {
    setActionError(null)
    if (STANDALONE_SIGN_IN_KINDS.includes(kind)) {
      useSetupSignInStore.getState().start(kind)
      return
    }
    setBusy('signin')
    try {
      await openCliSignIn(kind)
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : `Could not start ${label} sign-in`)
    } finally {
      setBusy(null)
    }
  }

  const useExisting = async (): Promise<void> => {
    setBusy('import')
    setActionError(null)
    try {
      const account = await importSystemAccountForKind(kind, { userRequested: true })
      if (!account) throw new Error(`Could not use the existing ${label} login. Sign in instead.`)
      onImported()
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : 'Could not import this login')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (): Promise<void> => {
    setBusy('remove')
    await useCliStore.getState().uninstall(kind)
    setBusy(null)
    setConfirmRemove(false)
  }

  let status: React.ReactNode
  if (installing) {
    status = (
      <span className="agent-setup-status is-busy">
        <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden />
        {installation ? PHASE_LABEL[installation.phase] : 'Starting'}…
      </span>
    )
  } else if (installed === true) {
    status = (
      <span className="agent-setup-status is-ok">
        <CheckCircle2 className="h-3 w-3" aria-hidden />
        {version ? `v${version}` : 'Installed'}
        {managed ? ' · managed by Bikorch' : ''}
      </span>
    )
  } else if (installed === undefined && !error) {
    status = <span className="agent-setup-status">Checking…</span>
  } else {
    status = <span className="agent-setup-status is-missing">Not installed</span>
  }

  return (
    <li className="agent-setup-row">
      <div className="agent-setup-main">
        {logo && <img src={logo} alt="" className="agent-setup-logo" />}
        <div className="agent-setup-text">
          <span className="agent-setup-name">{label}</span>
          {status}
        </div>
        <div className="agent-setup-actions">
          {installing ? (
            <Button size="sm" variant="secondary" onClick={() => void useCliStore.getState().cancelInstall(kind)}>
              <X className="h-3 w-3" aria-hidden /> Cancel
            </Button>
          ) : installed === true ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={otherInstalling}
                title={`Download the latest ${label}`}
                onClick={() => void useCliStore.getState().install(kind, 'update')}
              >
                <RefreshCw className="h-3 w-3" aria-hidden /> Update
              </Button>
              {managed && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={otherInstalling || busy !== null}
                  title={`Remove ${label}`}
                  aria-label={`Remove ${label}`}
                  onClick={() => setConfirmRemove(true)}
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                </Button>
              )}
            </>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={otherInstalling}
              title={otherInstalling ? 'Another CLI is installing' : `Download and install ${label}`}
              onClick={() => void useCliStore.getState().install(kind)}
            >
              <Download className="h-3 w-3" aria-hidden /> {failed ? 'Retry' : 'Install'}
            </Button>
          )}
        </div>
      </div>

      {installed === true && (
        <div className="agent-setup-account">
          {readyAccount ? (
            <span className="agent-setup-signed-in">
              Signed in
              {readyAccount.email ? ` as ${readyAccount.email}` : readyAccount.apiKeyId ? ` with API key “${readyAccount.name}”` : ''}
            </span>
          ) : (
            <>
              <span className="agent-setup-signed-out">Not signed in</span>
              {discovery && (
                <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void useExisting()}>
                  {busy === 'import' ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> : null}
                  Use existing login{discovery.email ? ` (${discovery.email})` : ''}
                </Button>
              )}
              <Button
                size="sm"
                variant={discovery ? 'ghost' : 'primary'}
                disabled={busy !== null || !canSignInHere}
                title={canSignInHere ? `Sign in to ${label}` : `Open a project to sign in to ${label}`}
                onClick={() => void signIn()}
              >
                <LogIn className="h-3 w-3" aria-hidden /> Sign in
              </Button>
            </>
          )}
        </div>
      )}

      {(error || actionError) && !installing && (
        <div className="agent-setup-error" role="alert">
          <span>{actionError ?? error}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              setActionError(null)
              useCliStore.getState().dismissError(kind)
            }}
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </div>
      )}

      {log.length > 0 && (installing || failed) && (
        <div className="agent-setup-log-wrap">
          <button type="button" className="agent-setup-log-toggle" onClick={() => setShowLog((value) => !value)}>
            <ChevronDown className={cn('h-3 w-3 transition-transform', !showLog && '-rotate-90')} aria-hidden />
            Installer output
          </button>
          {showLog && <InstallLog lines={log} />}
        </div>
      )}

      {confirmRemove && (
        <ConfirmDialog
          title={`Remove ${label}?`}
          message={`Bikorch will delete the copy of ${label} it installed. Your accounts stay saved, and you can install it again any time.`}
          confirmLabel="Remove"
          busy={busy === 'remove'}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </li>
  )
}

/**
 * First-run checklist and CLI manager: install, update, remove and sign in to
 * each agent CLI without opening a project first.
 */
export function AgentSetupPanel({
  compact = false,
  embedded = false
}: {
  compact?: boolean
  /** Inside a sidebar that already shows a title: drop the card frame and heading. */
  embedded?: boolean
}): React.JSX.Element {
  const [discoveries, setDiscoveries] = useState<SystemAuthDiscovery[]>([])
  const installedByKind = useCliStore((state) => state.installedByKind)
  const installingKind = useCliStore((state) => state.installingKind)
  const accounts = useAiAccountsStore((state) => state.accounts)

  const discover = useCallback(() => {
    void window.api.authProfiles
      .discoverSystem()
      .then(setDiscoveries)
      .catch(() => setDiscoveries([]))
  }, [])

  // Look for logins made outside Bikorch once, and again after each install finishes.
  useEffect(() => {
    if (installingKind === null) discover()
  }, [discover, installingKind])

  const readyCount = useMemo(
    () =>
      AI_ACCOUNT_KINDS.filter(
        (kind) => installedByKind[kind] && accounts.some((account) => account.kind === kind && account.profileReady)
      ).length,
    [accounts, installedByKind]
  )

  return (
    <section className={cn('agent-setup', compact && 'is-compact', embedded && 'is-embedded')} aria-labelledby="agent-setup-title">
      <div className="agent-setup-head">
        <h2 id="agent-setup-title" className={cn('agent-setup-title', embedded && 'sr-only')}>
          Your AI agents
        </h2>
        <span className="agent-setup-count">
          {readyCount === 0 ? 'Install one and sign in to get started' : `${readyCount} ready`}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Check installations again"
          aria-label="Check installations again"
          onClick={() => {
            void useCliStore.getState().refresh()
            discover()
          }}
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
        </Button>
      </div>
      <ul className="agent-setup-list">
        {AI_ACCOUNT_KINDS.map((kind) => (
          <AgentRow
            key={kind}
            kind={kind}
            discovery={discoveries.find((item) => item.kind === kind && item.ready)}
            onImported={discover}
          />
        ))}
      </ul>
    </section>
  )
}
