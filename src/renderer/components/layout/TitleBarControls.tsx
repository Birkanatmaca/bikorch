import { useEffect, useState } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'
import { isWindows } from '@renderer/lib/electron-api'
import { cn } from '@renderer/lib/utils'

export function TitleBarControls(): React.JSX.Element | null {
  const isWin = isWindows()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!isWin || !window.api?.window) return
    const syncMaximized = (): void => {
      void window.api.window.isMaximized().then(setMaximized)
    }

    syncMaximized()
    window.addEventListener('resize', syncMaximized)
    return () => window.removeEventListener('resize', syncMaximized)
  }, [isWin])

  if (!isWin || !window.api?.window) return null

  const handleMaximize = (): void => {
    void window.api.window.maximize().then(setMaximized)
  }

  return (
    <div className="windows-titlebar-controls flex shrink-0 items-center app-no-drag">
      <button
        type="button"
        onClick={() => void window.api.window.minimize()}
        className="windows-titlebar-control flex h-9 w-11 items-center justify-center text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
        aria-label="Minimize window"
        title="Minimize"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={handleMaximize}
        className="windows-titlebar-control flex h-9 w-11 items-center justify-center text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
        aria-label={maximized ? 'Restore window' : 'Maximize window'}
        title={maximized ? 'Restore' : 'Maximize'}
      >
        {maximized ? (
          <Copy className="h-3 w-3 rotate-180" />
        ) : (
          <Square className="h-3 w-3" />
        )}
      </button>
      <button
        type="button"
        onClick={() => void window.api.window.close()}
        className="windows-titlebar-control windows-titlebar-control-close flex h-9 w-11 items-center justify-center text-text-muted transition-colors hover:bg-error hover:text-white"
        aria-label="Close window"
        title="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

export function TitleBarDragRegion({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 items-center gap-3',
        isWindows() && 'app-drag-region cursor-default'
      )}
    >
      {children}
    </div>
  )
}
