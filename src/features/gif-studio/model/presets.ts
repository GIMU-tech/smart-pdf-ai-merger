import type {
  FrameState,
  GifPresetId,
  PresetDefinition,
  PresetParams,
  PresetTargetContext,
  Rect,
} from './types';

const DEFAULT_ACCENT_COLOR = '#ec4899';
const COMMON_PARAMS = { intensity: 0.7, accentColor: DEFAULT_ACCENT_COLOR, direction: 'ltr' } as const;

export const GIF_PRESET_DEFINITIONS: readonly PresetDefinition[] = [
  {
    id: 'marker-sweep',
    label: '마커 스윕',
    description: '선택 영역을 마커가 가로질러 강조합니다.',
    supportedTargets: ['object', 'region'],
    defaultDurationMs: 1600,
    defaultParams: { ...COMMON_PARAMS },
  },
  {
    id: 'spotlight',
    label: '스포트라이트',
    description: '주변을 어둡게 하여 선택 영역에 시선을 모읍니다.',
    supportedTargets: ['object', 'region'],
    defaultDurationMs: 1800,
    defaultParams: { ...COMMON_PARAMS, intensity: 0.65 },
  },
  {
    id: 'border-pulse',
    label: '테두리 펄스',
    description: '선택 영역의 테두리를 부드럽게 맥동시킵니다.',
    supportedTargets: ['object', 'region'],
    defaultDurationMs: 1400,
    defaultParams: { ...COMMON_PARAMS, intensity: 0.75 },
  },
  {
    id: 'fade-pulse',
    label: '페이드 펄스',
    description: '선택 영역에 색상 페이드를 맥동시켜 강조합니다.',
    supportedTargets: ['object', 'region'],
    defaultDurationMs: 1400,
    defaultParams: { ...COMMON_PARAMS, intensity: 0.6 },
  },
  {
    id: 'light-sweep',
    label: '라이트 스윕',
    description: '선택 영역 위로 빛의 띠를 지나가게 합니다.',
    supportedTargets: ['object', 'region'],
    defaultDurationMs: 1600,
    defaultParams: { ...COMMON_PARAMS, intensity: 0.75 },
  },
  {
    id: 'click-pointer',
    label: '클릭 포인터',
    description: '포인터와 클릭 링으로 선택 위치를 안내합니다.',
    supportedTargets: ['object', 'region'],
    defaultDurationMs: 1600,
    defaultParams: { ...COMMON_PARAMS, intensity: 0.8 },
  },
  {
    id: 'pop-zoom',
    label: '팝·줌',
    description: '선택 객체 crop을 원본 위에 확대 복제해 강조합니다.',
    supportedTargets: ['object'],
    defaultDurationMs: 1400,
    defaultParams: { ...COMMON_PARAMS, intensity: 0.7 },
  },
];

export const DEFAULT_GIF_PRESET = GIF_PRESET_DEFINITIONS[0];

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function pulseAt(progress: number) {
  if (progress === 0 || progress === 1) return 0;
  return Math.sin(Math.PI * progress);
}

function validAccentColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : DEFAULT_ACCENT_COLOR;
}

export function getPresetAvailability(presetId: GifPresetId, context: PresetTargetContext) {
  const preset = GIF_PRESET_DEFINITIONS.find(candidate => candidate.id === presetId);
  if (!preset) return { supported: false, reason: '알 수 없는 프리셋입니다.' } as const;
  if (!context.selectionKind) {
    return { supported: false, reason: '먼저 객체 또는 영역을 선택해 주세요.' } as const;
  }
  if (presetId === 'pop-zoom' && context.sourceFormat === 'pdf') {
    return { supported: false, reason: '팝·줌은 PDF에서 지원하지 않습니다.' } as const;
  }
  if (presetId === 'pop-zoom' && (context.sourceFormat === 'ai' || context.sourceFormat === 'eps')) {
    return { supported: false, reason: '팝·줌은 AI/EPS에서 지원하지 않습니다.' } as const;
  }
  if (!preset.supportedTargets.includes(context.selectionKind)) {
    return { supported: false, reason: '팝·줌은 객체 선택에서만 사용할 수 있습니다.' } as const;
  }
  return { supported: true, reason: null } as const;
}

/**
 * Returns an absolute frame description from immutable inputs. Preview and
 * future export rendering must both use this evaluator.
 */
export function evaluatePreset(
  presetId: GifPresetId,
  progress: number,
  selection: Rect,
  params: PresetParams,
): FrameState {
  const normalizedProgress = clamp(progress, 0, 1);
  const intensity = clamp(params.intensity, 0, 1);
  const color = validAccentColor(params.accentColor);
  const direction = params.direction === 'rtl' ? 'rtl' : 'ltr';
  const width = Math.max(0, selection.width);
  const height = Math.max(0, selection.height);
  const pulse = pulseAt(normalizedProgress);
  const minimumSide = Math.max(1, Math.min(width, height));

  if (presetId === 'marker-sweep') {
    const markerWidth = Math.max(1, width * (0.18 + intensity * 0.22));
    const startX = direction === 'ltr' ? selection.x - markerWidth : selection.x + width;
    const endX = direction === 'ltr' ? selection.x + width : selection.x - markerWidth;

    return {
      progress: normalizedProgress,
      overlay: {
        kind: 'marker-sweep',
        clipRect: { ...selection, width, height },
        markerRect: {
          x: startX + (endX - startX) * normalizedProgress,
          y: selection.y,
          width: markerWidth,
          height,
        },
        opacity: 0.22 + intensity * 0.38,
        color,
      },
    };
  }

  if (presetId === 'spotlight') {
    return {
      progress: normalizedProgress,
      overlay: {
        kind: 'spotlight',
        focusRect: { ...selection, width, height },
        dimOpacity: 0.2 + intensity * 0.5,
        haloOpacity: 0.25 + pulse * (0.35 + intensity * 0.3),
        haloWidth: Math.max(2, minimumSide * 0.018 * (0.7 + intensity * 0.8)),
        haloInset: -(2 + pulse * intensity * 6),
        color,
      },
    };
  }

  if (presetId === 'fade-pulse') {
    return {
      progress: normalizedProgress,
      overlay: {
        kind: 'fade-pulse',
        targetRect: { ...selection, width, height },
        opacity: pulse * (0.1 + intensity * 0.32),
        color,
      },
    };
  }

  if (presetId === 'light-sweep') {
    const sweepWidth = Math.max(2, width * (0.16 + intensity * 0.16));
    const startX = direction === 'ltr' ? selection.x - sweepWidth : selection.x + width;
    const endX = direction === 'ltr' ? selection.x + width : selection.x - sweepWidth;
    return {
      progress: normalizedProgress,
      overlay: {
        kind: 'light-sweep',
        clipRect: { ...selection, width, height },
        sweepRect: {
          x: startX + (endX - startX) * normalizedProgress,
          y: selection.y,
          width: sweepWidth,
          height,
        },
        opacity: 0.28 + intensity * 0.52,
        blur: Math.max(2, minimumSide * (0.02 + intensity * 0.04)),
        direction,
        color,
      },
    };
  }

  if (presetId === 'click-pointer') {
    const size = Math.max(12, minimumSide * (0.16 + intensity * 0.08));
    const targetX = selection.x + width * (direction === 'ltr' ? 0.58 : 0.42);
    const targetY = selection.y + height * 0.62;
    const startX = direction === 'ltr' ? selection.x - size : selection.x + width + size;
    return {
      progress: normalizedProgress,
      overlay: {
        kind: 'click-pointer',
        x: startX + (targetX - startX) * Math.min(1, normalizedProgress * 2),
        y: selection.y + height + size + (targetY - selection.y - height - size) * Math.min(1, normalizedProgress * 2),
        size,
        opacity: 0.35 + intensity * 0.65,
        flipX: direction === 'rtl',
        clickX: targetX,
        clickY: targetY,
        ringRadius: size * (0.35 + pulse * 0.65),
        ringOpacity: pulse * intensity,
        color,
      },
    };
  }

  if (presetId === 'pop-zoom') {
    const scale = 1 + pulse * (0.06 + intensity * 0.16);
    const destinationWidth = width * scale;
    const destinationHeight = height * scale;
    return {
      progress: normalizedProgress,
      overlay: {
        kind: 'pop-zoom',
        sourceRect: { ...selection, width, height },
        destinationRect: {
          x: selection.x + (width - destinationWidth) / 2,
          y: selection.y + (height - destinationHeight) / 2,
          width: destinationWidth,
          height: destinationHeight,
        },
        scale,
        opacity: pulse,
        borderWidth: Math.max(1, minimumSide * 0.01),
        shadowBlur: Math.max(4, minimumSide * 0.08 * intensity),
        color,
      },
    };
  }

  return {
    progress: normalizedProgress,
    overlay: {
      kind: 'border-pulse',
      borderRect: { ...selection, width, height },
      opacity: 0.35 + pulse * 0.65,
      lineWidth: Math.max(2, minimumSide * 0.012 * (0.75 + pulse * intensity * 1.25)),
      color,
    },
  };
}
