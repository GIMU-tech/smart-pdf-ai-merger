import { useEffect, useRef, useState } from 'react';
import { evaluatePreset } from '../model/presets';
import type { GifImageSource, GifPresetId, PresetDirection, Rect } from '../model/types';
import { renderPresetFrame } from '../render/renderPresetFrame';

interface GifPreviewCanvasProps {
  imageUrl: string;
  source: GifImageSource;
  selection: Rect | null;
  presetId: GifPresetId;
  progress: number;
  intensity: number;
  accentColor: string;
  direction: PresetDirection;
}

export function GifPreviewCanvas({
  imageUrl,
  source,
  selection,
  presetId,
  progress,
  intensity,
  accentColor,
  direction,
}: GifPreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageReady, setImageReady] = useState(false);

  useEffect(() => {
    const image = new Image();
    let cancelled = false;
    setImageReady(false);
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      setImageReady(true);
    };
    image.src = imageUrl;

    return () => {
      cancelled = true;
      imageRef.current = null;
      image.src = '';
    };
  }, [imageUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !imageReady) return;

    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext('2d');
    if (!context) return;

    const frame = selection && selection.width > 0 && selection.height > 0
      ? evaluatePreset(presetId, progress, selection, { intensity, accentColor, direction })
      : null;
    renderPresetFrame(context, image, source.width, source.height, frame);
  }, [accentColor, direction, imageReady, intensity, presetId, progress, selection, source.height, source.width]);

  return (
    <figure className="flex min-h-0 flex-1 flex-col" aria-labelledby="gif-preview-caption">
      <div
        className="flex min-h-[300px] flex-1 items-center justify-center overflow-auto bg-slate-100 p-5 sm:p-6"
        style={{
          backgroundImage: 'linear-gradient(45deg, rgba(148,163,184,.12) 25%, transparent 25%), linear-gradient(-45deg, rgba(148,163,184,.12) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(148,163,184,.12) 75%), linear-gradient(-45deg, transparent 75%, rgba(148,163,184,.12) 75%)',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
          backgroundSize: '16px 16px',
        }}
      >
        <canvas
          ref={canvasRef}
          className="h-auto max-w-full rounded-sm bg-white shadow-[0_18px_50px_rgba(15,23,42,0.18)]"
          style={{ maxHeight: 'min(48vh, 540px)' }}
          aria-label={`${source.name} 애니메이션 미리보기`}
        />
      </div>
      <figcaption id="gif-preview-caption" className="sr-only">선택 핸들이 없는 프리셋 미리보기 캔버스</figcaption>
    </figure>
  );
}
