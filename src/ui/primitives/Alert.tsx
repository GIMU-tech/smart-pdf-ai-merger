import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  icon?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
}

const variantClasses: Record<AlertVariant, string> = {
  info: 'border-compare/20 bg-compare-subtle text-compare',
  success: 'border-success/20 bg-success-subtle text-success',
  warning: 'border-warning/20 bg-warning-subtle text-warning',
  danger: 'border-danger/20 bg-danger-subtle text-danger',
};

export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  {
    variant = 'info',
    icon,
    onDismiss,
    dismissLabel = '알림 닫기',
    className,
    children,
    role,
    ...props
  },
  ref,
) {
  return (
    <div
      ref={ref}
      role={role ?? (variant === 'danger' ? 'alert' : 'status')}
      className={cn(
        'flex min-w-0 items-start gap-3 rounded-control border px-4 py-3 text-[13px] leading-5 font-semibold',
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {icon && <span aria-hidden="true" className="mt-0.5 flex shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="-mr-1 grid size-7 shrink-0 place-items-center rounded-md text-current/70 transition-colors hover:bg-white/60 hover:text-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
});
