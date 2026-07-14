import { commitEditHistory, createEditHistory, redoEditHistory, undoEditHistory } from './editHistory';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

let history = createEditHistory(0);
for (let value = 1; value <= 60; value += 1) history = commitEditHistory(history, value);
assert(history.past.length === 50, 'history past는 50개로 제한되어야 합니다.');
assert(history.past[0] === 10 && history.present === 60, 'history cap 이후 최신 상태가 보존되어야 합니다.');

history = undoEditHistory(history);
assert(history.present === 59 && history.future.length === 1, 'undo가 현재 상태를 future로 이동해야 합니다.');
history = redoEditHistory(history);
assert(history.present === 60 && history.future.length === 0, 'redo가 future 상태를 복원해야 합니다.');

history = undoEditHistory(history);
history = commitEditHistory(history, 100);
assert(history.present === 100 && history.future.length === 0, '새 편집은 redo 이력을 제거해야 합니다.');

console.log('GIF edit history undo/redo and 50-entry cap verified');
