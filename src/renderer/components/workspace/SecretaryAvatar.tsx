import secretaryIdle from '@renderer/assets/secretary-idle.png'
import secretaryNotes from '@renderer/assets/secretary-notes.png'
import secretaryThinking from '@renderer/assets/secretary-thinking.png'
import { cn } from '@renderer/lib/utils'

export type SecretaryAvatarMood = 'idle' | 'thinking' | 'working'
export type SecretaryAvatarVariant = 'mini' | 'card' | 'hero' | 'profile'

const AVATAR_SOURCE: Record<SecretaryAvatarMood, string> = {
  idle: secretaryIdle,
  thinking: secretaryThinking,
  working: secretaryNotes
}

const AVATAR_LABEL: Record<SecretaryAvatarMood, string> = {
  idle: 'Secretary ready',
  thinking: 'Secretary thinking',
  working: 'Secretary tracking the plan'
}

export function SecretaryAvatar({
  mood,
  variant = 'mini',
  decorative = false,
  className
}: {
  mood: SecretaryAvatarMood
  variant?: SecretaryAvatarVariant
  decorative?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cn('secretary-avatar', `is-${mood}`, `is-${variant}`, className)}
      {...(decorative
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': AVATAR_LABEL[mood] })}
    >
      <span className="secretary-avatar-glow" aria-hidden />
      <img src={AVATAR_SOURCE[mood]} alt="" draggable={false} />
    </span>
  )
}
