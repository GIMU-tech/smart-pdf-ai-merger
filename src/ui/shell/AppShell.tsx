import type { ReactNode } from 'react';
import type { LayoutMode } from '../../app/layoutMode';
import type { AppTab } from '../../app/navigation';
import { ContentFrame } from './ContentFrame';
import { GlobalHeader } from './GlobalHeader';

type AppShellProps = {
  activeTab: AppTab;
  layoutMode: LayoutMode;
  onTabChange: (tab: AppTab) => void;
  children: ReactNode;
};

export function AppShell({ activeTab, layoutMode, onTabChange, children }: AppShellProps) {
  const usesGlobalHeader = activeTab !== 'home';

  return (
    <div className="flex min-h-dvh flex-col bg-app text-primary">
      {usesGlobalHeader && <GlobalHeader activeTab={activeTab} onTabChange={onTabChange} />}
      <ContentFrame
        mode={layoutMode}
        edgeToEdge={activeTab === 'illustrator'}
        aria-label={activeTab === 'home' ? '홈 작업 공간' : '기능 작업 공간'}
      >
        {children}
      </ContentFrame>
    </div>
  );
}
