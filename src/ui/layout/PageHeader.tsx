import { useId, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
  iconClassName?: string;
  badge?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({
  title,
  description,
  icon,
  iconClassName,
  badge,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <header
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={cn('flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}
      {...props}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span
            aria-hidden="true"
            className={cn(
              'grid size-11 shrink-0 place-items-center [&_svg]:size-7',
              iconClassName,
            )}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 id={titleId} className="text-[22px] leading-7 font-extrabold tracking-[-0.02em] text-primary">
              {title}
            </h1>
            {badge}
          </div>
          <p id={descriptionId} className="mt-1 text-[13px] leading-5 text-secondary">
            {description}
          </p>
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
