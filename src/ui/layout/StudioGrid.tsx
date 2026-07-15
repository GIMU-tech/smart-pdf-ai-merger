import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export const StudioGrid = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function StudioGrid(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-4 py-4 sm:px-6',
        'xl:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(240px,300px)] xl:grid-rows-[minmax(0,1fr)] xl:overflow-hidden',
        '[&>*]:min-h-0 [&>*]:min-w-0',
        className,
      )}
      {...props}
    />
  );
});
