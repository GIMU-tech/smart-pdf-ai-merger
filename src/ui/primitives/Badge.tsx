import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'beta';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  neutral: 'bg-selected text-secondary',
  info: 'bg-compare-subtle text-compare',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
  beta: 'bg-gif-subtle text-gif',
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant = 'neutral', ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex min-h-5 items-center rounded-full px-2 py-0.5 text-[10px] leading-none font-extrabold tracking-wide',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
});
