import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@renderer/lib/utils'

export const buttonStyles = cva('ui-control', {
  variants: {
    variant: {
      primary: 'ui-control-primary',
      secondary: 'ui-control-secondary',
      ghost: 'ui-control-ghost',
      danger: 'ui-control-danger'
    },
    size: {
      sm: 'ui-control-sm',
      md: 'ui-control-md',
      icon: 'ui-control-icon',
      'icon-sm': 'ui-control-icon-sm'
    }
  },
  defaultVariants: { variant: 'secondary', size: 'sm' }
})

type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonStyles>

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps): React.JSX.Element {
  return <button type={type} className={cn(buttonStyles({ variant, size }), className)} {...props} />
}
