export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type GifPresetId =
  | 'marker-sweep'
  | 'spotlight'
  | 'border-pulse'
  | 'fade-pulse'
  | 'light-sweep'
  | 'click-pointer'
  | 'pop-zoom';

export type PresetDirection = 'ltr' | 'rtl';
export type PresetTarget = 'object' | 'region';
export type PresetSourceFormat = 'png' | 'svg' | 'psd' | 'pdf' | 'ai' | 'eps' | 'html';

export interface PresetParams {
  intensity: number;
  accentColor: string;
  direction: PresetDirection;
}

export type PresetOverlay =
  | {
      kind: 'marker-sweep';
      clipRect: Rect;
      markerRect: Rect;
      opacity: number;
      color: string;
    }
  | {
      kind: 'spotlight';
      focusRect: Rect;
      dimOpacity: number;
      haloOpacity: number;
      haloWidth: number;
      haloInset: number;
      color: string;
    }
  | {
      kind: 'border-pulse';
      borderRect: Rect;
      opacity: number;
      lineWidth: number;
      color: string;
    }
  | {
      kind: 'fade-pulse';
      targetRect: Rect;
      opacity: number;
      color: string;
    }
  | {
      kind: 'light-sweep';
      clipRect: Rect;
      sweepRect: Rect;
      opacity: number;
      blur: number;
      direction: PresetDirection;
      color: string;
    }
  | {
      kind: 'click-pointer';
      x: number;
      y: number;
      size: number;
      opacity: number;
      flipX: boolean;
      clickX: number;
      clickY: number;
      ringRadius: number;
      ringOpacity: number;
      color: string;
    }
  | {
      kind: 'pop-zoom';
      sourceRect: Rect;
      destinationRect: Rect;
      scale: number;
      opacity: number;
      borderWidth: number;
      shadowBlur: number;
      color: string;
    };

export interface FrameState {
  progress: number;
  overlay: PresetOverlay;
}

export interface PresetDefinition {
  id: GifPresetId;
  label: string;
  description: string;
  supportedTargets: PresetTarget[];
  defaultDurationMs: number;
  defaultParams: PresetParams;
}

export interface PresetTargetContext {
  selectionKind: PresetTarget | null;
  sourceFormat: PresetSourceFormat | null;
}

interface BaseImageSource {
  id: string;
  name: string;
  size: number;
  width: number;
  height: number;
  coordinateOrigin: { x: number; y: number };
}

export interface PngSource extends BaseImageSource {
  kind: 'png';
}

export interface SvgSource extends BaseImageSource {
  kind: 'svg';
  sanitizedMarkup: string;
  objectCount: number;
  securityReport: string[];
}

export interface HtmlSource extends BaseImageSource {
  kind: 'html';
  sanitizedSrcdoc: string;
  objectCount: number;
  securityReport: string[];
}

export type PsdLayerType = 'group' | 'text' | 'smart-object' | 'adjustment' | 'shape' | 'pixel' | 'empty';

export interface PsdLayerNode {
  id: string;
  name: string;
  depth: number;
  visible: boolean;
  type: PsdLayerType;
  bounds: Rect | null;
  hasText: boolean;
  selectable: boolean;
  children: PsdLayerNode[];
}

export interface PsdSource extends BaseImageSource {
  kind: 'psd';
  layerTree: PsdLayerNode[];
  layerCount: number;
  selectableLayerCount: number;
  warnings: string[];
}

export interface PdfSource extends BaseImageSource {
  kind: 'pdf';
  pageCount: number;
  currentPage: number;
  pageWidth: number;
  pageHeight: number;
  renderScale: number;
}

export type GifImageSource = PngSource | SvgSource | PsdSource | PdfSource | HtmlSource;

export type GifSelection =
  | { kind: 'region'; rect: Rect }
  | {
      kind: 'object';
      rect: Rect;
      objectId: string;
      objectType: string;
      label: string;
    };

export function selectionRect(selection: GifSelection | null) {
  return selection?.rect ?? null;
}

export function selectionRectForCanvas(selection: GifSelection | null, source: GifImageSource): Rect | null {
  if (!selection) return null;
  return {
    x: selection.rect.x - source.coordinateOrigin.x,
    y: selection.rect.y - source.coordinateOrigin.y,
    width: selection.rect.width,
    height: selection.rect.height,
  };
}

export interface GifStudioState {
  status: 'idle' | 'importing' | 'ready';
  source: GifImageSource | null;
  selection: GifSelection | null;
  error: string | null;
}

export interface GifEditSnapshot {
  selection: GifSelection | null;
  presetId: GifPresetId;
  durationMs: number;
  intensity: number;
  accentColor: string;
  direction: PresetDirection;
  loopCount: number;
}

export interface GifSourceFingerprint {
  kind: GifImageSource['kind'];
  name: string;
  size: number;
  width: number;
  height: number;
  page?: number;
}

export interface GifStudioProjectFile {
  schemaVersion: 1;
  source: GifSourceFingerprint;
  snapshot: GifEditSnapshot;
}
