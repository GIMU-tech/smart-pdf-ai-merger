import { cn } from '../../lib/utils';
import { APP_NAVIGATION_ITEMS, type AppTab } from '../../app/navigation';

type GlobalNavigationProps = {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
};

export function GlobalNavigation({ activeTab, onTabChange }: GlobalNavigationProps) {
  return (
    <nav aria-label="기능 메뉴" className="flex min-w-0 items-center justify-end gap-2 overflow-x-auto">
      {APP_NAVIGATION_ITEMS.map(({ tab, label, icon: NavIcon, beta }) => {
        const active = activeTab === tab;

        return (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            aria-current={active ? 'page' : undefined}
            aria-label={`${label}${beta ? ' 베타' : ''}`}
            className={cn(
              'group flex h-9 flex-shrink-0 items-center justify-center gap-1.5 rounded-control px-3 text-xs font-bold leading-none transition-colors',
              active
                ? 'bg-selected text-primary'
                : 'text-muted hover:bg-subtle hover:text-primary'
            )}
            title={label}
          >
            <NavIcon className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{label}</span>
            {beta && (
              <span className="rounded-md bg-gif-subtle px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-gif">
                BETA
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
