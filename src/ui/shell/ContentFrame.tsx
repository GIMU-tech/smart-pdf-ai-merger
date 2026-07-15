import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import type { LayoutMode } from '../../app/layoutMode';
import { cn } from '../../lib/utils';

type ContentFrameProps = ComponentPropsWithoutRef<'main'> & {
  mode: LayoutMode;
  edgeToEdge?: boolean;
  children: ReactNode;
};

const modeClassNames: Record<LayoutMode, string> = {
  home: 'h-dvh bg-app p-0',
  form: 'mx-auto w-full max-w-[920px] gap-5 px-6 py-8 md:px-8',
  studio: 'h-[calc(100dvh-var(--header-height))] overflow-hidden bg-app p-4',
};

export function ContentFrame({ mode, edgeToEdge = false, className, children, ...props }: ContentFrameProps) {
  return (
    <main
      className={cn(
        'flex min-h-0 min-w-0 flex-grow flex-col transition-all duration-200',
        modeClassNames[mode],
        edgeToEdge && 'max-w-none p-0',
        className
      )}
      {...props}
    >
      {children}
    </main>
  );
}
