import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/utils';

type WorkspaceToolbarProps = ComponentPropsWithoutRef<'div'>;

export function WorkspaceToolbar({ className, children, ...props }: WorkspaceToolbarProps) {
  return (
    <div
      role="toolbar"
      className={cn(
        'flex h-12 min-h-12 flex-shrink-0 items-center gap-2 overflow-x-auto overflow-y-hidden border-b border-border bg-panel-translucent px-4 backdrop-blur',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
