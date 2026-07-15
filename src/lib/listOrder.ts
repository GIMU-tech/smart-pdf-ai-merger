type ItemId = string;

function sameOrder<T>(left: T[], right: T[], getId: (item: T) => ItemId) {
  return left.length === right.length && left.every((item, index) => getId(item) === getId(right[index]));
}

export function moveSelectedItemsToPosition<T>(
  items: T[],
  selectedIds: Iterable<ItemId>,
  position: number,
  getId: (item: T) => ItemId,
) {
  const selected = new Set(selectedIds);
  const moving = items.filter(item => selected.has(getId(item)));
  if (moving.length === 0) return items;

  const remaining = items.filter(item => !selected.has(getId(item)));
  const insertIndex = Math.min(Math.max(position - 1, 0), remaining.length);
  const next = [
    ...remaining.slice(0, insertIndex),
    ...moving,
    ...remaining.slice(insertIndex),
  ];
  return sameOrder(items, next, getId) ? items : next;
}

export function moveSelectedItemsAroundTarget<T>(
  items: T[],
  selectedIds: Iterable<ItemId>,
  targetId: ItemId,
  position: 'before' | 'after',
  getId: (item: T) => ItemId,
) {
  const selected = new Set(selectedIds);
  if (selected.size === 0 || selected.has(targetId)) return items;

  const moving = items.filter(item => selected.has(getId(item)));
  const remaining = items.filter(item => !selected.has(getId(item)));
  const targetIndex = remaining.findIndex(item => getId(item) === targetId);
  if (moving.length === 0 || targetIndex < 0) return items;

  const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
  const next = [
    ...remaining.slice(0, insertIndex),
    ...moving,
    ...remaining.slice(insertIndex),
  ];
  return sameOrder(items, next, getId) ? items : next;
}
