export const GIF_EDIT_HISTORY_LIMIT = 50;

export interface EditHistory<T> {
  past: T[];
  present: T;
  future: T[];
}

function equalValue<T>(left: T, right: T) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createEditHistory<T>(present: T): EditHistory<T> {
  return { past: [], present, future: [] };
}

export function resetEditHistory<T>(present: T): EditHistory<T> {
  return createEditHistory(present);
}

export function commitEditHistory<T>(history: EditHistory<T>, next: T): EditHistory<T> {
  if (equalValue(history.present, next)) return history;
  return {
    past: [...history.past, history.present].slice(-GIF_EDIT_HISTORY_LIMIT),
    present: next,
    future: [],
  };
}

export function undoEditHistory<T>(history: EditHistory<T>): EditHistory<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, GIF_EDIT_HISTORY_LIMIT),
  };
}

export function redoEditHistory<T>(history: EditHistory<T>): EditHistory<T> {
  const next = history.future[0];
  if (next === undefined) return history;
  return {
    past: [...history.past, history.present].slice(-GIF_EDIT_HISTORY_LIMIT),
    present: next,
    future: history.future.slice(1),
  };
}
