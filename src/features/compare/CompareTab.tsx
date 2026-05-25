import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PDFDocument } from 'pdf-lib';
import {
  Upload, FileText, Loader2, AlertCircle, X, ZoomIn, ZoomOut,
  ChevronLeft, ChevronRight, Hash, Type, LayoutTemplate, Box,
  MoveVertical, ImageIcon, CheckCircle2, Lock, Unlock,
  Layers, Columns, Split, CheckSquare, Square, Info, Sparkles, Filter, RotateCcw, ArrowRight,
  Eye, Bot, PanelLeftClose, PanelLeft, Maximize2, Minimize2
} from 'lucide-react';
import { cn } from '../../lib/utils';

// ─── Types ─────────────────────────────────────────────────────────────────────
type Diff = {
  type: string;
  rawIndex?: number;
  severity: string;
  desc?: string;
  before?: string;
  bbox: { x: number; y: number; width: number; height: number };
  textInfo?: {
    beforeStr: string;
    afterStr: string;
    diffs: Array<[number, string]>;
  };
};

type ReviewItem = {
  id: string;
  category: 'identity' | 'spec' | 'warning' | 'text' | 'drawing' | 'layout';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  desc: string;
  before?: string;
  after?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  relatedDiffs?: number[];
  confidence?: number;
};

type PageResult = {
  page: number;
  diffs: Diff[];
  reviewItems?: ReviewItem[];
  pageSummary?: string;
  base64A: string;
  base64B: string;
};

// Visual-only pages. In vector mode each src is a single-page PDF blob URL.
type VisualPage = {
  page: number;
  imgA: string;
  imgB: string;
  aspectA?: number;
  aspectB?: number;
};

type VisualPdfUrls = {
  urls: string[];
};

type SinglePagePdfUrl = {
  url: string;
  width: number;
  height: number;
};

type CompareMode = 'ai' | 'visual';

// ─── Severity / Type Metadata ─────────────────────────────────────────────────────
const META: Record<string, { label: string; color: string; ring: string; bg: string }> = {
  number_changed: { label: 'CRITICAL', color: 'text-rose-600', ring: '#e11d48', bg: 'rgba(225,29,72,' },
  text_modified: { label: 'HIGH', color: 'text-orange-600', ring: '#ea580c', bg: 'rgba(234,88,12,' },
  layout_changed: { label: 'HIGH', color: 'text-blue-600', ring: '#2563eb', bg: 'rgba(37,99,235,' },
  shape_resized: { label: 'MEDIUM', color: 'text-purple-600', ring: '#9333ea', bg: 'rgba(147,51,234,' },
  shape_modified: { label: 'MEDIUM', color: 'text-purple-600', ring: '#9333ea', bg: 'rgba(147,51,234,' },
  spacing_changed: { label: 'LOW', color: 'text-gray-500', ring: '#64748b', bg: 'rgba(100,116,139,' },
  design_changed: { label: 'LOW', color: 'text-gray-500', ring: '#64748b', bg: 'rgba(100,116,139,' },
};

const meta = (type: string) => META[type] || META.design_changed;

const REVIEW_META: Record<ReviewItem['category'], { label: string; icon: typeof Hash; color: string; bg: string }> = {
  identity: { label: '식별 정보', icon: Hash, color: 'text-rose-700', bg: 'bg-rose-50 border-rose-100' },
  spec: { label: '규격/중량', icon: Type, color: 'text-orange-700', bg: 'bg-orange-50 border-orange-100' },
  warning: { label: '주의 문구', icon: AlertCircle, color: 'text-amber-700', bg: 'bg-amber-50 border-amber-100' },
  text: { label: '문구', icon: Type, color: 'text-blue-700', bg: 'bg-blue-50 border-blue-100' },
  drawing: { label: '도면 변경', icon: ImageIcon, color: 'text-purple-700', bg: 'bg-purple-50 border-purple-100' },
  layout: { label: '레이아웃 참고', icon: MoveVertical, color: 'text-gray-600', bg: 'bg-gray-50 border-gray-200' },
};

const REVIEW_SEVERITY_LABEL: Record<string, string> = {
  critical: '필수',
  high: '중요',
  medium: '확인',
  low: '참고',
};

function overlayShortLabel(diff: Diff) {
  if (diff.type === 'number_changed') return '값 변경';
  if (diff.type === 'text_modified') return '문구 변경';
  if (diff.type === 'design_changed') return '도면 변화';
  if (diff.type === 'layout_changed') return '도형 변화';
  if (diff.type === 'shape_resized') return '크기 변경';
  if (diff.type === 'block_moved') return '위치 이동';
  return meta(diff.type).label || diff.type;
}

// ─── Smart Zoom Step Calculator ─────────────────────────────────────────────────
function getZoomStep(current: number, direction: 'in' | 'out'): number {
  if (current <= 100) return 10;
  if (current <= 500) return 50;
  if (current <= 2000) return 250;
  return 500;
}

function clampZoom(z: number): number {
  return Math.max(10, Math.min(5000, z));
}

// ─── Inline Diff Rendering Helper ──────────────────────────────────────────────────
function renderInlineDiff(diffs: Array<[number, string]> | undefined, originalText?: string) {
  if (!diffs) {
    return <span className="text-gray-700">{originalText || ''}</span>;
  }
  return (
    <span className="break-all leading-relaxed whitespace-pre-wrap font-sans">
      {diffs.map(([op, val], idx) => {
        if (op === -1) {
          return (
            <span key={idx} className="bg-rose-100 text-rose-700 line-through px-0.5 rounded mx-0.5 inline font-medium select-all">
              {val}
            </span>
          );
        } else if (op === 1) {
          return (
            <span key={idx} className="bg-emerald-100 text-emerald-700 border-b border-emerald-500 px-0.5 rounded mx-0.5 inline font-bold select-all">
              {val}
            </span>
          );
        } else {
          return <span key={idx} className="text-gray-700">{val}</span>;
        }
      })}
    </span>
  );
}

// ─── Overlay Box (DiffBox) with HUD Tooltip ──────────────────────────────────────────

function ReviewCropPreview({ page, item }: { page: PageResult; item: ReviewItem }) {
  const [preview, setPreview] = useState<{ before: string; after: string } | null>(null);
  const box = item.bbox;
  const shouldPreview = item.category === 'drawing' && !!box && !!page.base64A && !!page.base64B;

  useEffect(() => {
    if (!shouldPreview || !box) {
      setPreview(null);
      return;
    }

    let cancelled = false;
    const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src.startsWith('data:') ? src : `data:image/png;base64,${src}`;
    });

    const cropImage = async (src: string) => {
      const img = await loadImage(src);
      const pad = Math.max(24, Math.min(box.width, box.height) * 0.16);
      const sx = Math.max(0, Math.floor(box.x - pad));
      const sy = Math.max(0, Math.floor(box.y - pad));
      const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.ceil(box.width + pad * 2)));
      const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.ceil(box.height + pad * 2)));
      const scale = Math.min(1, 360 / sw, 190 / sh);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sw * scale));
      canvas.height = Math.max(1, Math.round(sh * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.82);
    };

    Promise.all([cropImage(page.base64A), cropImage(page.base64B)])
      .then(([before, after]) => {
        if (!cancelled) setPreview({ before, after });
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });

    return () => {
      cancelled = true;
    };
  }, [shouldPreview, page.base64A, page.base64B, box?.x, box?.y, box?.width, box?.height]);

  if (!shouldPreview || !preview) return null;

  return (
    <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-purple-100 bg-purple-50/40 p-1.5">
      <div className="min-w-0">
        <div className="mb-1 text-[8px] font-black uppercase tracking-wider text-rose-500">Before</div>
        <img src={preview.before} alt="Before crop" className="w-full h-20 rounded border border-rose-100 bg-white object-contain" />
      </div>
      <div className="min-w-0">
        <div className="mb-1 text-[8px] font-black uppercase tracking-wider text-emerald-600">After</div>
        <img src={preview.after} alt="After crop" className="w-full h-20 rounded border border-emerald-100 bg-white object-contain" />
      </div>
    </div>
  );
}

function DiffBox({ diff, scale, active, onHover, checked }: {
  diff: Diff; scale: number; active: boolean; onHover: (v: boolean) => void; checked: boolean; key?: any;
}) {
  const m = meta(diff.type);
  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={cn(
        "absolute cursor-help transition-all duration-150 rounded-sm",
        checked ? "opacity-25" : "opacity-100"
      )}
      style={{
        left: diff.bbox.x * scale,
        top: diff.bbox.y * scale,
        width: diff.bbox.width * scale,
        height: diff.bbox.height * scale,
        border: `${active ? '2px' : '1px'} ${checked ? 'dashed' : 'solid'} ${m.ring}`,
        backgroundColor: `${m.bg}${active ? '0.20' : checked ? '0.01' : '0.08'})`,
        boxShadow: active ? `0 0 0 2px ${m.ring}30, 0 0 12px ${m.ring}50` : 'none',
        zIndex: active ? 30 : 10
      }}
    >
      {!active && (
        <>
          <div 
            className="absolute -top-[5px] -right-[5px] w-2.5 h-2.5 rounded-full border border-white shadow-sm"
            style={{ backgroundColor: m.ring }} 
          />
          <div
            className="absolute -top-6 left-0 max-w-[220px] truncate rounded-md border border-white/80 px-1.5 py-0.5 text-[9px] font-black leading-none text-white shadow-md"
            style={{ backgroundColor: m.ring }}
            title={diff.desc || diff.type}
          >
            {overlayShortLabel(diff)}
          </div>
        </>
      )}

      {active && (
        <div className="absolute top-full left-0 mt-3 z-50 bg-gray-950/95 backdrop-blur-md border border-gray-800 text-white rounded-xl shadow-2xl p-3 w-80 max-w-[80vw] flex flex-col gap-2 pointer-events-none select-none animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between border-b border-gray-800/80 pb-2">
            <span className={cn('text-[9px] font-black px-2 py-0.5 rounded tracking-wide uppercase', m.color)} style={{ backgroundColor: `${m.ring}20`, color: m.ring }}>
              {m.label}
            </span>
            <span className="text-[9px] text-gray-500 font-mono tracking-wider uppercase">
              {diff.type.replace('_', ' ')}
            </span>
          </div>
          <p className="text-[11px] text-gray-200 font-semibold leading-normal">
            {diff.desc || diff.type}
          </p>
          {diff.textInfo && (
            <div className="mt-1 bg-gray-900/90 rounded-lg p-2 border border-gray-850 text-[10.5px]">
              <div className="text-[8px] text-gray-500 font-bold mb-1 tracking-wider uppercase">문자 정밀 비교</div>
              <div className="leading-relaxed">{renderInlineDiff(diff.textInfo.diffs)}</div>
            </div>
          )}
          <div className="flex justify-between items-center text-[8px] text-gray-500 font-mono pt-1">
            <span>X: {Math.round(diff.bbox.x)}pt Y: {Math.round(diff.bbox.y)}pt</span>
            <span>{checked ? "✓ 검수 완료" : "⚠ 미검수"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Single PDF Viewer Pane (supports crisp-edges 5000% zoom) ─────────────────
function PdfPane({ imgSrc, diffs, label, activeDiff, checkedItems, onScroll, innerRef, zoom = 100, showDiffs = true, aspectRatio }: {
  imgSrc: string; diffs: Diff[]; label: string; activeDiff: number | null;
  checkedItems: Record<string, boolean>; onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
  innerRef?: React.RefObject<HTMLDivElement | null>;
  zoom?: number;
  showDiffs?: boolean;
  aspectRatio?: number;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState(1);
  const [hover, setHover] = useState<number | null>(null);
  
  const recalc = useCallback(() => {
    if (!imgRef.current) return;
    const nat = imgRef.current.naturalWidth;
    const cli = imgRef.current.clientWidth;
    setScale(nat > 0 ? cli / nat : 1);
  }, []);
  
  useEffect(() => {
    recalc();
  }, [zoom, recalc]);
  
  useEffect(() => {
    window.addEventListener('resize', recalc);
    return () => window.removeEventListener('resize', recalc);
  }, [recalc]);

  // Determine if src is already a data URI or needs wrapping
  const resolvedSrc = imgSrc.startsWith('data:') ? imgSrc : `data:image/png;base64,${imgSrc}`;
  const isVectorPdf = !showDiffs && imgSrc.startsWith('blob:');
  
  return (
    <div className="flex flex-col flex-1 min-w-0 h-full border border-gray-200 bg-white rounded-2xl overflow-hidden shadow-sm">
      <div className="text-[10px] font-black text-gray-500 uppercase tracking-wider px-4 py-2 bg-gray-50 border-b border-gray-100 flex justify-between items-center select-none flex-shrink-0">
        <span>{label}</span>
        <span className="text-[9px] bg-gray-200/60 text-gray-700 px-2.5 py-0.5 rounded font-mono font-semibold">{isVectorPdf ? 'VECTOR PDF' : `${zoom}% ZOOM`}</span>
      </div>
      {isVectorPdf ? (
        <div
          ref={innerRef}
          onScroll={onScroll}
          className="relative overflow-auto bg-gray-100 flex-1 scrollbar-thin p-3"
        >
          <div
            className="relative mx-auto bg-white shadow-sm"
            style={{
              width: `${zoom}%`,
              aspectRatio: aspectRatio || 1 / 1.414,
              minWidth: zoom > 100 ? `${zoom}%` : undefined
            }}
          >
            <iframe
              src={pdfViewerSrc(imgSrc)}
              title={label}
              className="absolute inset-0 w-full h-full bg-white border-0 pointer-events-none"
              tabIndex={-1}
            />
          </div>
        </div>
      ) : (
      <div 
        ref={innerRef}
        onScroll={onScroll}
        className="relative overflow-auto bg-gray-100 flex-1 scrollbar-thin"
      >
        <div className="relative h-auto mx-auto" style={{ width: `${zoom}%` }}>
          <img
            ref={imgRef}
            src={resolvedSrc}
            alt={label}
            className="w-full h-auto block select-none"
            style={{ imageRendering: zoom > 150 ? 'pixelated' : 'auto' }}
            onLoad={recalc}
            draggable={false}
          />
          {showDiffs && diffs.map((d, i) => (
            <DiffBox
              key={i}
              diff={d}
              scale={scale}
              active={hover === (d.rawIndex ?? i) || activeDiff === (d.rawIndex ?? i)}
              onHover={(v) => setHover(v ? (d.rawIndex ?? i) : null)}
              checked={!!checkedItems[d.rawIndex ?? i]}
            />
          ))}
        </div>
      </div>
      )}
    </div>
  );
}

// ─── Zoom Controls Component ───────────────────────────────────────────────────
function pdfViewerSrc(src: string) {
  return src.startsWith('blob:') ? `${src}#toolbar=0&navpanes=0&scrollbar=0&view=FitH&page=1` : src;
}

function PdfVisualLayer({ src, title, className, style, aspectRatio }: {
  src: string;
  title: string;
  className?: string;
  style?: React.CSSProperties;
  aspectRatio?: number;
}) {
  if (!src) {
    return <div className={cn("absolute inset-0 bg-white", className)} style={style} />;
  }

  if (src.startsWith('blob:')) {
    return (
      <iframe
        src={pdfViewerSrc(src)}
        title={title}
        className={cn("absolute inset-0 w-full h-full border-0 bg-white pointer-events-none", className)}
        style={{ aspectRatio, ...style }}
        tabIndex={-1}
      />
    );
  }

  const resolvedSrc = src.startsWith('data:') ? src : `data:image/png;base64,${src}`;
  return (
    <img
      src={resolvedSrc}
      alt={title}
      className={cn("absolute inset-0 w-full h-full object-contain select-none", className)}
      style={style}
      draggable={false}
    />
  );
}

async function splitPdfToSinglePageUrls(file: File): Promise<SinglePagePdfUrl[]> {
  const bytes = await file.arrayBuffer();
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const urls: SinglePagePdfUrl[] = [];

  for (let pageIndex = 0; pageIndex < source.getPageCount(); pageIndex++) {
    const singlePageDoc = await PDFDocument.create();
    const [page] = await singlePageDoc.copyPages(source, [pageIndex]);
    const { width, height } = page.getSize();
    singlePageDoc.addPage(page);

    const singlePageBytes = await singlePageDoc.save({ useObjectStreams: true });
    const blob = new Blob([singlePageBytes], { type: 'application/pdf' });
    urls.push({ url: URL.createObjectURL(blob), width, height });
  }

  return urls;
}

function ZoomControls({ zoom, setZoom }: { zoom: number; setZoom: React.Dispatch<React.SetStateAction<number>> }) {
  const [editingZoom, setEditingZoom] = useState(false);
  const [zoomInput, setZoomInput] = useState(String(zoom));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editingZoom) setZoomInput(String(zoom));
  }, [zoom, editingZoom]);

  const commitZoom = () => {
    const val = parseInt(zoomInput, 10);
    if (!isNaN(val)) setZoom(clampZoom(val));
    setEditingZoom(false);
  };

  return (
    <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 border border-gray-200">
      <button
        onClick={() => setZoom(z => clampZoom(z - getZoomStep(z, 'out')))}
        className="p-1.5 hover:bg-gray-200 rounded-lg text-gray-500 hover:text-gray-800 transition-all cursor-pointer"
      >
        <ZoomOut className="w-3.5 h-3.5" />
      </button>
      {editingZoom ? (
        <input
          ref={inputRef}
          type="number"
          value={zoomInput}
          onChange={e => setZoomInput(e.target.value)}
          onBlur={commitZoom}
          onKeyDown={e => { if (e.key === 'Enter') commitZoom(); if (e.key === 'Escape') setEditingZoom(false); }}
          className="w-16 text-center text-[10px] font-mono font-bold bg-white border border-blue-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          min={10}
          max={5000}
          autoFocus
        />
      ) : (
        <button
          onClick={() => { setEditingZoom(true); setTimeout(() => inputRef.current?.select(), 50); }}
          className="text-[10px] text-gray-700 w-14 text-center font-mono font-bold hover:bg-gray-200 rounded py-0.5 cursor-pointer transition-colors"
          title="클릭하여 배율 직접 입력"
        >
          {zoom}%
        </button>
      )}
      <button
        onClick={() => setZoom(z => clampZoom(z + getZoomStep(z, 'in')))}
        className="p-1.5 hover:bg-gray-200 rounded-lg text-gray-500 hover:text-gray-800 transition-all cursor-pointer"
      >
        <ZoomIn className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Main CompareTab ──────────────────────────────────────────────────────────
export function CompareTab({
  results,
  setRes,
  onExpandChange,
}: {
  results: PageResult[] | null;
  setRes: React.Dispatch<React.SetStateAction<PageResult[] | null>>;
  onExpandChange?: (expanded: boolean) => void;
}) {
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [comparing, setCmp] = useState(false);
  const [compareStage, setCompareStage] = useState('');
  const [compareElapsed, setCompareElapsed] = useState(0);
  const [compareStartedAt, setCompareStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);
  const [activeDiff, setActiveDiff] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'side' | 'swipe' | 'overlay'>('side');
  const [scrollLock, setScrollLock] = useState(true);
  const [sliderPos, setSliderPos] = useState(50);
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [zoom, setZoom] = useState(100);

  // Filters
  const [showCritical, setShowCritical] = useState(true);
  const [showHigh, setShowHigh] = useState(true);
  const [showMedium, setShowMedium] = useState(true);
  const [showLow, setShowLow] = useState(true);

  // NEW: Compare mode & precision
  const [compareMode, setCompareMode] = useState<CompareMode>('ai');
  const [precision, setPrecision] = useState(80);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showAllDiffOverlays, setShowAllDiffOverlays] = useState(true);
  const [hideCheckedReviewItems, setHideCheckedReviewItems] = useState(true);
  const [blendMode, setBlendMode] = useState<'difference' | 'normal'>('difference');

  // Visual-only pages (for 육안 검수 mode)
  const [visualPages, setVisualPages] = useState<VisualPage[] | null>(null);
  const [visualPdfUrls, setVisualPdfUrls] = useState<VisualPdfUrls | null>(null);

  const refA = useRef<HTMLInputElement>(null);
  const refB = useRef<HTMLInputElement>(null);

  const scrollRefA = useRef<HTMLDivElement>(null);
  const scrollRefB = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);
  const viewerContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!comparing || !compareStartedAt) {
      setCompareElapsed(0);
      return;
    }

    const tick = () => setCompareElapsed(Math.floor((Date.now() - compareStartedAt) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [comparing, compareStartedAt]);

  useEffect(() => {
    return () => {
      if (visualPdfUrls) {
        visualPdfUrls.urls.forEach(url => URL.revokeObjectURL(url));
      }
    };
  }, [visualPdfUrls]);

  // Ctrl+Wheel zoom handler
  useEffect(() => {
    const container = viewerContainerRef.current;
    if (!container) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1 : -1;
      setZoom(z => {
        const step = getZoomStep(z, delta > 0 ? 'in' : 'out');
        return clampZoom(z + delta * step);
      });
    };
    container.addEventListener('wheel', handler, { passive: false });
    return () => container.removeEventListener('wheel', handler);
  }, [results, visualPages]);

  // Sync scroll
  const handleScrollA = () => {
    if (!scrollLock || !scrollRefA.current || !scrollRefB.current) return;
    if (isSyncing.current) {
      isSyncing.current = false;
      return;
    }
    isSyncing.current = true;
    const ratio = scrollRefA.current.scrollTop / (scrollRefA.current.scrollHeight - scrollRefA.current.clientHeight || 1);
    const scrollBTop = ratio * (scrollRefB.current.scrollHeight - scrollRefB.current.clientHeight);
    scrollRefB.current.scrollTop = scrollBTop;
  };

  const handleScrollB = () => {
    if (!scrollLock || !scrollRefA.current || !scrollRefB.current) return;
    if (isSyncing.current) {
      isSyncing.current = false;
      return;
    }
    isSyncing.current = true;
    const ratio = scrollRefB.current.scrollTop / (scrollRefB.current.scrollHeight - scrollRefB.current.clientHeight || 1);
    const scrollATop = ratio * (scrollRefA.current.scrollHeight - scrollRefA.current.clientHeight);
    scrollRefA.current.scrollTop = scrollATop;
  };

  // Determine if we are in visual mode with data loaded
  const isVisualMode = compareMode === 'visual';
  const hasVisualData = isVisualMode && visualPages && visualPages.length > 0;
  const hasAiData = !isVisualMode && results && results.length > 0;
  const hasData = hasVisualData || hasAiData;

  useEffect(() => {
    onExpandChange?.(hasData);
  }, [hasData, onExpandChange]);

  // Get total pages
  const totalPages = hasVisualData ? visualPages!.length : (results ? results.length : 0);

  // Get currently active page result (AI mode)
  const currentResult = useMemo(() => {
    if (!results || results.length === 0) return null;
    return results[currentPageIdx] || results[0];
  }, [results, currentPageIdx]);

  // Get current visual page
  const currentVisualPage = useMemo(() => {
    if (!visualPages || visualPages.length === 0) return null;
    return visualPages[currentPageIdx] || visualPages[0];
  }, [visualPages, currentPageIdx]);

  // Filter diffs based on severity checkboxes (AI mode only)
  const filteredDiffs = useMemo(() => {
    if (!currentResult) return [];
    return currentResult.diffs.filter(d => 
      (d.severity === 'critical' && showCritical) ||
      (d.severity === 'high'     && showHigh)     ||
      (d.severity === 'medium'   && showMedium)   ||
      (d.severity === 'low'      && showLow)
    );
  }, [currentResult, showCritical, showHigh, showMedium, showLow]);

  const reviewItems = useMemo(() => {
    if (!currentResult) return [];
    return currentResult.reviewItems && currentResult.reviewItems.length > 0
      ? currentResult.reviewItems
      : currentResult.diffs.map((d, i) => ({
          id: `raw-${currentResult.page}-${i}`,
          category: d.type.includes('text') || d.type.includes('number') ? 'text' : d.type.includes('shape') || d.type.includes('design') ? 'drawing' : 'layout',
          severity: d.severity as ReviewItem['severity'],
          title: d.type,
          desc: d.desc || d.type,
          before: d.before,
          bbox: d.bbox,
          relatedDiffs: [i],
          confidence: 0.5
        } as ReviewItem));
  }, [currentResult]);

  const severityFilteredReviewItems = useMemo(() => {
    return reviewItems.filter(item =>
      (item.severity === 'critical' && showCritical) ||
      (item.severity === 'high'     && showHigh)     ||
      (item.severity === 'medium'   && showMedium)   ||
      (item.severity === 'low'      && showLow)
    );
  }, [reviewItems, showCritical, showHigh, showMedium, showLow]);

  const filteredReviewItems = useMemo(() => {
    if (!hideCheckedReviewItems) return severityFilteredReviewItems;
    return severityFilteredReviewItems.filter((item, i) => !checkedItems[getReviewCheckedKey(item, i)]);
  }, [severityFilteredReviewItems, hideCheckedReviewItems, checkedItems, currentResult]);

  const overlayDiffs = useMemo(() => {
    if (!currentResult) return [];
    const include = new Set<number>();

    if (!showAllDiffOverlays) {
      if (activeDiff != null && currentResult.diffs[activeDiff]) include.add(activeDiff);
    } else if (severityFilteredReviewItems.length > 0) {
      const sourceItems = hideCheckedReviewItems ? filteredReviewItems : severityFilteredReviewItems;
      sourceItems.forEach(item => item.relatedDiffs?.forEach(idx => include.add(idx)));
    } else {
      currentResult.diffs.forEach((d, idx) => {
        if ((d.severity === 'critical' && showCritical) ||
            (d.severity === 'high' && showHigh) ||
            (d.severity === 'medium' && showMedium) ||
            (d.severity === 'low' && showLow)) include.add(idx);
      });
    }

    return [...include]
      .filter(idx => currentResult.diffs[idx])
      .map(idx => ({ ...currentResult.diffs[idx], rawIndex: idx }));
  }, [currentResult, activeDiff, showAllDiffOverlays, severityFilteredReviewItems, filteredReviewItems, hideCheckedReviewItems, showCritical, showHigh, showMedium, showLow]);

  const goToDiff = (idx: number) => {
    setActiveDiff(idx);
    const diff = filteredDiffs[idx];
    if (!diff) return;

    if (viewMode === 'side') {
      const paneA = scrollRefA.current;
      if (!paneA) return;
      const imgEl = paneA.querySelector('img');
      if (!imgEl) return;

      const nat = imgEl.naturalWidth || 800;
      const scaleFactor = imgEl.clientWidth / nat;
      const top = diff.bbox.y * scaleFactor;
      
      paneA.scrollTo({ top: Math.max(0, top - 150), behavior: 'smooth' });
    }
  };

  const goToReviewItem = (item: ReviewItem, reviewIdx: number) => {
    const rawIdx = item.relatedDiffs?.[0] ?? -1;
    setActiveDiff(rawIdx >= 0 ? rawIdx : null);

    if (viewMode === 'side') {
      const paneA = scrollRefA.current;
      if (!paneA || !item.bbox) return;
      const imgEl = paneA.querySelector('img');
      if (!imgEl) return;

      const nat = imgEl.naturalWidth || 800;
      const scaleFactor = imgEl.clientWidth / nat;
      const top = item.bbox.y * scaleFactor;
      paneA.scrollTo({ top: Math.max(0, top - 150), behavior: 'smooth' });
    }
  };

  function getCheckedKey(diffIdx: number) {
    if (!currentResult) return '';
    return `${currentResult.page}_${diffIdx}`;
  }

  function getReviewCheckedKey(item: ReviewItem, idx: number) {
    if (!currentResult) return '';
    return `${currentResult.page}_review_${item.id || idx}`;
  }

  const toggleChecked = (idx: number) => {
    const key = getCheckedKey(idx);
    if (!key) return;
    setCheckedItems(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const resetChecked = () => {
    setCheckedItems({});
  };

  const completionRate = useMemo(() => {
    const total = severityFilteredReviewItems.length || filteredDiffs.length;
    if (total === 0) return 100;
    let checkedCount = 0;
    if (severityFilteredReviewItems.length) {
      severityFilteredReviewItems.forEach((item, i) => {
        if (checkedItems[getReviewCheckedKey(item, i)]) checkedCount++;
      });
    } else {
      filteredDiffs.forEach((_, i) => {
        if (checkedItems[getCheckedKey(i)]) checkedCount++;
      });
    }
    return Math.round((checkedCount / total) * 100);
  }, [checkedItems, filteredDiffs, severityFilteredReviewItems, currentResult]);

  const API_URL = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return ['localhost', '127.0.0.1'].includes(window.location.hostname)
      ? 'http://localhost:8080'
      : (window.location.hostname.includes('vercel.app')
          ? 'https://smart-pdf-ai-merger.onrender.com'
          : window.location.origin);
  }, []);

  const runCompare = async () => {
    if (!fileA || !fileB) { setError('원본과 수정본 PDF를 모두 선택해주세요.'); return; }
    const api = (window as any).electronAPI;
    setCmp(true);
    setCompareStartedAt(Date.now());
    setCompareStage(isVisualMode ? 'PDF 렌더링 준비 중' : 'PDF 업로드 준비 중');
    setError(null); setRes(null); setVisualPages(null); setVisualPdfUrls(null); setCurrentPageIdx(0); setCheckedItems({});

    try {
      if (isVisualMode) {
        // Split into single-page vector PDFs so the review board can page them like AI mode.
        setShowSidebar(false); // auto-hide sidebar in visual mode
        setCompareStage('PDF 페이지 분리 중');
        const [urlsA, urlsB] = await Promise.all([
          splitPdfToSinglePageUrls(fileA),
          splitPdfToSinglePageUrls(fileB),
        ]);
        const maxLen = Math.max(urlsA.length, urlsB.length);
        const pages: VisualPage[] = [];
        for (let i = 0; i < maxLen; i++) {
          pages.push({
            page: i + 1,
            imgA: urlsA[i]?.url || '',
            imgB: urlsB[i]?.url || '',
            aspectA: urlsA[i] ? urlsA[i].width / urlsA[i].height : undefined,
            aspectB: urlsB[i] ? urlsB[i].width / urlsB[i].height : undefined,
          });
        }
        setVisualPdfUrls({ urls: [...urlsA, ...urlsB].map(page => page.url) });
        setVisualPages(pages);
      } else {
        // ─── AI Mode: call /compare-pdfs with numeric precision ───
        setShowSidebar(true);

        if (api) {
          setCompareStage('PDF 분석 엔진 실행 중');
          const pathA = api.getPathForFile ? api.getPathForFile(fileA) : (fileA as any).path;
          const pathB = api.getPathForFile ? api.getPathForFile(fileB) : (fileB as any).path;
          const resp = await api.comparePdfs({ fileA: pathA, fileB: pathB, sensitivity: String(precision) });
          if (resp.success) {
            setRes(resp.results);
          } else {
            setError(resp.error || '비교 중 오류가 발생했습니다.');
          }
        } else {
          setCompareStage('PDF 업로드 중');
          const formData = new FormData();
          formData.append('fileA', fileA);
          formData.append('fileB', fileB);
          formData.append('sensitivity', String(precision));

          const response = await fetch(`${API_URL}/compare-pdfs`, {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({ error: '서버 비교 처리 중 에러가 발생했습니다.' }));
            throw new Error(errData.error || '서버 응답 오류');
          }

          const resp = await response.json();
          if (resp.success && resp.taskId) {
            const taskId = resp.taskId;
            let completed = false;
            const pollStartedAt = Date.now();
            const maxWaitMs = 10 * 60 * 1000;

            while (!completed) {
              if (Date.now() - pollStartedAt > maxWaitMs) {
                throw new Error('비교 시간이 너무 오래 걸려 중단했습니다. 정밀도를 낮춰 다시 시도해 주세요.');
              }
              setCompareStage('PDF 구조/텍스트/이미지 차이 분석 중');
              await new Promise((resolve) => setTimeout(resolve, 1500));
              const statusRes = await fetch(`${API_URL}/compare-status/${taskId}`);
              if (!statusRes.ok) {
                const statusErr = await statusRes.json().catch(() => ({ error: '작업 상태 확인에 실패했습니다.' }));
                throw new Error(statusErr.error || '작업 상태 확인 오류');
              }
              const statusData = await statusRes.json();
              if (statusData.success) {
                if (statusData.status === 'completed') {
                  setRes(statusData.result.results);
                  completed = true;
                } else if (statusData.status === 'failed') {
                  throw new Error(statusData.error || '비교 중 오류가 발생했습니다.');
                }
              } else {
                throw new Error(statusData.error || '서버 작업 조회 실패');
              }
            }
          } else if (resp.success && resp.results) {
            setRes(resp.results);
          } else {
            setError(resp.error || '비교 중 오류가 발생했습니다.');
          }
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCmp(false);
      setCompareStartedAt(null);
      setCompareStage('');
    }
  };

  const resetAll = () => {
    setFileA(null);
    setFileB(null);
    setRes(null);
    setVisualPages(null);
    setVisualPdfUrls(null);
    setError(null);
    setCmp(false);
    setCompareStartedAt(null);
    setCompareStage('');
    setCheckedItems({});
    setCurrentPageIdx(0);
    setActiveDiff(null);
    setShowSidebar(true);
  };

  const DropZone = ({ file, setFile, inputRef, label, accent }: any) => (
    <div
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'border-2 rounded-2xl flex flex-col items-center justify-center gap-3 py-10 cursor-pointer transition-all select-none hover:shadow-md active:scale-[0.99]',
        file
          ? 'border-gray-500 bg-gray-50/50'
          : 'border-dashed border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
      )}
    >
      {file ? (
        <div className="flex flex-col items-center gap-3">
          <div className={cn(
            'text-[10px] font-black px-2 py-0.5 rounded flex-shrink-0 bg-white shadow-sm border border-gray-150',
            accent
          )}>
            PDF
          </div>
          <p className="text-sm font-semibold text-gray-800 truncate max-w-[220px] text-center">{file.name}</p>
          <span className="text-xs text-gray-400 font-medium tracking-wide font-mono">{(file.size / (1024 * 1024)).toFixed(2)} MB • {label}</span>
        </div>
      ) : (
        <>
          <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 shadow-sm text-gray-400">
            <Upload className="w-5 h-5" />
          </div>
          <p className="text-sm font-semibold text-gray-700">{label} PDF 업로드</p>
          <p className="text-xs text-gray-400">드래그 앤 드롭 또는 마우스 클릭</p>
        </>
      )}
      <input type="file" accept=".pdf" className="hidden" ref={inputRef}
        onChange={e => e.target.files && setFile(e.target.files[0])} />
    </div>
  );

  // ─── Determine which view state to show ─────────────────────────────────────
  const showUploadView = !hasData && !comparing;
  const showNoResults = hasAiData && results!.length === 0;
  const showInspection = hasData;
  const compareElapsedLabel = `${Math.floor(compareElapsed / 60)}:${String(compareElapsed % 60).padStart(2, '0')}`;
  const availableViewModes = ['side', 'swipe', 'overlay'] as Array<'side' | 'swipe' | 'overlay'>;

  return (
    <AnimatePresence mode="wait">
      {showUploadView && !results ? (
        // ═══════════════════════════════════════════════════════════════════════
        // UPLOAD VIEW — Mode Selection + File Upload
        // ═══════════════════════════════════════════════════════════════════════
        <motion.div 
          key="upload-view"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="flex flex-col gap-5"
          style={{ fontFamily: "'Inter', 'Noto Sans KR', system-ui, sans-serif" }}
        >
          {/* Header */}
          <div>
            <h2 className="text-xl font-black tracking-tight text-gray-900">PDF 정밀 대조 검수</h2>
            <p className="text-sm text-gray-500 mt-1">
              인쇄물 원본(Before)과 수정본(After)을 대조하여 텍스트·수치·도형 변경을 검출합니다.
            </p>
          </div>

          {/* Two dropzones side-by-side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DropZone file={fileA} setFile={setFileA} inputRef={refA} label="원본 (Before)" accent="text-blue-600" />
            <DropZone file={fileB} setFile={setFileB} inputRef={refB} label="수정본 (After)" accent="text-orange-600" />
          </div>

          {/* ═══ Mode Selection Cards ═══ */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* AI Precision Compare Card */}
            <div
              onClick={() => setCompareMode('ai')}
              className={cn(
                "relative rounded-2xl border-2 p-5 cursor-pointer transition-all select-none",
                compareMode === 'ai'
                  ? "border-blue-500 bg-blue-50/40 shadow-lg shadow-blue-100/50 scale-[1.01]"
                  : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-md"
              )}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={cn(
                  "p-2.5 rounded-xl",
                  compareMode === 'ai' ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-500"
                )}>
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-gray-900">🤖 인공지능 정밀 대조</h3>
                  <p className="text-[10px] text-gray-500 font-medium">OCR & 구조 분석으로 변경점 자동 검출</p>
                </div>
              </div>

              {compareMode === 'ai' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex flex-col gap-3 mt-3 border-t border-blue-100 pt-3"
                >
                  {/* Precision Slider */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">검수 정밀도</label>
                      <span className="text-sm font-black text-blue-600 font-mono">{precision}%</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="100"
                      value={precision}
                      onChange={e => setPrecision(parseInt(e.target.value, 10))}
                      className="w-full accent-blue-600 cursor-pointer h-2 bg-gray-200 rounded-lg appearance-none"
                    />
                    <div className="flex justify-between text-[8px] text-gray-400 font-mono px-0.5">
                      <span>1% 관대</span>
                      <span>100% 초정밀</span>
                    </div>
                  </div>

                  {/* Quick-pick Buttons */}
                  <div className="flex gap-2">
                    {([
                      [40, '구조 검수', '도형·레이아웃 중심'],
                      [80, '실무 검수', '추천 — 실무 인쇄 검수'],
                      [95, '초정밀 검수', '미세 자간까지 감지'],
                    ] as const).map(([val, label, desc]) => (
                      <button
                        key={val}
                        onClick={(e) => { e.stopPropagation(); setPrecision(val); }}
                        className={cn(
                          "flex-1 flex flex-col items-center py-2 px-2 rounded-xl text-[10px] border transition-all cursor-pointer",
                          precision === val
                            ? "bg-blue-600 text-white border-blue-600 shadow-md font-bold"
                            : "bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50"
                        )}
                      >
                        <span className="font-bold">{val}%</span>
                        <span className={cn("text-[8px] mt-0.5", precision === val ? "text-blue-100" : "text-gray-400")}>{label}</span>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>

            {/* Visual Inspection Card */}
            <div
              onClick={() => setCompareMode('visual')}
              className={cn(
                "relative rounded-2xl border-2 p-5 cursor-pointer transition-all select-none",
                compareMode === 'visual'
                  ? "border-amber-500 bg-amber-50/40 shadow-lg shadow-amber-100/50 scale-[1.01]"
                  : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-md"
              )}
            >
              <div className="flex items-center gap-3 mb-1">
                <div className={cn(
                  "p-2.5 rounded-xl",
                  compareMode === 'visual' ? "bg-amber-100 text-amber-600" : "bg-gray-100 text-gray-500"
                )}>
                  <Eye className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-gray-900">👁️ 즉시 육안 검수</h3>
                  <p className="text-[10px] text-gray-500 font-medium">AI 분석 없이 초고속 뷰어로 즉시 대조</p>
                </div>
              </div>
              <div className="mt-3 text-[10px] text-gray-500 leading-relaxed bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p>• 서버 AI 연산을 완전히 생략하고 <span className="font-bold text-gray-700">0.5초 이내</span> 초고속 렌더링</p>
                <p>• 듀얼 연동, 투명도 오버레이, 스와이프 슬라이더 뷰 모두 활용 가능</p>
                <p>• <span className="font-bold text-gray-700">최대 5000% 선명 줌</span>으로 미세한 차이를 육안으로 확인</p>
                <p>• 변경사항 하이라이트 없이 뷰어 도구만 활용하는 몰입형 모드</p>
              </div>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="flex items-center gap-2.5 text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-100 px-4 py-3 rounded-xl">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 leading-normal">{error}</span>
              <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-700 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Trigger compare button */}
          <button
            onClick={runCompare}
            disabled={comparing || !fileA || !fileB}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-xs font-bold transition-all shadow-md select-none',
              comparing || !fileA || !fileB
                ? 'bg-gray-100 text-gray-300 cursor-not-allowed border border-gray-100 shadow-none'
                : compareMode === 'visual'
                  ? 'bg-amber-600 text-white hover:bg-amber-500 active:scale-[0.99] cursor-pointer'
                  : 'bg-gray-900 text-white hover:bg-gray-800 active:scale-[0.99] cursor-pointer'
            )}
          >
            {comparing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                <span>{isVisualMode ? '초고속 렌더링 중...' : `정밀도 ${precision}% 대조 분석 연산 중 (하이브리드 OCR 작동)...`}</span>
              </>
            ) : (
              <>
                {isVisualMode ? <Eye className="w-4 h-4" /> : <Sparkles className="w-4 h-4 text-amber-400" />}
                <span>
                  {isVisualMode ? '즉시 육안 검수 시작' : `정밀도 ${precision}% 하이브리드 대조 검수 시작`}
                </span>
              </>
            )}
          </button>
        </motion.div>
      ) : comparing ? (
        <motion.div
          key="compare-loading-view"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="w-full max-w-2xl mx-auto mt-14 rounded-2xl border border-gray-200 bg-white p-7 shadow-lg"
          style={{ fontFamily: "'Inter', 'Noto Sans KR', system-ui, sans-serif" }}
        >
          <div className="flex items-start gap-4">
            <div className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-gray-900 text-white shadow-md">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-black text-gray-900">비교 분석 중</h2>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[10px] font-bold text-gray-500">
                  {compareElapsedLabel}
                </span>
              </div>
              <p className="mt-2 text-sm font-semibold text-gray-700">
                {compareStage || (isVisualMode ? 'PDF 렌더링 중' : 'PDF 구조/텍스트/이미지 차이 분석 중')}
              </p>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-gray-100">
                <motion.div
                  className="h-full rounded-full bg-gray-900"
                  initial={{ x: '-100%' }}
                  animate={{ x: ['-100%', '120%'] }}
                  transition={{ repeat: Infinity, duration: 1.25, ease: 'easeInOut' }}
                  style={{ width: '45%' }}
                />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-[10px] font-bold text-gray-500">
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">업로드</div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">렌더링</div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">차이 분석</div>
              </div>
            </div>
          </div>
        </motion.div>
      ) : results && results.length === 0 ? (
        // ═══════════════════════════════════════════════════════════════════════
        // NO DIFFERENCES FOUND
        // ═══════════════════════════════════════════════════════════════════════
        <motion.div 
          key="no-diff-view"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="flex flex-col items-center justify-center gap-6 py-20 bg-white border border-gray-200 rounded-3xl shadow-sm text-center max-w-xl mx-auto mt-12"
          style={{ fontFamily: "'Inter', 'Noto Sans KR', system-ui, sans-serif" }}
        >
          <div className="p-4 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100 shadow-md">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <div>
            <h2 className="text-lg font-black text-gray-900">비교 결과: 100% 일치하는 문서</h2>
            <p className="text-sm text-gray-500 mt-2 max-w-sm leading-relaxed">
              두 PDF 문서 간의 의미적 텍스트, 금액 수치, 기하학적 레이아웃이 완전히 동일합니다. 변경된 내용이 존재하지 않습니다.
            </p>
          </div>
          <button
            onClick={resetAll}
            className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white hover:bg-gray-800 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            다른 PDF 대조하기
          </button>
        </motion.div>
      ) : hasData ? (
        // ═══════════════════════════════════════════════════════════════════════
        // INSPECTION BOARD — Main Multi-View Workspace
        // ═══════════════════════════════════════════════════════════════════════
        <motion.div 
          key="inspection-board"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="flex flex-col flex-1 min-h-0 w-full bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-lg"
          style={{ fontFamily: "'Inter', 'Noto Sans KR', system-ui, sans-serif" }}
          ref={viewerContainerRef}
        >
          {/* ── 1. Header Control HUD ── */}
          <div className={cn("flex items-center justify-between px-3 h-11 border-b border-gray-200 bg-white flex-shrink-0 z-10 shadow-sm select-none", isVisualMode && "hidden")}>
            <div className={cn("flex items-center gap-2", isVisualMode && "hidden")}>
              <button 
                onClick={resetAll}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-800 rounded-xl text-[10.5px] font-black border border-gray-150 transition-all active:scale-95 cursor-pointer"
              >
                <ArrowRight className="w-3 h-3 rotate-180" />
                새 파일
              </button>
              <div className="w-px h-5 bg-gray-250" />
              <div>
                <h2 className="text-xs font-black text-gray-900 tracking-tight flex items-center gap-2">
                  {isVisualMode ? '👁️ 즉시 육안 검수' : '🤖 인공지능 정밀 대조'}
                  {!isVisualMode && (
                    <span className="text-[9px] bg-blue-50 text-blue-600 border border-blue-100 font-black px-2 py-0.5 rounded-full uppercase tracking-wider">
                      {precision}% PRECISION
                    </span>
                  )}
                </h2>
              </div>
            </div>

            {/* Controls Row */}
            <div className="flex items-center gap-2">
              {/* View Mode Selector */}
              <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-xl border border-gray-200">
                {availableViewModes.map(m => (
                  <button
                    key={m}
                    onClick={() => setViewMode(m)}
                    className={cn(
                      "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all cursor-pointer",
                      viewMode === m
                        ? "bg-gray-900 text-white shadow-md"
                        : "text-gray-500 hover:text-gray-800 hover:bg-gray-200"
                    )}
                  >
                    {m === 'side' && <Columns className="w-3 h-3" />}
                    {m === 'swipe' && <Split className="w-3 h-3" />}
                    {m === 'overlay' && <Layers className="w-3 h-3" />}
                    {m === 'side' ? '듀얼' : m === 'swipe' ? '슬라이더' : '오버레이'}
                  </button>
                ))}
              </div>

              <div className="w-px h-5 bg-gray-250" />

              {/* Page navigation */}
              <div className="flex items-center gap-0.5 bg-gray-100 rounded-xl p-0.5 border border-gray-200">
                <button 
                  onClick={() => { setCurrentPageIdx(p => Math.max(0, p - 1)); setActiveDiff(null); }} 
                  disabled={currentPageIdx === 0}
                  className="p-1 hover:bg-gray-200 rounded-lg text-gray-500 disabled:opacity-20 hover:text-gray-800 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] text-gray-700 w-14 text-center font-bold">
                  {currentPageIdx + 1} / {totalPages}
                </span>
                <button 
                  onClick={() => { setCurrentPageIdx(p => Math.min(totalPages - 1, p + 1)); setActiveDiff(null); }} 
                  disabled={currentPageIdx === totalPages - 1}
                  className="p-1 hover:bg-gray-200 rounded-lg text-gray-500 disabled:opacity-20 hover:text-gray-800 cursor-pointer"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Zoom controls */}
              <ZoomControls zoom={zoom} setZoom={setZoom} />

              {/* Sidebar toggle (AI mode only) */}
              {!isVisualMode && (
                <>
                  <div className="w-px h-5 bg-gray-250" />
                  <button
                    onClick={() => setShowSidebar(!showSidebar)}
                    className={cn(
                      "p-1.5 rounded-lg border transition-all cursor-pointer",
                      showSidebar
                        ? "bg-gray-100 border-gray-200 text-gray-600 hover:bg-gray-200"
                        : "bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100"
                    )}
                    title={showSidebar ? "사이드바 숨기기" : "사이드바 보이기"}
                  >
                    {showSidebar ? <PanelLeftClose className="w-3.5 h-3.5" /> : <PanelLeft className="w-3.5 h-3.5" />}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* ── 2. Workspace Body ── */}
          <div className="flex flex-1 min-h-0">
            {isVisualMode && (
              <div className="w-16 flex-shrink-0 border-r border-gray-200 bg-white p-2 flex flex-col items-center gap-2 shadow-sm select-none">
                <button onClick={resetAll} className="w-11 h-9 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-600 flex items-center justify-center cursor-pointer" title="새 파일">
                  <ArrowRight className="w-4 h-4 rotate-180" />
                </button>
                <div className="w-full h-px bg-gray-200" />
                {availableViewModes.map(m => (
                  <button
                    key={m}
                    onClick={() => setViewMode(m)}
                    className={cn(
                      "w-11 h-9 rounded-xl border flex items-center justify-center transition-all cursor-pointer",
                      viewMode === m ? "bg-gray-900 text-white border-gray-900 shadow-md" : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100 hover:text-gray-800"
                    )}
                    title={m === 'side' ? '듀얼' : m === 'swipe' ? '슬라이더' : '오버레이'}
                  >
                    {m === 'side' && <Columns className="w-4 h-4" />}
                    {m === 'swipe' && <Split className="w-4 h-4" />}
                    {m === 'overlay' && <Layers className="w-4 h-4" />}
                  </button>
                ))}
                <div className="w-full h-px bg-gray-200" />
                <button onClick={() => { setCurrentPageIdx(p => Math.max(0, p - 1)); setActiveDiff(null); }} disabled={currentPageIdx === 0} className="w-11 h-9 rounded-xl border border-gray-200 bg-gray-50 text-gray-500 disabled:opacity-25 hover:bg-gray-100 cursor-pointer flex items-center justify-center" title="이전 페이지">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="text-[10px] font-black text-gray-700 leading-tight text-center">
                  <div>{currentPageIdx + 1}</div>
                  <div className="text-gray-400">/ {totalPages}</div>
                </div>
                <button onClick={() => { setCurrentPageIdx(p => Math.min(totalPages - 1, p + 1)); setActiveDiff(null); }} disabled={currentPageIdx === totalPages - 1} className="w-11 h-9 rounded-xl border border-gray-200 bg-gray-50 text-gray-500 disabled:opacity-25 hover:bg-gray-100 cursor-pointer flex items-center justify-center" title="다음 페이지">
                  <ChevronRight className="w-4 h-4" />
                </button>
                <div className="w-full h-px bg-gray-200" />
                <button onClick={() => setZoom(z => clampZoom(z + getZoomStep(z, 'in')))} className="w-11 h-9 rounded-xl border border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100 cursor-pointer flex items-center justify-center" title="확대">
                  <ZoomIn className="w-4 h-4" />
                </button>
                <div className="text-[10px] font-black text-gray-700">{zoom}%</div>
                <button onClick={() => setZoom(z => clampZoom(z - getZoomStep(z, 'out')))} className="w-11 h-9 rounded-xl border border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100 cursor-pointer flex items-center justify-center" title="축소">
                  <ZoomOut className="w-4 h-4" />
                </button>
              </div>
            )}
            
            {/* ── Left Interactive Change Sidebar (AI mode only, collapsible) ── */}
            {!isVisualMode && (
              <div
                className={cn(
                  "flex-shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden shadow-sm z-10 transition-all duration-300 ease-in-out",
                  showSidebar ? "w-72" : "w-0 border-r-0"
                )}
                style={{ minWidth: showSidebar ? '18rem' : '0' }}
              >
                {showSidebar && (
                  <>
                    <div className="px-3 py-3 border-b border-gray-150 bg-gray-50/70 select-none flex-shrink-0">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 text-[9px] font-black text-gray-400 uppercase tracking-widest">
                            <Filter className="w-3 h-3 text-gray-400" />
                            사람 검수 요약
                          </div>
                          <p className="mt-1 text-[10px] font-bold text-gray-800 leading-snug">
                            {currentResult?.pageSummary || '변경 없음'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 text-[9px] font-bold bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full text-blue-600 font-mono">
                          검수율 {completionRate}%
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-1.5">
                        {([
                          ['critical', showCritical, setShowCritical, '필수'],
                          ['high', showHigh, setShowHigh, '중요'],
                          ['medium', showMedium, setShowMedium, '확인'],
                          ['low', showLow, setShowLow, '참고'],
                        ] as const).map(([key, val, setter, label]) => (
                          <label key={key} className="flex items-center justify-between cursor-pointer select-none rounded-lg bg-white border border-gray-200 px-2 py-1">
                            <span className="text-[10px] font-bold text-gray-700">{label}</span>
                            <input
                              type="checkbox"
                              checked={val}
                              onChange={e => { setter(e.target.checked); setActiveDiff(null); }}
                              className="w-3.5 h-3.5 rounded cursor-pointer accent-gray-900 border-gray-300 focus:ring-0"
                            />
                          </label>
                        ))}
                      </div>
                    </div>

                                        <div className="px-3 py-2 border-b border-gray-200 bg-white select-none flex-shrink-0 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[9px] font-black tracking-widest text-gray-500 uppercase">
                          ?? ?? {filteredReviewItems.length}?
                        </span>
                        <button onClick={resetChecked} className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-all cursor-pointer" title="?? ???">
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={() => setShowAllDiffOverlays(v => !v)}
                          className={cn(
                            "rounded-lg border px-2 py-1 text-[9px] font-black transition-all cursor-pointer",
                            showAllDiffOverlays ? "bg-gray-900 text-white border-gray-900" : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                          )}
                        >
                          {showAllDiffOverlays ? '전체 표시 중' : '선택만 표시'}
                        </button>
                        <button
                          onClick={() => setHideCheckedReviewItems(v => !v)}
                          className={cn(
                            "rounded-lg border px-2 py-1 text-[9px] font-black transition-all cursor-pointer",
                            hideCheckedReviewItems ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                          )}
                        >
                          {hideCheckedReviewItems ? '완료 숨김' : '완료 표시'}
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-2.5 space-y-2 bg-gray-50/50">
                      {filteredReviewItems.length === 0 ? (
                        <div className="py-10 px-3 flex flex-col items-center justify-center text-center gap-3 bg-white border border-gray-200 border-dashed rounded-xl">
                          <CheckCircle2 className="w-7 h-7 text-emerald-500" />
                          <div>
                            <p className="text-[10px] font-black text-gray-800">현재 페이지의 핵심 변경이 없습니다</p>
                            <p className="text-[9px] text-gray-400 mt-1 leading-normal">
                              필터에 걸린 검수 항목이 없거나 변경이 없는 페이지입니다.
                            </p>
                          </div>
                        </div>
                      ) : (
                        filteredReviewItems.map((item, i) => {
                          const m = REVIEW_META[item.category] || REVIEW_META.layout;
                          const Icon = m.icon;
                          const rawIdx = item.relatedDiffs?.[0] ?? -1;
                          const isChecked = !!checkedItems[getReviewCheckedKey(item, i)];
                          return (
                            <div
                              key={item.id || i}
                              className={cn(
                                "group relative w-full text-left rounded-xl p-3 border transition-all flex flex-col gap-2 cursor-pointer duration-150 shadow-sm",
                                rawIdx >= 0 && activeDiff === rawIdx
                                  ? "bg-blue-50/80 border-blue-300 ring-2 ring-blue-100"
                                  : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-md",
                                isChecked && "opacity-45 bg-gray-50 border-gray-150"
                              )}
                              onClick={() => goToReviewItem(item, i)}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className={cn("w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0", m.bg)}>
                                    <Icon className={cn("w-3.5 h-3.5", m.color)} />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className={cn("text-[8px] font-black px-1.5 py-0.5 rounded-full border", m.bg, m.color)}>
                                        {REVIEW_SEVERITY_LABEL[item.severity] || item.severity}
                                      </span>
                                      <span className="text-[8px] font-bold text-gray-400">{m.label}</span>
                                    </div>
                                    <p className="text-[11px] text-gray-900 font-black leading-snug mt-1">{item.title}</p>
                                  </div>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const key = getReviewCheckedKey(item, i);
                                    setCheckedItems(prev => ({ ...prev, [key]: !prev[key] }));
                                    if (rawIdx >= 0 && activeDiff === rawIdx) setActiveDiff(null);
                                  }}
                                  className="p-0.5 hover:bg-gray-100 rounded-lg transition-all text-gray-400 hover:text-gray-700 cursor-pointer"
                                >
                                  {isChecked ? <CheckSquare className="w-3.5 h-3.5 text-emerald-500" /> : <Square className="w-3.5 h-3.5 text-gray-400" />}
                                </button>
                              </div>

                              <p className="text-[10px] text-gray-700 font-semibold leading-relaxed break-words">
                                {item.desc}
                              </p>

                              {currentResult && <ReviewCropPreview page={currentResult} item={item} />}

                              {(item.before || item.after) && (
                                <div className="grid gap-1 text-[9px] font-mono">
                                  {item.before && <div className="bg-rose-50 border border-rose-100 text-rose-700 rounded px-2 py-1 truncate">Before: {item.before}</div>}
                                  {item.after && <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 rounded px-2 py-1 truncate">After: {item.after}</div>}
                                </div>
                              )}

                              {!!item.relatedDiffs?.length && (
                                <div className="text-[8px] text-gray-400 font-bold">
                                  PDF 위 표시 {item.relatedDiffs.length}건
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Center Panel — View Modes ── */}
            <div className="flex-1 flex flex-col bg-gray-100 p-2 overflow-hidden min-w-0">
              
              {/* Info HUD (AI mode only) */}
              {!isVisualMode && (
                <div className="mb-3 bg-white border border-gray-200 rounded-xl p-2.5 flex items-center justify-between shadow-sm select-none flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                    <div className="text-[10px] text-gray-600 font-medium">
                      <span className="font-bold text-gray-900">정밀도 {precision}%</span> 모드 · 검출 {filteredDiffs.length}건 · OCR & Native 검증 완료
                    </div>
                  </div>
                </div>
              )}

              {/* Visual mode info */}
              {isVisualMode && false && (
                <div className="mb-3 bg-amber-50 border border-amber-200 rounded-xl p-2.5 flex items-center justify-between shadow-sm select-none flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <Eye className="w-3.5 h-3.5 text-amber-600" />
                    <div className="text-[10px] text-gray-700 font-medium">
                      <span className="font-bold text-amber-800">육안 검수 모드</span> — AI 분석 없이 뷰어 도구만 활용하여 직접 대조합니다. <span className="font-mono font-bold">Ctrl + 마우스 휠</span>로 줌을 조작하세요.
                    </div>
                  </div>
                </div>
              )}

              {/* ── Side-by-Side View ── */}
              {viewMode === 'side' && (
                <div className="flex-1 flex gap-3 min-h-0 relative">
                  <PdfPane
                    innerRef={scrollRefA}
                    onScroll={handleScrollA}
                    imgSrc={isVisualMode ? (currentVisualPage?.imgA || '') : (currentResult?.base64A || '')}
                    diffs={isVisualMode ? [] : overlayDiffs}
                    label="BEFORE — 원본"
                    activeDiff={isVisualMode ? null : activeDiff}
                    checkedItems={checkedItems}
                    zoom={zoom}
                    showDiffs={!isVisualMode}
                    aspectRatio={currentVisualPage?.aspectA}
                  />
                  
                  {/* Floating scroll lock indicator */}
                  <button 
                    onClick={() => setScrollLock(!scrollLock)}
                    className={cn(
                      "absolute top-2 left-1/2 -translate-x-1/2 z-20 shadow-lg rounded-full p-2 border transition-all duration-200 flex items-center justify-center bg-white cursor-pointer hover:scale-105 active:scale-95",
                      scrollLock 
                        ? "border-blue-500 text-blue-600" 
                        : "border-gray-200 text-gray-500"
                    )}
                    title={scrollLock ? "스크롤 동기화 켜짐" : "스크롤 동기화 꺼짐"}
                  >
                    {scrollLock ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                  </button>

                  <PdfPane
                    innerRef={scrollRefB}
                    onScroll={handleScrollB}
                    imgSrc={isVisualMode ? (currentVisualPage?.imgB || '') : (currentResult?.base64B || '')}
                    diffs={isVisualMode ? [] : overlayDiffs}
                    label="AFTER — 수정본"
                    activeDiff={isVisualMode ? null : activeDiff}
                    checkedItems={checkedItems}
                    zoom={zoom}
                    showDiffs={!isVisualMode}
                    aspectRatio={currentVisualPage?.aspectB}
                  />
                </div>
              )}

              {/* ── Swipe View Slider ── */}
              {viewMode === 'swipe' && (
                <div className="flex-1 border border-gray-200 rounded-2xl overflow-auto shadow-sm relative bg-gray-100 flex items-center justify-center select-none p-4 min-h-0 scrollbar-thin">
                  <div 
                    className="relative overflow-hidden bg-white border border-gray-200 rounded-xl shadow-lg"
                    style={{ width: `${zoom}%`, aspectRatio: currentVisualPage?.aspectA || 1 / 1.414 }}
                  >
                    {/* Document A (Background) */}
                    <PdfVisualLayer
                      src={isVisualMode ? (currentVisualPage?.imgA || '') : (currentResult?.base64A || '')}
                      title="Before preview"
                      aspectRatio={currentVisualPage?.aspectA}
                      style={{ imageRendering: !isVisualMode && zoom > 150 ? 'pixelated' : 'auto' }}
                    />
                    
                    {/* Document B (Foreground with Clip Path) */}
                    <div 
                      className="absolute inset-0 w-full h-full overflow-hidden"
                      style={{ clipPath: `polygon(0 0, ${sliderPos}% 0, ${sliderPos}% 100%, 0 100%)` }}
                    >
                      <PdfVisualLayer
                        src={isVisualMode ? (currentVisualPage?.imgB || '') : (currentResult?.base64B || '')}
                        title="After preview"
                        aspectRatio={currentVisualPage?.aspectB}
                        style={{ imageRendering: !isVisualMode && zoom > 150 ? 'pixelated' : 'auto' }}
                      />
                    </div>
                    
                    {/* Vertical Swipe Divider Handle */}
                    <div 
                      className="absolute top-0 bottom-0 w-0.5 bg-blue-500 cursor-ew-resize z-40 flex items-center justify-center"
                      style={{ left: `${sliderPos}%` }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const parent = e.currentTarget.parentElement;
                        if (!parent) return;
                        const rect = parent.getBoundingClientRect();
                        const handleMouseMove = (moveEvent: MouseEvent) => {
                          const pos = ((moveEvent.clientX - rect.left) / rect.width) * 100;
                          setSliderPos(Math.max(0, Math.min(100, pos)));
                        };
                        const handleMouseUp = () => {
                          window.removeEventListener('mousemove', handleMouseMove);
                          window.removeEventListener('mouseup', handleMouseUp);
                        };
                        window.addEventListener('mousemove', handleMouseMove);
                        window.addEventListener('mouseup', handleMouseUp);
                      }}
                    >
                      <div className="w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-500 border-2 border-white shadow-2xl flex items-center justify-center text-white cursor-ew-resize select-none">
                        <Split className="w-3.5 h-3.5 rotate-90" />
                      </div>
                    </div>
                    
                    {/* Floating labels */}
                    <div className="absolute top-2 left-2 bg-white/95 backdrop-blur text-gray-800 text-[9px] font-black px-2 py-0.5 rounded-lg border border-gray-200 shadow-sm z-10 pointer-events-none">
                      BEFORE (좌)
                    </div>
                    <div className="absolute top-2 right-2 bg-white/95 backdrop-blur text-gray-800 text-[9px] font-black px-2 py-0.5 rounded-lg border border-gray-200 shadow-sm z-10 pointer-events-none">
                      AFTER (우)
                    </div>
                  </div>
                </div>
              )}

              {/* ── Overlay Blend View ── */}
              {viewMode === 'overlay' && (
                <div className="flex-1 flex flex-col gap-3 min-h-0">
                  <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-2.5 flex-shrink-0 shadow-sm select-none">
                    <Layers className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                    <span className="text-[10px] font-bold text-gray-700 flex-shrink-0">투명도</span>
                    <input 
                      type="range" 
                      min="0" 
                      max="100" 
                      value={overlayOpacity * 100} 
                      onChange={(e) => setOverlayOpacity(parseInt(e.target.value) / 100)}
                      className="flex-1 accent-blue-600 cursor-pointer h-1.5 bg-gray-200 rounded-lg appearance-none" 
                    />
                    <span className="text-[10px] font-mono w-10 text-right text-gray-700 font-bold flex-shrink-0">{Math.round(overlayOpacity * 100)}%</span>
                    
                    <div className="w-px h-5 bg-gray-200 flex-shrink-0" />
                    
                    {/* Blend Mode Toggle */}
                    <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-lg border border-gray-200 flex-shrink-0">
                      <button
                        onClick={() => setBlendMode('difference')}
                        className={cn(
                          "px-2 py-1 rounded text-[9px] font-bold transition-all cursor-pointer",
                          blendMode === 'difference'
                            ? "bg-gray-900 text-white shadow"
                            : "text-gray-500 hover:text-gray-700 hover:bg-gray-200"
                        )}
                      >
                        차이 분석
                      </button>
                      <button
                        onClick={() => setBlendMode('normal')}
                        className={cn(
                          "px-2 py-1 rounded text-[9px] font-bold transition-all cursor-pointer",
                          blendMode === 'normal'
                            ? "bg-gray-900 text-white shadow"
                            : "text-gray-500 hover:text-gray-700 hover:bg-gray-200"
                        )}
                      >
                        투명 겹침
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 border border-gray-200 rounded-2xl overflow-auto shadow-sm relative bg-gray-100 flex items-center justify-center p-4 min-h-0 scrollbar-thin">
                    <div 
                      className="relative overflow-hidden bg-white border border-gray-200 rounded-lg shadow-lg"
                      style={{ width: `${zoom}%`, aspectRatio: currentVisualPage?.aspectA || 1 / 1.414 }}
                    >
                      {/* Base Image A */}
                      <PdfVisualLayer
                        src={isVisualMode ? (currentVisualPage?.imgA || '') : (currentResult?.base64A || '')}
                        title="Before overlay"
                        className="opacity-100"
                        aspectRatio={currentVisualPage?.aspectA}
                        style={{ imageRendering: !isVisualMode && zoom > 150 ? 'pixelated' : 'auto' }}
                      />
                      {/* Blended Overlaid Image B */}
                      <PdfVisualLayer
                        src={isVisualMode ? (currentVisualPage?.imgB || '') : (currentResult?.base64B || '')}
                        title="After overlay"
                        aspectRatio={currentVisualPage?.aspectB}
                        className={cn(
                          "transition-opacity duration-75",
                          blendMode === 'difference' ? "mix-blend-difference" : "mix-blend-normal"
                        )}
                        style={{
                          opacity: overlayOpacity,
                          imageRendering: !isVisualMode && zoom > 150 ? 'pixelated' : 'auto'
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
              
            </div>

          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
