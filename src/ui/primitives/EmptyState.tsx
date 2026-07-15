import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { className, icon, title, description, primaryAction, secondaryAction, ...props },
  ref,
) {
  return (
    <div ref={ref} className={cn('flex min-h-56 flex-col items-center justify-center p-6 text-center', className)} {...props}>
      {icon && (
        <span aria-hidden="true" className="mb-4 grid size-12 place-items-center rounded-control bg-subtle text-secondary">
          {icon}
        </span>
      )}
      <h2 className="text-[16px] leading-6 font-extrabold text-primary">{title}</h2>
      {description && <div className="mt-1.5 max-w-md text-[13px] leading-5 text-secondary">{description}</div>}
      {(primaryAction || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {primaryAction}
          {secondaryAction}
        </div>
      )}
    </div>
  );
});
