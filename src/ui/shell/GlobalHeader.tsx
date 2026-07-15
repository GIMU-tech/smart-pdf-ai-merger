import type { AppTab } from '../../app/navigation';
import { GaniFlowLogo } from '../brand/GaniFlowLogo';
import { GlobalNavigation } from './GlobalNavigation';

type GlobalHeaderProps = {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
};

export function GlobalHeader({ activeTab, onTabChange }: GlobalHeaderProps) {
  return (
    <header className="h-header flex-shrink-0 border-b border-border bg-panel-translucent px-4 backdrop-blur">
      <div className="flex h-full items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => onTabChange('home')}
          className="group flex h-10 flex-shrink-0 items-center rounded-control px-1.5 transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:pr-3"
          aria-label="GANI FLOW 홈으로 이동"
          title="GANI FLOW 홈"
        >
          <GaniFlowLogo compact className="[&>span]:hidden sm:[&>span]:block" />
        </button>
        <GlobalNavigation activeTab={activeTab} onTabChange={onTabChange} />
      </div>
    </header>
  );
}
