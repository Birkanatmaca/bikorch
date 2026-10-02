import { Download, LoaderCircle } from 'lucide-react'
import { AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import type { CliUsageKind } from '@shared/contracts/usage'
import { useCliStore } from '@renderer/stores/cli-store'

export function CliInstallButton({ kind }: { kind: CliUsageKind }): React.JSX.Element {
  const installingKind = useCliStore((state) => state.installingKind)
  const phase = useCliStore((state) => state.installation?.phase)
  const installing = installingKind === kind
  const progress = phase === 'runtime' ? 'Preparing Node.js' : phase === 'verifying' ? 'Verifying installation' : phase === 'checking' ? 'Checking installation' : `Installing ${AI_ACCOUNT_LABELS[kind]}`
  return (
    <button
      type="button"
      className="cli-install-button"
      disabled={installingKind !== null}
      onClick={() => void useCliStore.getState().install(kind)}
      title={installing ? `${progress}…` : `Download and install ${AI_ACCOUNT_LABELS[kind]}`}
      aria-label={installing ? `Installing ${AI_ACCOUNT_LABELS[kind]}` : `Install ${AI_ACCOUNT_LABELS[kind]}`}
      aria-busy={installing}
    >
      {installing ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
    </button>
  )
}
