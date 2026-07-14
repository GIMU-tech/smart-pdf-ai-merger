import { parseGifStudioProject, serializeGifStudioProject } from './projectFile';
import type { GifEditSnapshot, PngSource } from './types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function rejects(action: () => unknown, message: string) {
  let rejected = false;
  try {
    action();
  } catch {
    rejected = true;
  }
  assert(rejected, message);
}

const source: PngSource = {
  id: 'source',
  kind: 'png',
  name: 'sample.png',
  size: 1234,
  width: 800,
  height: 600,
  coordinateOrigin: { x: 0, y: 0 },
};
const snapshot: GifEditSnapshot = {
  selection: { kind: 'region', rect: { x: 10, y: 20, width: 300, height: 200 } },
  presetId: 'marker-sweep',
  durationMs: 1600,
  intensity: 0.7,
  accentColor: '#EC4899',
  direction: 'ltr',
  loopCount: 0,
};

const json = serializeGifStudioProject(source, snapshot);
assert(JSON.stringify(parseGifStudioProject(json, source).snapshot) === JSON.stringify(snapshot), 'project roundtrip이 snapshot을 보존해야 합니다.');

const invalidColor = JSON.parse(json);
invalidColor.snapshot.accentColor = 'red';
rejects(() => parseGifStudioProject(JSON.stringify(invalidColor), source), '잘못된 color를 거부해야 합니다.');

const invalidBounds = JSON.parse(json);
invalidBounds.snapshot.selection.rect.width = 900;
rejects(() => parseGifStudioProject(JSON.stringify(invalidBounds), source), '원본 밖 selection bounds를 거부해야 합니다.');

const mismatch = { ...source, size: source.size + 1 };
rejects(() => parseGifStudioProject(json, mismatch), 'source mismatch를 거부해야 합니다.');

console.log('GIF project roundtrip, color, bounds, and source fingerprint validation verified');
