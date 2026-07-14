import { buildPsdLayerTree, countPsdLayers, flattenPsdLayerTree } from './psdLayers';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const tree = buildPsdLayerTree([
  {
    id: 10,
    name: 'Hidden group',
    hidden: true,
    children: [{ id: 11, name: 'Text', left: -10, top: 10, right: 120, bottom: 90, text: { text: 'Hello' } }],
  },
  { id: 12, name: 'Empty', left: 20, top: 20, right: 20, bottom: 40 },
  { id: 13, name: 'Pixels', left: 5, top: 6, right: 25, bottom: 36, rawData: {} },
], 100, 80);

const flat = flattenPsdLayerTree(tree);
assert(countPsdLayers([
  { children: [{}, {}] },
  {},
]) === 4, '중첩 PSD 레이어 수 계산 실패');
assert(flat.map(layer => layer.name).join('|') === 'Hidden group|Text|Empty|Pixels', 'PSD 레이어 순서 보존 실패');
assert(flat[1].depth === 1 && flat[1].hasText && !flat[1].visible, 'PSD 중첩 메타데이터 보존 실패');
assert(JSON.stringify(flat[1].bounds) === JSON.stringify({ x: 0, y: 10, width: 100, height: 70 }), 'PSD bounds clamp 실패');
assert(!flat[0].selectable && !flat[2].selectable && flat[3].selectable, '빈 레이어 및 그룹 선택 제한 실패');

console.log('PSD layer tree, order, visibility, and clamped bounds verified');
