import type { PsdLayerNode, PsdLayerType, Rect } from '../model/types';

export interface PsdLayerLike {
  id?: number;
  name?: string;
  top?: number;
  left?: number;
  bottom?: number;
  right?: number;
  hidden?: boolean;
  text?: { text?: string };
  canvas?: unknown;
  imageData?: unknown;
  rawData?: unknown;
  placedLayer?: unknown;
  adjustment?: unknown;
  vectorFill?: unknown;
  vectorMask?: unknown;
  children?: PsdLayerLike[];
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function clampPsdBounds(
  layer: Pick<PsdLayerLike, 'left' | 'top' | 'right' | 'bottom'>,
  canvasWidth: number,
  canvasHeight: number,
): Rect | null {
  const left = finiteNumber(layer.left, 0);
  const top = finiteNumber(layer.top, 0);
  const right = finiteNumber(layer.right, left);
  const bottom = finiteNumber(layer.bottom, top);
  if (right <= left || bottom <= top) return null;

  const x = Math.max(0, Math.min(canvasWidth, left));
  const y = Math.max(0, Math.min(canvasHeight, top));
  const clampedRight = Math.max(0, Math.min(canvasWidth, right));
  const clampedBottom = Math.max(0, Math.min(canvasHeight, bottom));
  if (clampedRight <= x || clampedBottom <= y) return null;
  return { x, y, width: clampedRight - x, height: clampedBottom - y };
}

function layerType(layer: PsdLayerLike): PsdLayerType {
  if (Array.isArray(layer.children)) return 'group';
  if (typeof layer.text?.text === 'string') return 'text';
  if (layer.placedLayer) return 'smart-object';
  if (layer.adjustment) return 'adjustment';
  if (layer.vectorFill || layer.vectorMask) return 'shape';
  if (layer.canvas || layer.imageData || layer.rawData) return 'pixel';
  return 'empty';
}

export function countPsdLayers(layers: readonly PsdLayerLike[] | undefined) {
  if (!layers?.length) return 0;
  let count = 0;
  const pending = [...layers];
  while (pending.length > 0) {
    const layer = pending.pop();
    if (!layer) continue;
    count += 1;
    if (layer.children?.length) pending.push(...layer.children);
  }
  return count;
}

export function buildPsdLayerTree(
  layers: readonly PsdLayerLike[] | undefined,
  canvasWidth: number,
  canvasHeight: number,
  depth = 0,
  parentVisible = true,
  path = 'root',
): PsdLayerNode[] {
  if (!layers?.length) return [];
  return layers.map((layer, index) => {
    const nodePath = `${path}-${index}`;
    const type = layerType(layer);
    const bounds = clampPsdBounds(layer, canvasWidth, canvasHeight);
    const visible = parentVisible && !layer.hidden;
    const hasText = typeof layer.text?.text === 'string' && layer.text.text.trim().length > 0;
    return {
      id: typeof layer.id === 'number' ? `psd-${layer.id}-${nodePath}` : `psd-${nodePath}`,
      name: layer.name?.trim() || (type === 'group' ? 'Group' : 'Layer'),
      depth,
      visible,
      type,
      bounds,
      hasText,
      selectable: type !== 'group' && type !== 'empty' && bounds !== null,
      children: buildPsdLayerTree(layer.children, canvasWidth, canvasHeight, depth + 1, visible, nodePath),
    };
  });
}

export function flattenPsdLayerTree(tree: readonly PsdLayerNode[]) {
  const flattened: PsdLayerNode[] = [];
  const pending = [...tree].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    flattened.push(node);
    for (let index = node.children.length - 1; index >= 0; index -= 1) pending.push(node.children[index]);
  }
  return flattened;
}
