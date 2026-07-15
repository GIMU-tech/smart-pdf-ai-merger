import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  as?: 'section' | 'article' | 'aside';
  tone?: 'default' | 'subtle';
}

export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel(
  { as: Element = 'section', className, tone = 'default', ...props },
  ref,
) {
  return (
    <Element
      ref={ref}
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-panel border border-border shadow-panel',
        tone === 'default' ? 'bg-panel-translucent' : 'bg-subtle',
        className,
      )}
      {...props}
    />
  );
});

export const PanelHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function PanelHeader(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn('shrink-0 border-b border-border p-panel', className)} {...props} />;
});

export const PanelTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(function PanelTitle(
  { className, ...props },
  ref,
) {
  return <h2 ref={ref} className={cn('text-[14px] leading-5 font-extrabold text-primary', className)} {...props} />;
});

export interface PanelContentProps extends HTMLAttributes<HTMLDivElement> {
  scrollable?: boolean;
}

export const PanelContent = forwardRef<HTMLDivElement, PanelContentProps>(function PanelContent(
  { className, scrollable = false, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('min-h-0 flex-1 p-panel', scrollable && 'overflow-y-auto overscroll-contain', className)}
      {...props}
    />
  );
});

export const PanelFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function PanelFooter(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn('shrink-0 border-t border-border p-panel', className)} {...props} />;
});
