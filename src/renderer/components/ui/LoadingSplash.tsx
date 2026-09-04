import { AppLogo, AppWordmark } from '@renderer/components/brand/AppLogo'
import { AppWindowEdge } from '@renderer/components/layout/AppWindowEdge'

export function LoadingSplash(): React.JSX.Element {
  return (
    <div className="app-shell flex h-full flex-col items-center justify-center gap-4">
      <AppWindowEdge />
      <div className="relative">
        <span className="loading-rank-orbit loading-rank-orbit-inner" aria-hidden />
        <span className="loading-rank-orbit" aria-hidden />
        <div className="relative">
          <AppLogo size="lg" />
        </div>
      </div>
      <div className="space-y-1 text-center">
        <AppWordmark size="lg" className="mx-auto min-w-[140px]" />
        <p className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
          Loading workspace...
        </p>
      </div>
    </div>
  )
}
