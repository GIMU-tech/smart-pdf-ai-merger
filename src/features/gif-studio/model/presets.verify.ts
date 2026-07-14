import { evaluatePreset, getPresetAvailability, GIF_PRESET_DEFINITIONS } from './presets';

const selection = { x: 20, y: 30, width: 200, height: 100 };
const boundaries = [0, 0.5, 1] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

for (const preset of GIF_PRESET_DEFINITIONS) {
  for (const progress of boundaries) {
    const first = evaluatePreset(preset.id, progress, selection, preset.defaultParams);
    const second = evaluatePreset(preset.id, progress, selection, preset.defaultParams);
    assert(JSON.stringify(first) === JSON.stringify(second), `${preset.id}@${progress} 결과가 결정적이지 않습니다.`);
    assert(first.progress === progress, `${preset.id}@${progress} 진행률 경계값이 보존되지 않았습니다.`);
    assert(Number.isFinite(first.progress), `${preset.id}@${progress} 결과에 유효하지 않은 수가 있습니다.`);
  }
}

const markerParams = { intensity: 0.7, accentColor: '#ec4899', direction: 'ltr' } as const;
const markerStart = evaluatePreset('marker-sweep', 0, selection, markerParams);
const markerEnd = evaluatePreset('marker-sweep', 1, selection, markerParams);
assert(markerStart.overlay.kind === 'marker-sweep', '마커 스윕 시작 프레임 종류가 잘못되었습니다.');
assert(markerEnd.overlay.kind === 'marker-sweep', '마커 스윕 종료 프레임 종류가 잘못되었습니다.');
assert(markerStart.overlay.markerRect.x < selection.x, '마커 스윕이 선택 영역 밖에서 시작하지 않습니다.');
assert(markerEnd.overlay.markerRect.x === selection.x + selection.width, '마커 스윕이 선택 영역 끝에서 종료하지 않습니다.');

const customLight = evaluatePreset('light-sweep', 0.5, selection, {
  intensity: 0.8,
  accentColor: '#123ABC',
  direction: 'rtl',
});
assert(customLight.overlay.kind === 'light-sweep', '라이트 스윕 프레임 종류가 잘못되었습니다.');
assert(customLight.overlay.color === '#123ABC', '검증된 강조 색상이 evaluator에 전달되지 않았습니다.');
assert(customLight.overlay.direction === 'rtl', '방향 설정이 evaluator에 전달되지 않았습니다.');

const fallbackColor = evaluatePreset('fade-pulse', 0.5, selection, {
  intensity: 0.5,
  accentColor: 'red',
  direction: 'ltr',
});
assert(fallbackColor.overlay.kind === 'fade-pulse', '페이드 펄스 프레임 종류가 잘못되었습니다.');
assert(fallbackColor.overlay.color === '#ec4899', '잘못된 강조 색상이 기본 #RRGGBB로 대체되지 않았습니다.');

for (const preset of GIF_PRESET_DEFINITIONS.filter(candidate => candidate.id !== 'pop-zoom')) {
  assert(getPresetAvailability(preset.id, { selectionKind: 'object', sourceFormat: 'svg' }).supported, `${preset.id} 객체 지원이 누락되었습니다.`);
  assert(getPresetAvailability(preset.id, { selectionKind: 'region', sourceFormat: 'pdf' }).supported, `${preset.id} 영역 지원이 누락되었습니다.`);
}
assert(getPresetAvailability('pop-zoom', { selectionKind: 'object', sourceFormat: 'psd' }).supported, '팝·줌 객체 지원이 누락되었습니다.');
assert(!getPresetAvailability('pop-zoom', { selectionKind: 'region', sourceFormat: 'png' }).supported, '팝·줌 영역 선택이 비활성화되지 않았습니다.');
assert(!getPresetAvailability('pop-zoom', { selectionKind: 'object', sourceFormat: 'pdf' }).supported, '팝·줌 PDF가 비활성화되지 않았습니다.');
assert(!getPresetAvailability('pop-zoom', { selectionKind: 'object', sourceFormat: 'ai' }).supported, '팝·줌 AI가 비활성화되지 않았습니다.');

console.log('preset evaluator boundaries verified: 7 presets × [0, 0.5, 1], targets and params');
