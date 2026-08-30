import appLogo from '@renderer/assets/app-logo.png'
import appLogoWhite from '@renderer/assets/app-logo-white.png'
import { cn } from '@renderer/lib/utils'

interface AppLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  showName?: boolean
  className?: string
}

const sizeMap = {
  xs: 'h-5 w-5',
  sm: 'h-7 w-7',
  md: 'h-10 w-10',
  lg: 'h-16 w-16',
  xl: 'h-24 w-24'
}

const wordmarkSizeMap = {
  sm: 'h-6',
  md: 'h-8',
  lg: 'h-12',
  xl: 'h-20'
}

export function AppWordmark({
  size = 'md',
  className
}: {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}): React.JSX.Element {
  return (
    <img
      src={appLogoWhite}
      alt="BIKORCH"
      className={cn(
        'object-contain object-left',
        size === 'xs' ? 'h-4' : wordmarkSizeMap[size as keyof typeof wordmarkSizeMap],
        className
      )}
      draggable={false}
    />
  )
}

export function AppLogo({
  size = 'md',
  showName = false,
  className
}: AppLogoProps): React.JSX.Element {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <img
        src={appLogo}
        alt=""
        className={cn('shrink-0 object-contain', sizeMap[size])}
        draggable={false}
      />
      {showName && (
        <AppWordmark
          size={size === 'sm' ? 'md' : size === 'md' ? 'lg' : size}
          className={size === 'sm' ? 'min-w-[72px]' : undefined}
        />
      )}
    </div>
  )
}
