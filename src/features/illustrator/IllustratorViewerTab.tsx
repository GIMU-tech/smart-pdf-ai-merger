import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertCircle,
  Download,
  Eye,
  EyeOff,
  FileImage,
  FilePlus2,
  Folder,
  Home,
  Image as ImageIcon,
  Layers,
  Maximize2,
  Search,
  Type,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { cn } from '../../lib/utils';

type PreviewMode = 'pdf' | 'svg' | 'image';

type ViewerState = {
  file: File;
  sourceUrl: string;
  mode: PreviewMode;
  pageCount: number;
  converted: boolean;
};

type Bounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type PsdLayerKind = 'group' | 'text' | 'smart' | 'shape' | 'image' | 'adjustment' | 'layer';

type PsdLayerNode = {
  id: string;
  name: string;
  depth: number;
  kind: PsdLayerKind;
  hidden: boolean;
  bounds: Bounds | null;
  text: string;
  children: PsdLayerNode[];
};

type PsdInfo = {
  width: number;
  height: number;
  layers: PsdLayerNode[];
  flatLayers: PsdLayerNode[];
  textLayers: PsdLayerNode[];
  warning: string | null;
};

type IllustratorViewerTabProps = {
  onGoHome?: () => void;
};

const SUPPORTED_EXTENSIONS = ['ai', 'eps', 'svg', 'pdf', 'psd'];

function formatSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function extensionOf(file: File) {
  return file.name.split('.').pop()?.toLowerCase() || '';
}

function apiBaseUrl() {
  if (typeof window === 'undefined') return '';
  return ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'http://localhost:8080'
    : (window.location.hostname.includes('vercel.app')
      ? 'https://smart-pdf-ai-merger.onrender.com'
      : window.location.origin);
}

async function countPdfPages(fileOrBlob: Blob) {
  try {
    const bytes = await fileOrBlob.arrayBuffer();
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return Math.max(1, pdf.getPageCount());
  } catch (_) {
    return 1;
  }
}

function viewerSrc(url: string) {
  return `${url}#toolbar=0&navpanes=0&scrollbar=1&view=FitH`;
}

async function hasPdfHeader(file: File) {
  const header = await file.slice(0, 5).arrayBuffer();
  return new TextDecoder('ascii').decode(header) === '%PDF-';
}

async function makeTypedBlobUrl(file: File, mimeType: string) {
  const buffer = await file.arrayBuffer();
  const blob = new Blob([buffer], { type: mimeType });
  return {
    blob,
    url: URL.createObjectURL(blob),
  };
}

function valueOfUnit(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && 'value' in value) {
    const nested = (value as { value?: unknown }).value;
    if (typeof nested === 'number' && Number.isFinite(nested)) return nested;
  }
  return null;
}

function boundsFromValues(left: unknown, top: unknown, right: unknown, bottom: unknown): Bounds | null {
  const l = valueOfUnit(left);
  const t = valueOfUnit(top);
  const r = valueOfUnit(right);
  const b = valueOfUnit(bottom);
  if (l === null || t === null || r === null || b === null) return null;
  const width = Math.max(0, r - l);
  const height = Math.max(0, b - t);
  if (width <= 0 || height <= 0) return null;
  return { left: l, top: t, right: r, bottom: b, width, height };
}

function boundsFromBox(box: unknown): Bounds | null {
  if (!box || typeof box !== 'object') return null;
  const data = box as Record<string, unknown>;
  return boundsFromValues(data.left, data.top, data.right, data.bottom)
    || boundsFromValues(data.x, data.y, valueOfUnit(data.x) !== null && valueOfUnit(data.width) !== null ? valueOfUnit(data.x)! + valueOfUnit(data.width)! : null, valueOfUnit(data.y) !== null && valueOfUnit(data.height) !== null ? valueOfUnit(data.y)! + valueOfUnit(data.height)! : null);
}

function layerBounds(layer: Record<string, unknown>): Bounds | null {
  const direct = boundsFromValues(layer.left, layer.top, layer.right, layer.bottom);
  if (direct) return direct;

  const text = layer.text && typeof layer.text === 'object' ? layer.text as Record<string, unknown> : null;
  if (!text) return null;

  return boundsFromValues(text.left, text.top, text.right, text.bottom)
    || boundsFromBox(text.bounds)
    || boundsFromBox(text.boundingBox);
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
}

function layerKind(layer: Record<string, unknown>, children: PsdLayerNode[]): PsdLayerKind {
  if (children.length > 0) return 'group';
  if (normalizeText((layer.text as Record<string, unknown> | undefined)?.text)) return 'text';
  if (layer.placedLayer) return 'smart';
  if (layer.vectorMask || layer.vectorFill || layer.vectorStroke) return 'shape';
  if (layer.adjustment) return 'adjustment';
  if (layer.canvas || layer.imageData) return 'image';
  return 'layer';
}

function flattenPsdLayers(children: unknown, depth = 0, path = 'layer') {
  const source = Array.isArray(children) ? children : [];
  const roots: PsdLayerNode[] = [];
  const flat: PsdLayerNode[] = [];

  source.forEach((rawLayer, index) => {
    const layer = (rawLayer && typeof rawLayer === 'object' ? rawLayer : {}) as Record<string, unknown>;
    const childResult = flattenPsdLayers(layer.children, depth + 1, `${path}-${index}`);
    const text = normalizeText((layer.text as Record<string, unknown> | undefined)?.text);
    const node: PsdLayerNode = {
      id: `${path}-${index}`,
      name: normalizeText(layer.name) || `Layer ${index + 1}`,
      depth,
      kind: layerKind(layer, childResult.roots),
      hidden: Boolean(layer.hidden),
      bounds: layerBounds(layer),
      text,
      children: childResult.roots,
    };

    roots.push(node);
    flat.push(node, ...childResult.flat);
  });

  return { roots, flat };
}

function layerKindLabel(kind: PsdLayerKind) {
  switch (kind) {
    case 'group': return '그룹';
    case 'text': return '텍스트';
    case 'smart': return '스마트';
    case 'shape': return '도형';
    case 'image': return '이미지';
    case 'adjustment': return '조정';
    default: return '레이어';
  }
}

function LayerIcon({ layer }: { layer: PsdLayerNode }) {
  if (layer.kind === 'group') return <Folder className="h-3.5 w-3.5" />;
  if (layer.kind === 'text') return <Type className="h-3.5 w-3.5" />;
  return <ImageIcon className="h-3.5 w-3.5" />;
}

async function canvasToObjectUrl(canvas: unknown) {
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('PSD 합성 미리보기 캔버스를 읽지 못했습니다.');
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(nextBlob => {
      if (nextBlob) resolve(nextBlob);
      else reject(new Error('PSD 미리보기 이미지 생성에 실패했습니다.'));
    }, 'image/png');
  });

  return {
    blob,
    url: URL.createObjectURL(blob),
  };
}

function activeBoundsStyle(layer: PsdLayerNode | null, psdInfo: PsdInfo | null): React.CSSProperties | undefined {
  if (!layer?.bounds || !psdInfo?.width || !psdInfo?.height) return undefined;
  return {
    left: `${(layer.bounds.left / psdInfo.width) * 100}%`,
    top: `${(layer.bounds.top / psdInfo.height) * 100}%`,
    width: `${(layer.bounds.width / psdInfo.width) * 100}%`,
    height: `${(layer.bounds.height / psdInfo.height) * 100}%`,
  };
}

export function IllustratorViewerTab({ onGoHome }: IllustratorViewerTabProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previousUrlRef = useRef<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [psdInfo, setPsdInfo] = useState<PsdInfo | null>(null);
  const [psdSearch, setPsdSearch] = useState('');
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previousUrlRef.current) URL.revokeObjectURL(previousUrlRef.current);
    };
  }, []);

  const resetUrl = (nextUrl: string) => {
    if (previousUrlRef.current) URL.revokeObjectURL(previousUrlRef.current);
    previousUrlRef.current = nextUrl;
  };

  const resetPsdState = () => {
    setPsdInfo(null);
    setPsdSearch('');
    setActiveLayerId(null);
  };

  const openPsd = async (file: File) => {
    setError(null);
    setLoading(true);
    setPage(1);
    setZoom(100);
    resetPsdState();

    try {
      const buffer = await file.arrayBuffer();
      const { readPsd } = await import('ag-psd');
      const psd = readPsd(buffer, {
        skipThumbnail: true,
        logMissingFeatures: false,
      }) as unknown as Record<string, unknown>;

      const preview = await canvasToObjectUrl(psd.canvas);
      const layers = flattenPsdLayers(psd.children);
      const textLayers = layers.flat.filter(layer => layer.text.length > 0);
      const warning = layers.flat.length === 0
        ? '이 PSD에서 읽을 수 있는 레이어 목록을 찾지 못했습니다. 저장 방식이나 색상 모드에 따라 레이어 정보가 제한될 수 있습니다.'
        : null;

      resetUrl(preview.url);
      setPsdInfo({
        width: Number(psd.width) || 1,
        height: Number(psd.height) || 1,
        layers: layers.roots,
        flatLayers: layers.flat,
        textLayers,
        warning,
      });
      setViewer({
        file,
        sourceUrl: preview.url,
        mode: 'image',
        pageCount: 1,
        converted: false,
      });
    } catch (err: unknown) {
      setError(err instanceof Error
        ? err.message
        : 'PSD 파일을 읽지 못했습니다. 일부 PSD 색상 모드나 저장 옵션은 지원되지 않을 수 있습니다.');
    } finally {
      setLoading(false);
    }
  };

  const openDirect = async (file: File) => {
    const ext = extensionOf(file);
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      setError('AI, EPS, SVG, PDF, PSD 파일만 열 수 있습니다.');
      return;
    }

    setError(null);
    setLoading(false);
    setPage(1);
    setZoom(100);
    resetPsdState();

    if (ext === 'psd') {
      await openPsd(file);
      return;
    }

    if (ext === 'eps') {
      await convertPreview(file);
      return;
    }

    if (ext === 'ai' && !(await hasPdfHeader(file))) {
      await convertPreview(file);
      return;
    }

    const typed = ext === 'svg'
      ? await makeTypedBlobUrl(file, 'image/svg+xml')
      : await makeTypedBlobUrl(file, 'application/pdf');
    const url = typed.url;
    resetUrl(url);
    setViewer({
      file,
      sourceUrl: url,
      mode: ext === 'svg' ? 'svg' : 'pdf',
      pageCount: ext === 'svg' ? 1 : await countPdfPages(typed.blob),
      converted: false,
    });
  };

  const convertPreview = async (file = viewer?.file) => {
    if (!file) return;
    setLoading(true);
    setError(null);
    resetPsdState();

    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`${apiBaseUrl()}/preview-illustrator`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || '미리보기 변환에 실패했습니다.');
      }

      const binary = atob(data.fileData);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: data.mimeType || 'application/pdf' });
      const url = URL.createObjectURL(blob);
      resetUrl(url);
      setViewer({
        file,
        sourceUrl: url,
        mode: data.mode === 'image' ? 'image' : 'pdf',
        pageCount: data.mode === 'image' ? 1 : await countPdfPages(blob),
        converted: true,
      });
      setPage(1);
      setZoom(100);
    } catch (err: unknown) {
      setError(err instanceof Error
        ? err.message
        : 'PDF 호환 저장된 AI 파일이 아니거나 EPS 변환에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void openDirect(file);
  };

  const downloadOriginal = () => {
    if (!viewer) return;
    const url = URL.createObjectURL(viewer.file);
    const a = document.createElement('a');
    a.href = url;
    a.download = viewer.file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const zoomLabel = useMemo(() => `${zoom}%`, [zoom]);
  const psdQuery = psdSearch.trim().toLowerCase();
  const psdMatches = useMemo(() => {
    if (!psdInfo || !psdQuery) return [];
    return psdInfo.flatLayers.filter(layer => {
      return layer.name.toLowerCase().includes(psdQuery)
        || layer.text.toLowerCase().includes(psdQuery);
    });
  }, [psdInfo, psdQuery]);
  const activeLayer = useMemo(() => {
    if (!psdInfo || !activeLayerId) return null;
    return psdInfo.flatLayers.find(layer => layer.id === activeLayerId) || null;
  }, [activeLayerId, psdInfo]);
  const psdSummary = psdInfo
    ? `PSD · ${psdInfo.width}x${psdInfo.height}px · 텍스트 ${psdInfo.textLayers.length}개 · 레이어 ${psdInfo.flatLayers.length}개`
    : null;

  const renderLayerRow = (layer: PsdLayerNode) => (
    <div key={layer.id}>
      <button
        type="button"
        onClick={() => setActiveLayerId(layer.id)}
        className={cn(
          'flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition',
          activeLayerId === layer.id
            ? 'bg-slate-900 text-white'
            : 'text-slate-700 hover:bg-slate-100'
        )}
        style={{ paddingLeft: `${8 + layer.depth * 14}px` }}
      >
        <span className={cn('mt-0.5 flex-shrink-0', activeLayerId === layer.id ? 'text-white' : 'text-slate-400')}>
          <LayerIcon layer={layer} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs font-black">{layer.name}</span>
            {layer.hidden
              ? <EyeOff className="h-3 w-3 flex-shrink-0 opacity-60" />
              : <Eye className="h-3 w-3 flex-shrink-0 opacity-60" />}
          </span>
          <span className={cn('mt-1 block text-[10px] font-black', activeLayerId === layer.id ? 'text-slate-200' : 'text-slate-400')}>
            {layerKindLabel(layer.kind)}
            {layer.bounds ? ` · ${Math.round(layer.bounds.width)}x${Math.round(layer.bounds.height)}` : ''}
          </span>
          {layer.text && (
            <span className={cn('mt-1 line-clamp-2 block whitespace-pre-wrap text-[11px] font-bold leading-snug', activeLayerId === layer.id ? 'text-slate-100' : 'text-slate-500')}>
              {layer.text}
            </span>
          )}
        </span>
      </button>
      {layer.children.map(child => renderLayerRow(child))}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-slate-100">
      <div className="flex min-h-12 flex-shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
        <button
          onClick={onGoHome}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-50"
        >
          <Home className="h-4 w-4" />
          홈
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="rounded-lg bg-slate-900 p-2 text-white">
            <FileImage className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-slate-950">
              {viewer ? viewer.file.name : '일러스트 뷰어'}
            </p>
            <p className="truncate text-[11px] font-bold text-slate-400">
              {viewer
                ? (psdSummary || `${extensionOf(viewer.file).toUpperCase()} · ${formatSize(viewer.file.size)} · ${viewer.converted ? 'PDF 미리보기' : '원본 벡터'}`)
                : 'AI, EPS, SVG, PDF, PSD 파일을 열어 확대 검수'}
            </p>
          </div>
        </div>

        {viewer && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={() => setZoom(z => Math.max(25, z - 25))} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50" title="축소"><ZoomOut className="h-4 w-4" /></button>
            <span className="min-w-14 rounded-lg bg-slate-100 px-3 py-2 text-center text-xs font-black text-slate-700">{zoomLabel}</span>
            <button onClick={() => setZoom(z => Math.min(800, z + 25))} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50" title="확대"><ZoomIn className="h-4 w-4" /></button>
            <button onClick={() => setZoom(100)} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50" title="화면 맞춤"><Maximize2 className="h-4 w-4" /></button>

            <button onClick={downloadOriginal} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white transition hover:bg-slate-700">
              <Download className="h-4 w-4" />
              원본
            </button>
            <button
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-50"
            >
              <FilePlus2 className="h-4 w-4" />
              새 파일
            </button>
          </div>
        )}

        {!viewer && (
          <button
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white transition hover:bg-slate-700"
          >
            <Upload className="h-4 w-4" />
            파일 열기
          </button>
        )}
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mx-3 mt-2 flex flex-shrink-0 items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-600"
          >
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X className="h-4 w-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {loading && (
        <div className="mx-3 mt-2 flex flex-shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-600 shadow-sm">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" />
          파일을 읽는 중입니다.
        </div>
      )}

      {!viewer ? (
        <div className="min-h-0 flex-1 p-4">
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
            onClick={() => inputRef.current?.click()}
            className={cn(
              'flex h-full min-h-[420px] cursor-pointer select-none flex-col items-center justify-center gap-4 rounded-3xl border bg-white transition-all',
              dragging ? 'border-slate-500 bg-slate-50 shadow-lg' : 'border-dashed border-slate-200 hover:border-slate-300 hover:bg-white/80'
            )}
          >
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5 text-slate-400 shadow-sm">
              <Upload className="h-8 w-8" />
            </div>
            <div className="text-center">
              <p className="text-base font-black text-slate-800">파일을 드래그하거나 클릭해서 열기</p>
              <p className="mt-2 text-xs font-bold tracking-wide text-slate-400">.ai · .eps · .svg · .pdf · .psd</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {psdInfo && (
            <aside className="flex w-[340px] flex-shrink-0 flex-col border-r border-slate-200 bg-white">
              <div className="border-b border-slate-100 p-3">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-slate-900 p-2 text-white">
                    <Layers className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-950">PSD 레이어</p>
                    <p className="text-[11px] font-bold text-slate-400">
                      {psdInfo.flatLayers.length}개 레이어 · 텍스트 {psdInfo.textLayers.length}개
                    </p>
                  </div>
                </div>

                <label className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-500">
                  <Search className="h-4 w-4 flex-shrink-0" />
                  <input
                    value={psdSearch}
                    onChange={e => setPsdSearch(e.target.value)}
                    placeholder="레이어명 또는 텍스트 검색"
                    className="min-w-0 flex-1 bg-transparent text-xs font-bold text-slate-800 outline-none placeholder:text-slate-400"
                  />
                  {psdSearch && (
                    <button type="button" onClick={() => setPsdSearch('')} className="text-slate-400 hover:text-slate-700">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </label>
              </div>

              {psdInfo.warning && (
                <div className="m-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-bold leading-relaxed text-amber-700">
                  {psdInfo.warning}
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-auto p-2">
                {psdQuery ? (
                  <div className="space-y-1">
                    <p className="px-2 py-1 text-[11px] font-black text-slate-400">
                      검색 결과 {psdMatches.length}개
                    </p>
                    {psdMatches.length > 0 ? psdMatches.map(layer => renderLayerRow(layer)) : (
                      <div className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-xs font-bold text-slate-400">
                        일치하는 레이어나 텍스트가 없습니다.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {psdInfo.layers.length > 0 ? psdInfo.layers.map(layer => renderLayerRow(layer)) : (
                      <div className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-xs font-bold text-slate-400">
                        표시할 레이어가 없습니다.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </aside>
          )}

          <div className="min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_1px_1px,#cbd5e1_1px,transparent_0)] [background-size:18px_18px] p-4">
            <div
              className="mx-auto bg-white shadow-2xl"
              style={{
                width: `${zoom}%`,
                minWidth: zoom > 100 ? `${zoom}%` : undefined,
                height: viewer.mode === 'pdf' ? '100%' : undefined,
                minHeight: viewer.mode === 'pdf' ? '720px' : undefined,
              }}
            >
              {viewer.mode === 'svg' || viewer.mode === 'image' ? (
                <div className="relative">
                  <img src={viewer.sourceUrl} alt={viewer.file.name} className="block h-auto w-full select-none" draggable={false} />
                  {activeBoundsStyle(activeLayer, psdInfo) && (
                    <div
                      className="pointer-events-none absolute border-2 border-rose-500 bg-rose-500/10 shadow-[0_0_0_9999px_rgba(15,23,42,0.08)]"
                      style={activeBoundsStyle(activeLayer, psdInfo)}
                    >
                      {activeLayer && (
                        <div className="absolute left-0 top-0 max-w-[220px] -translate-y-full truncate rounded-t-md bg-rose-500 px-2 py-1 text-[11px] font-black text-white">
                          {activeLayer.name}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <iframe
                  src={viewerSrc(viewer.sourceUrl)}
                  title={viewer.file.name}
                  className="h-full min-h-[720px] w-full border-0 bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".ai,.eps,.svg,.pdf,.psd"
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />
    </div>
  );
}
