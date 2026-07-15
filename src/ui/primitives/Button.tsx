import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'border-action bg-action text-on-action hover:border-action-hover hover:bg-action-hover active:bg-action-hover',
  secondary: 'border-action-secondary bg-action-secondary text-primary hover:border-action-secondary-hover hover:bg-action-secondary-hover',
  outline: 'border-border-strong bg-panel text-primary hover:bg-subtle active:bg-selected',
  ghost: 'border-transparent bg-transparent text-secondary hover:bg-subtle hover:text-primary active:bg-selected',
  destructive: 'border-danger bg-danger text-white hover:brightness-95 active:brightness-90',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-control-sm gap-1.5 px-3 text-[12px]',
  md: 'h-control-md gap-2 px-4 text-[13px]',
  lg: 'h-control-lg gap-2.5 px-5 text-[14px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    loading = false,
    loadingLabel = '처리 중',
    startIcon,
    endIcon,
    children,
    disabled,
    type = 'button',
    ...props
  },
  ref,
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-control border font-bold whitespace-nowrap',
        'transition-[color,background-color,border-color,box-shadow,filter,transform] duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:border-disabled-border disabled:bg-disabled disabled:text-disabled-text disabled:shadow-none',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      ) : (
        startIcon && <span className="flex shrink-0" aria-hidden="true">{startIcon}</span>
      )}
      <span>{loading ? loadingLabel : children}</span>
      {!loading && endIcon && <span className="flex shrink-0" aria-hidden="true">{endIcon}</span>}
    </button>
  );
});
