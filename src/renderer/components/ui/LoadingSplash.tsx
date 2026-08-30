import { AppLogo, AppWordmark } from '@renderer/components/brand/AppLogo'

export function LoadingSplash(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-app-bg">
      <div className="relative">
        <div className="absolute -inset-4 animate-ping rounded-full bg-primary/10" />
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
