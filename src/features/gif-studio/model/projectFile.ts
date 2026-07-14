import { getPresetAvailability, GIF_PRESET_DEFINITIONS } from './presets';
import type {
  GifEditSnapshot,
  GifImageSource,
  GifSelection,
  GifSourceFingerprint,
  GifStudioProjectFile,
  PresetSourceFormat,
  Rect,
} from './types';

export const GIF_STUDIO_PROJECT_MAX_BYTES = 256 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sourceFormat(source: GifImageSource): PresetSourceFormat {
  if (/\.ai$/i.test(source.name)) return 'ai';
  if (/\.eps$/i.test(source.name)) return 'eps';
  return source.kind;
}

export function createSourceFingerprint(source: GifImageSource): GifSourceFingerprint {
  const fingerprint: GifSourceFingerprint = {
    kind: source.kind,
    name: source.name,
    size: source.size,
    width: source.width,
    height: source.height,
  };
  if (source.kind === 'pdf') fingerprint.page = source.currentPage;
  return fingerprint;
}

function parseRect(value: unknown, source: GifImageSource): Rect {
  if (!isRecord(value) || !hasExactKeys(value, ['x', 'y', 'width', 'height'])) {
    throw new Error('selection.rect 키가 올바르지 않습니다.');
  }
  const { x, y, width, height } = value;
  if (![x, y, width, height].every(isFiniteNumber) || (width as number) <= 0 || (height as number) <= 0) {
    throw new Error('selection.rect 값이 올바르지 않습니다.');
  }
  const origin = source.coordinateOrigin;
  const right = (x as number) + (width as number);
  const bottom = (y as number) + (height as number);
  if (
    (x as number) < origin.x
    || (y as number) < origin.y
    || right > origin.x + source.width
    || bottom > origin.y + source.height
  ) {
    throw new Error('selection.rect가 현재 원본 경계를 벗어났습니다.');
  }
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

function parseSelection(value: unknown, source: GifImageSource): GifSelection | null {
  if (value === null) return null;
  if (!isRecord(value) || (value.kind !== 'region' && value.kind !== 'object')) {
    throw new Error('selection 형식이 올바르지 않습니다.');
  }
  if (value.kind === 'region') {
    if (!hasExactKeys(value, ['kind', 'rect'])) throw new Error('region selection 키가 올바르지 않습니다.');
    return { kind: 'region', rect: parseRect(value.rect, source) };
  }
  if (!hasExactKeys(value, ['kind', 'rect', 'objectId', 'objectType', 'label'])) {
    throw new Error('object selection 키가 올바르지 않습니다.');
  }
  for (const key of ['objectId', 'objectType', 'label'] as const) {
    if (typeof value[key] !== 'string' || value[key].length === 0 || value[key].length > 1024) {
      throw new Error(`selection.${key} 값이 올바르지 않습니다.`);
    }
  }
  return {
    kind: 'object',
    rect: parseRect(value.rect, source),
    objectId: value.objectId as string,
    objectType: value.objectType as string,
    label: value.label as string,
  };
}

function assertFingerprint(value: unknown, source: GifImageSource): GifSourceFingerprint {
  if (!isRecord(value)) throw new Error('source fingerprint 형식이 올바르지 않습니다.');
  const expected = createSourceFingerprint(source);
  const keys = source.kind === 'pdf'
    ? ['kind', 'name', 'size', 'width', 'height', 'page']
    : ['kind', 'name', 'size', 'width', 'height'];
  if (!hasExactKeys(value, keys)) throw new Error('source fingerprint 키가 올바르지 않습니다.');
  for (const key of keys) {
    if (value[key] !== expected[key as keyof GifSourceFingerprint]) {
      throw new Error('현재 원본과 프로젝트의 source fingerprint가 일치하지 않습니다.');
    }
  }
  return expected;
}

function parseSnapshot(value: unknown, source: GifImageSource): GifEditSnapshot {
  const keys = ['selection', 'presetId', 'durationMs', 'intensity', 'accentColor', 'direction', 'loopCount'];
  if (!isRecord(value) || !hasExactKeys(value, keys)) throw new Error('snapshot 키가 올바르지 않습니다.');
  const preset = GIF_PRESET_DEFINITIONS.find(candidate => candidate.id === value.presetId);
  if (!preset) throw new Error('지원하지 않는 presetId입니다.');
  if (!Number.isInteger(value.durationMs) || (value.durationMs as number) < 600 || (value.durationMs as number) > 4000) {
    throw new Error('durationMs 값이 올바르지 않습니다.');
  }
  if (!isFiniteNumber(value.intensity) || value.intensity < 0 || value.intensity > 1) {
    throw new Error('intensity 값이 올바르지 않습니다.');
  }
  if (typeof value.accentColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.accentColor)) {
    throw new Error('accentColor 값이 올바르지 않습니다.');
  }
  if (value.direction !== 'ltr' && value.direction !== 'rtl') throw new Error('direction 값이 올바르지 않습니다.');
  if (!Number.isInteger(value.loopCount) || (value.loopCount as number) < 0 || (value.loopCount as number) > 3) {
    throw new Error('loopCount 값이 올바르지 않습니다.');
  }
  const selection = parseSelection(value.selection, source);
  if (selection && !getPresetAvailability(preset.id, { selectionKind: selection.kind, sourceFormat: sourceFormat(source) }).supported) {
    throw new Error('현재 원본과 selection에서 지원하지 않는 presetId입니다.');
  }
  return {
    selection,
    presetId: preset.id,
    durationMs: value.durationMs as number,
    intensity: value.intensity,
    accentColor: value.accentColor,
    direction: value.direction,
    loopCount: value.loopCount as number,
  };
}

export function parseGifStudioProject(json: string, source: GifImageSource): GifStudioProjectFile {
  if (new TextEncoder().encode(json).byteLength > GIF_STUDIO_PROJECT_MAX_BYTES) {
    throw new Error('프로젝트 JSON은 256KB 이하여야 합니다.');
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    throw new Error('유효한 JSON 파일이 아닙니다.');
  }
  if (!isRecord(decoded) || !hasExactKeys(decoded, ['schemaVersion', 'source', 'snapshot'])) {
    throw new Error('프로젝트 최상위 키가 올바르지 않습니다.');
  }
  if (decoded.schemaVersion !== 1) throw new Error('지원하지 않는 schemaVersion입니다.');
  return {
    schemaVersion: 1,
    source: assertFingerprint(decoded.source, source),
    snapshot: parseSnapshot(decoded.snapshot, source),
  };
}

export function serializeGifStudioProject(source: GifImageSource, snapshot: GifEditSnapshot) {
  const project: GifStudioProjectFile = {
    schemaVersion: 1,
    source: createSourceFingerprint(source),
    snapshot,
  };
  const json = JSON.stringify(project, null, 2);
  parseGifStudioProject(json, source);
  return json;
}
