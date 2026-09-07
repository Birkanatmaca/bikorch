import { Button } from './Button'

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onCancel
}: {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <div className="music-confirm-overlay" role="presentation" onClick={onCancel}>
      <div
        className="music-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="music-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p id="music-confirm-title" className="music-confirm-title">
          {title}
        </p>
        <p className="music-confirm-copy">{message}</p>
        <div className="music-confirm-actions">
          <Button variant="secondary" size="sm" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="danger" size="sm" disabled={busy} onClick={onConfirm}>
            {busy ? 'Deleting…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
