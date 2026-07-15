import {
  FileImage,
  FileOutput,
  Files,
  Film,
  Home,
  Images,
  Printer,
  Search,
  type LucideIcon,
} from 'lucide-react';

export type AppTab =
  | 'home'
  | 'merge'
  | 'split'
  | 'outline'
  | 'compare'
  | 'illustrator'
  | 'images'
  | 'gif';

export type AppNavigationItem = {
  tab: AppTab;
  label: string;
  icon: LucideIcon;
  beta?: boolean;
};

export const APP_NAVIGATION_ITEMS: readonly AppNavigationItem[] = [
  { tab: 'home', label: '홈', icon: Home },
  { tab: 'merge', label: '병합', icon: Files },
  { tab: 'split', label: '분리', icon: FileOutput },
  { tab: 'outline', label: '출력', icon: Printer },
  { tab: 'compare', label: '비교', icon: Search },
  { tab: 'illustrator', label: '뷰어', icon: FileImage },
  { tab: 'images', label: '이미지', icon: Images },
  { tab: 'gif', label: 'GIF 생성', icon: Film, beta: true },
] as const;
