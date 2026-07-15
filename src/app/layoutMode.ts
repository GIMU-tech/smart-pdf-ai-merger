import type { AppTab } from './navigation';

export type LayoutMode = 'home' | 'form' | 'studio';

export type LayoutModeState = {
  hasCompareResults?: boolean;
  compareExpanded?: boolean;
};

export function getLayoutMode(tab: AppTab, state: LayoutModeState = {}): LayoutMode {
  if (tab === 'home') return 'home';

  if (tab === 'compare') {
    return state.hasCompareResults || state.compareExpanded ? 'studio' : 'form';
  }

  if (tab === 'merge' || tab === 'split' || tab === 'outline') return 'form';

  return 'studio';
}
