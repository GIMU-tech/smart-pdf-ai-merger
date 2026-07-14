import type { GifImageSource, GifSelection, GifStudioState } from './types';

export const initialGifStudioState: GifStudioState = {
  status: 'idle',
  source: null,
  selection: null,
  error: null,
};

export type GifStudioAction =
  | { type: 'import-started' }
  | { type: 'import-succeeded'; source: GifImageSource }
  | { type: 'import-failed'; message: string }
  | { type: 'selection-changed'; selection: GifSelection | null }
  | { type: 'reset' };

export function gifProjectReducer(state: GifStudioState, action: GifStudioAction): GifStudioState {
  switch (action.type) {
    case 'import-started':
      return { ...state, status: 'importing', source: null, selection: null, error: null };
    case 'import-succeeded':
      return { status: 'ready', source: action.source, selection: null, error: null };
    case 'import-failed':
      return { ...state, status: state.source ? 'ready' : 'idle', error: action.message };
    case 'selection-changed':
      return { ...state, selection: action.selection };
    case 'reset':
      return initialGifStudioState;
    default:
      return state;
  }
}
