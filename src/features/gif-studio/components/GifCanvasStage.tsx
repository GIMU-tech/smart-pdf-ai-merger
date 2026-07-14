import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { GifImageSource, GifSelection, HtmlSource, Rect, SvgSource } from '../model/types';
import { clientPointToSvg, relativeSvgMatrix, transformSvgRect } from '../utils/svgGeometry';

interface GifCanvasStageProps {
  imageUrl: string;
  source: GifImageSource;
  selection: GifSelection | null;
  onSelectionChange: (selection: GifSelection | null) => void;
  onSelectionGestureStart: () => void;
  onSelectionGestureEnd: () => void;
}

interface Point {
  x: number;
  y: number;
}

function normalizeRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function RasterCanvasStage({
  imageUrl,
  source,
  selection,
  onSelectionChange,
  onSelectionGestureStart,
  onSelectionGestureEnd,
}: GifCanvasStageProps & { source: Exclude<GifImageSource, SvgSource | HtmlSource> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragStartRef = useRef<Point | null>(null);
  const activePointerRef = useRef<number | null>(null);
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
    context.clearRect(0, 0, source.width, source.height);
    context.drawImage(image, 0, 0, source.width, source.height);
    const rect = selection?.rect;
    if (rect && rect.width > 0 && rect.height > 0) {
      context.fillStyle = 'rgba(15, 23, 42, 0.42)';
      context.fillRect(0, 0, source.width, source.height);
      context.drawImage(image, rect.x, rect.y, rect.width, rect.height, rect.x, rect.y, rect.width, rect.height);
      context.strokeStyle = '#ec4899';
      context.lineWidth = Math.max(2, Math.min(source.width, source.height) / 300);
      context.setLineDash([context.lineWidth * 2.5, context.lineWidth * 1.5]);
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      context.setLineDash([]);
    }
  }, [imageReady, selection, source.height, source.width]);

  const pointFromPointer = (event: ReactPointerEvent<HTMLCanvasElement>): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;
    return {
      x: Math.max(0, Math.min(source.width, ((event.clientX - bounds.left) / bounds.width) * source.width)),
      y: Math.max(0, Math.min(source.height, ((event.clientY - bounds.top) / bounds.height) * source.height)),
    };
  };

  const finishSelection = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId || !dragStartRef.current) return;
    const end = pointFromPointer(event);
    if (end) {
      const rect = normalizeRect(dragStartRef.current, end);
      onSelectionChange(rect.width >= 2 && rect.height >= 2 ? { kind: 'region', rect } : null);
    }
    dragStartRef.current = null;
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onSelectionGestureEnd();
  };

  return (
    <canvas
      ref={canvasRef}
      className="h-auto max-w-full cursor-crosshair touch-none rounded-sm bg-white shadow-[0_18px_50px_rgba(15,23,42,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-4"
      style={{ maxHeight: 'min(48vh, 540px)' }}
      tabIndex={0}
      aria-label={`${source.name} 편집 캔버스. 마우스나 터치로 드래그하여 사각 영역을 선택합니다.`}
      onPointerDown={event => {
        if (event.button !== 0) return;
        const start = pointFromPointer(event);
        if (!start) return;
        event.preventDefault();
        onSelectionGestureStart();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragStartRef.current = start;
        activePointerRef.current = event.pointerId;
        onSelectionChange({ kind: 'region', rect: { x: start.x, y: start.y, width: 0, height: 0 } });
      }}
      onPointerMove={event => {
        if (activePointerRef.current !== event.pointerId || !dragStartRef.current) return;
        const end = pointFromPointer(event);
        if (end) onSelectionChange({ kind: 'region', rect: normalizeRect(dragStartRef.current, end) });
      }}
      onPointerUp={finishSelection}
      onPointerCancel={finishSelection}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onSelectionChange(null);
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelectionChange({ kind: 'region', rect: { x: 0, y: 0, width: source.width, height: source.height } });
        }
      }}
    />
  );
}

function getSvgRoot(container: HTMLDivElement | null) {
  return container?.querySelector('svg') as SVGSVGElement | null;
}

function SvgCanvasStage({ source, selection, onSelectionChange, onSelectionGestureStart, onSelectionGestureEnd }: Omit<GifCanvasStageProps, 'imageUrl'> & { source: SvgSource }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<Point | null>(null);
  const activePointerRef = useRef<number | null>(null);

  useEffect(() => {
    const root = getSvgRoot(containerRef.current);
    if (!root) return;
    root.style.width = '100%';
    root.style.height = '100%';
    root.style.display = 'block';
  }, [source.sanitizedMarkup]);

  const pointFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const matrix = getSvgRoot(containerRef.current)?.getScreenCTM();
    if (!matrix) return null;
    const point = clientPointToSvg(event.clientX, event.clientY, matrix);
    if (!point) return null;
    return {
      x: Math.max(source.coordinateOrigin.x, Math.min(source.coordinateOrigin.x + source.width, point.x)),
      y: Math.max(source.coordinateOrigin.y, Math.min(source.coordinateOrigin.y + source.height, point.y)),
    };
  };

  const finishSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId || !dragStartRef.current) return;
    const end = pointFromPointer(event);
    if (end) {
      const rect = normalizeRect(dragStartRef.current, end);
      onSelectionChange(rect.width >= 2 && rect.height >= 2 ? { kind: 'region', rect } : null);
    }
    dragStartRef.current = null;
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onSelectionGestureEnd();
  };

  const viewBox = `${source.coordinateOrigin.x} ${source.coordinateOrigin.y} ${source.width} ${source.height}`;
  return (
    <div
      ref={containerRef}
      className="relative w-full max-w-full touch-none cursor-crosshair overflow-hidden rounded-sm bg-white shadow-[0_18px_50px_rgba(15,23,42,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-4"
      style={{ aspectRatio: `${source.width} / ${source.height}`, maxWidth: `${source.width}px`, maxHeight: 'min(48vh, 540px)' }}
      tabIndex={0}
      role="application"
      aria-label={`${source.name} SVG 편집 캔버스. 요소를 클릭하여 객체를 선택하거나 빈 영역을 드래그합니다.`}
      onPointerDown={event => {
        if (event.button !== 0) return;
        const element = (event.target as Element).closest('[data-gif-node-id]') as SVGGraphicsElement | null;
        if (element && containerRef.current?.contains(element) && typeof element.getBBox === 'function') {
          const root = getSvgRoot(containerRef.current);
          const elementMatrix = element.getScreenCTM();
          const rootMatrix = root?.getScreenCTM();
          const matrix = elementMatrix && rootMatrix ? relativeSvgMatrix(elementMatrix, rootMatrix) : null;
          if (matrix) {
            const rect = transformSvgRect(element.getBBox(), matrix);
            onSelectionGestureStart();
            onSelectionChange({
              kind: 'object',
              rect,
              objectId: element.getAttribute('data-gif-node-id') ?? '',
              objectType: element.getAttribute('data-gif-node-type') ?? element.localName,
              label: element.getAttribute('data-gif-node-label') ?? element.localName,
            });
            event.preventDefault();
            event.currentTarget.focus();
            onSelectionGestureEnd();
            return;
          }
        }
        const start = pointFromPointer(event);
        if (!start) return;
        event.preventDefault();
        onSelectionGestureStart();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragStartRef.current = start;
        activePointerRef.current = event.pointerId;
        onSelectionChange({ kind: 'region', rect: { x: start.x, y: start.y, width: 0, height: 0 } });
      }}
      onPointerMove={event => {
        if (activePointerRef.current !== event.pointerId || !dragStartRef.current) return;
        const end = pointFromPointer(event);
        if (end) onSelectionChange({ kind: 'region', rect: normalizeRect(dragStartRef.current, end) });
      }}
      onPointerUp={finishSelection}
      onPointerCancel={finishSelection}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onSelectionChange(null);
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelectionChange({
            kind: 'region',
            rect: { x: source.coordinateOrigin.x, y: source.coordinateOrigin.y, width: source.width, height: source.height },
          });
        }
      }}
    >
      <div className="absolute inset-0" dangerouslySetInnerHTML={{ __html: source.sanitizedMarkup }} />
      {selection?.rect && selection.rect.width > 0 && selection.rect.height > 0 && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <rect
            x={selection.rect.x}
            y={selection.rect.y}
            width={selection.rect.width}
            height={selection.rect.height}
            fill="rgba(236,72,153,.08)"
            stroke="#ec4899"
            strokeWidth={Math.max(1, Math.min(source.width, source.height) / 300)}
            strokeDasharray={`${Math.max(2, Math.min(source.width, source.height) / 120)} ${Math.max(2, Math.min(source.width, source.height) / 180)}`}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
    </div>
  );
}

function HtmlCanvasStage({ source, selection, onSelectionChange, onSelectionGestureStart, onSelectionGestureEnd }: Omit<GifCanvasStageProps, 'imageUrl'> & { source: HtmlSource }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const dragStartRef = useRef<Point | null>(null);
  const activePointerRef = useRef<number | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let detachDocumentListeners: (() => void) | null = null;

    const attachDocumentListeners = () => {
      detachDocumentListeners?.();
      const frameDocument = iframe.contentDocument;
      if (!frameDocument) return;

      const pointFromFrameEvent = (event: PointerEvent): Point => ({
        x: Math.max(0, Math.min(source.width, event.clientX)),
        y: Math.max(0, Math.min(source.height, event.clientY)),
      });
      const finishSelection = (event: PointerEvent) => {
        if (activePointerRef.current !== event.pointerId || !dragStartRef.current) return;
        const rect = normalizeRect(dragStartRef.current, pointFromFrameEvent(event));
        onSelectionChange(rect.width >= 2 && rect.height >= 2 ? { kind: 'region', rect } : null);
        dragStartRef.current = null;
        activePointerRef.current = null;
        onSelectionGestureEnd();
      };
      const handlePointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return;
        const target = event.target instanceof Element ? event.target : null;
        const element = target?.closest('[data-gif-node-id]') as HTMLElement | null;
        if (element && frameDocument.contains(element)) {
          const bounds = element.getBoundingClientRect();
          if (bounds.width > 0 && bounds.height > 0) {
            const left = Math.max(0, Math.min(source.width, bounds.left));
            const top = Math.max(0, Math.min(source.height, bounds.top));
            const right = Math.max(left, Math.min(source.width, bounds.right));
            const bottom = Math.max(top, Math.min(source.height, bounds.bottom));
            if (right === left || bottom === top) return;
            event.preventDefault();
            onSelectionGestureStart();
            onSelectionChange({
              kind: 'object',
              rect: {
                x: left,
                y: top,
                width: right - left,
                height: bottom - top,
              },
              objectId: element.getAttribute('data-gif-node-id') ?? '',
              objectType: element.getAttribute('data-gif-node-type') ?? element.localName,
              label: element.getAttribute('data-gif-node-label') ?? element.localName,
            });
            onSelectionGestureEnd();
            return;
          }
        }
        event.preventDefault();
        onSelectionGestureStart();
        dragStartRef.current = pointFromFrameEvent(event);
        activePointerRef.current = event.pointerId;
        onSelectionChange({ kind: 'region', rect: { ...dragStartRef.current, width: 0, height: 0 } });
      };
      const handlePointerMove = (event: PointerEvent) => {
        if (activePointerRef.current !== event.pointerId || !dragStartRef.current) return;
        onSelectionChange({ kind: 'region', rect: normalizeRect(dragStartRef.current, pointFromFrameEvent(event)) });
      };
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') onSelectionChange(null);
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelectionChange({ kind: 'region', rect: { x: 0, y: 0, width: source.width, height: source.height } });
        }
      };

      frameDocument.addEventListener('pointerdown', handlePointerDown);
      frameDocument.addEventListener('pointermove', handlePointerMove);
      frameDocument.addEventListener('pointerup', finishSelection);
      frameDocument.addEventListener('pointercancel', finishSelection);
      frameDocument.addEventListener('keydown', handleKeyDown);
      detachDocumentListeners = () => {
        frameDocument.removeEventListener('pointerdown', handlePointerDown);
        frameDocument.removeEventListener('pointermove', handlePointerMove);
        frameDocument.removeEventListener('pointerup', finishSelection);
        frameDocument.removeEventListener('pointercancel', finishSelection);
        frameDocument.removeEventListener('keydown', handleKeyDown);
      };
    };

    iframe.addEventListener('load', attachDocumentListeners);
    if (iframe.contentDocument?.readyState === 'complete') attachDocumentListeners();
    return () => {
      iframe.removeEventListener('load', attachDocumentListeners);
      detachDocumentListeners?.();
    };
  }, [onSelectionChange, onSelectionGestureEnd, onSelectionGestureStart, source.height, source.sanitizedSrcdoc, source.width]);

  return (
    <div
      className="max-h-[min(48vh,540px)] max-w-full overflow-auto rounded-sm bg-white shadow-[0_18px_50px_rgba(15,23,42,0.18)] focus-within:ring-2 focus-within:ring-pink-500 focus-within:ring-offset-4"
      style={{ width: `${source.width}px` }}
    >
      <div className="relative" style={{ width: `${source.width}px`, height: `${source.height}px` }}>
        <iframe
          ref={iframeRef}
          srcDoc={source.sanitizedSrcdoc}
          sandbox="allow-same-origin"
          title={`${source.name} 정적 HTML 편집 캔버스`}
          className="absolute inset-0 border-0 bg-white"
          style={{ width: `${source.width}px`, height: `${source.height}px` }}
        />
        {selection?.rect && selection.rect.width > 0 && selection.rect.height > 0 && (
          <svg className="pointer-events-none absolute inset-0" width={source.width} height={source.height} viewBox={`0 0 ${source.width} ${source.height}`} aria-hidden="true">
            <rect
              x={selection.rect.x}
              y={selection.rect.y}
              width={selection.rect.width}
              height={selection.rect.height}
              fill="rgba(236,72,153,.08)"
              stroke="#ec4899"
              strokeWidth={Math.max(1, Math.min(source.width, source.height) / 300)}
              strokeDasharray={`${Math.max(2, Math.min(source.width, source.height) / 120)} ${Math.max(2, Math.min(source.width, source.height) / 180)}`}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>
    </div>
  );
}

export function GifCanvasStage(props: GifCanvasStageProps) {
  return (
    <figure className="flex min-h-0 flex-1 flex-col" aria-labelledby="gif-canvas-caption">
      <div
        className="flex min-h-[300px] flex-1 items-center justify-center overflow-auto bg-slate-100 p-5 sm:p-6"
        style={{
          backgroundImage: 'linear-gradient(45deg, rgba(148,163,184,.12) 25%, transparent 25%), linear-gradient(-45deg, rgba(148,163,184,.12) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(148,163,184,.12) 75%), linear-gradient(-45deg, transparent 75%, rgba(148,163,184,.12) 75%)',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
          backgroundSize: '16px 16px',
        }}
      >
        {props.source.kind === 'svg'
          ? <SvgCanvasStage source={props.source} selection={props.selection} onSelectionChange={props.onSelectionChange} onSelectionGestureStart={props.onSelectionGestureStart} onSelectionGestureEnd={props.onSelectionGestureEnd} />
          : props.source.kind === 'html'
            ? <HtmlCanvasStage source={props.source} selection={props.selection} onSelectionChange={props.onSelectionChange} onSelectionGestureStart={props.onSelectionGestureStart} onSelectionGestureEnd={props.onSelectionGestureEnd} />
            : <RasterCanvasStage {...props} source={props.source} />}
      </div>
      <figcaption id="gif-canvas-caption" className="sr-only">PNG, SVG 또는 정적 HTML 편집 캔버스</figcaption>
    </figure>
  );
}
