import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertCircle,
  Download,
  FileImage,
  Maximize2,
  X,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Layers,
  Type,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { WorkspaceToolbar } from '../../ui/shell/WorkspaceToolbar';
import { FileWorkflowGate } from '../../ui/workflow/FileWorkflowGate';
import { NewWorkButton } from '../../ui/workflow/NewWorkButton';

type PreviewMode = 'pdf' | 'svg' | 'image' | 'psd';
type RenderMode = 'native' | 'image';

type PsdLayerInfo = {
  id: string;
  name: string;
  depth: number;
  hidden: boolean;
  isGroup: boolean;
  hasImage: boolean;
  text?: string;
  bbox?: { left: number; top: number; width: number; height: number };
};

type PsdInfo = {
  width: number;
  height: number;
  layerCount: number;
  textLayerCount: number;
  layers: PsdLayerInfo[];
};

type ViewerState = {
  file: File;
  sourceUrl: string;
  mode: PreviewMode;
  pageCount: number;
  converted: boolean;
  psd?: PsdInfo;
};

const SUPPORTED_EXTENSIONS = ['ai', 'eps', 'svg', 'pdf', 'psd', 'psb'];
const PSD_LIKE_EXTENSIONS = new Set(['psd', 'psb']);

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

function viewerSrcForPage(url: string, page: number) {
  return `${url}#page=${page}&toolbar=0&navpanes=0&scrollbar=1&view=FitH`;
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

function flattenPsdLayers(layers: any[] | undefined, depth = 0, prefix = 'layer'): PsdLayerInfo[] {
  if (!layers?.length) return [];

  return layers.flatMap((layer, index) => {
    const children = flattenPsdLayers(layer.children, depth + 1, `${prefix}-${index}`);
    const left = Number(layer.left || 0);
    const top = Number(layer.top || 0);
    const right = Number(layer.right || left);
    const bottom = Number(layer.bottom || top);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    const text = typeof layer.text?.text === 'string' ? layer.text.text.trim() : '';
    const current: PsdLayerInfo = {
      id: `${prefix}-${index}`,
      name: layer.name || (layer.children?.length ? 'Group' : 'Layer'),
      depth,
      hidden: !!layer.hidden,
      isGroup: !!layer.children?.length,
      hasImage: !!(layer.canvas || layer.imageData),
      text: text || undefined,
      bbox: width > 0 && height > 0 ? { left, top, width, height } : undefined,
    };
    return [current, ...children];
  });
}

function makePsdPreviewCanvas(psd: any) {
  if (psd.canvas) return psd.canvas as HTMLCanvasElement;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Number(psd.width || 1));
  canvas.height = Math.max(1, Number(psd.height || 1));
  const context = canvas.getContext('2d');
  if (!context) return null;

  const drawLayers = (layers: any[] | undefined) => {
    if (!layers?.length) return;
    [...layers].reverse().forEach(layer => {
      if (layer.hidden) return;
      if (layer.children?.length) {
        drawLayers(layer.children);
        return;
      }
      if (layer.canvas) {
        context.globalAlpha = typeof layer.opacity === 'number' ? layer.opacity / 255 : 1;
        context.drawImage(layer.canvas, Number(layer.left || 0), Number(layer.top || 0));
        context.globalAlpha = 1;
      }
    });
  };

  drawLayers(psd.children);
  return canvas;
}

async function renderPdfPageToImage(url: string, pageNumber: number) {
  const pdfjs: any = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

  const task = pdfjs.getDocument({ url });
  const pdf = await task.promise;
  try {
    const pdfPage = await pdf.getPage(pageNumber);
    const viewport = pdfPage.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('이미지 렌더 캔버스를 만들 수 없습니다.');
    await pdfPage.render({ canvasContext: context, viewport }).promise;
    return canvas.toDataURL('image/png');
  } finally {
    pdf.destroy?.();
  }
}

export function IllustratorViewerTab() {
  const previousUrlRef = useRef<string | null>(null);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [renderMode, setRenderMode] = useState<RenderMode>('native');
  const [pdfImageUrl, setPdfImageUrl] = useState('');
  const [renderingImage, setRenderingImage] = useState(false);
  const [psdQuery, setPsdQuery] = useState('');
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previousUrlRef.current) URL.revokeObjectURL(previousUrlRef.current);
    };
  }, []);

  const resetUrl = (nextUrl: string, revokeLater = true) => {
    if (previousUrlRef.current) URL.revokeObjectURL(previousUrlRef.current);
    previousUrlRef.current = revokeLater ? nextUrl : null;
  };

  useEffect(() => {
    let cancelled = false;
    setPdfImageUrl('');

    if (!viewer || viewer.mode !== 'pdf' || renderMode !== 'image') {
      setRenderingImage(false);
      return;
    }

    setRenderingImage(true);
    renderPdfPageToImage(viewer.sourceUrl, page)
      .then(url => {
        if (!cancelled) setPdfImageUrl(url);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.message || 'PDF를 이미지로 렌더하지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setRenderingImage(false);
      });

    return () => {
      cancelled = true;
    };
  }, [viewer?.sourceUrl, viewer?.mode, renderMode, page]);

  useEffect(() => {
    if (!viewer) return;
    setPage(current => Math.min(Math.max(1, current), viewer.pageCount));
  }, [viewer?.pageCount]);

  const openPsd = async (file: File) => {
    setLoading(true);
    setError(null);
    setPage(1);
    setZoom(100);
    setRenderMode('image');
    setPsdQuery('');
    setActiveLayerId(null);

    try {
      const { readPsd } = await import('ag-psd');
      const buffer = await file.arrayBuffer();
      const psd = readPsd(buffer, { skipThumbnail: true });
      const compositeCanvas = makePsdPreviewCanvas(psd);
      if (!compositeCanvas) {
        throw new Error('이 PSD/PSB에는 표시 가능한 합성 미리보기 이미지가 없습니다.');
      }

      const layers = flattenPsdLayers(psd.children);
      const sourceUrl = compositeCanvas.toDataURL('image/png');
      resetUrl(sourceUrl, false);
      setViewer({
        file,
        sourceUrl,
        mode: 'psd',
        pageCount: 1,
        converted: false,
        psd: {
          width: psd.width,
          height: psd.height,
          layerCount: layers.length,
          textLayerCount: layers.filter(layer => !!layer.text).length,
          layers,
        },
      });
      setActiveLayerId(null);
    } catch (err: any) {
      setError(err.message || 'PSD/PSB 파일을 읽지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const openDirect = async (file: File) => {
    const ext = extensionOf(file);
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      setError('AI, EPS, SVG, PDF, PSD, PSB 파일만 열 수 있습니다.');
      return;
    }

    setError(null);
    setLoading(false);
    setPage(1);
    setZoom(100);
    setRenderMode('native');
    setPsdQuery('');
    setActiveLayerId(null);

    if (PSD_LIKE_EXTENSIONS.has(ext)) {
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
      setRenderMode(data.mode === 'image' ? 'image' : 'native');
    } catch (err: any) {
      setError(err.message || 'PDF 호환 저장된 AI 파일이 아니거나 EPS 변환에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const resetViewerWork = () => {
    if (previousUrlRef.current) URL.revokeObjectURL(previousUrlRef.current);
    previousUrlRef.current = null;
    setViewer(null);
    setPage(1);
    setZoom(100);
    setRenderMode('native');
    setPdfImageUrl('');
    setRenderingImage(false);
    setPsdQuery('');
    setActiveLayerId(null);
    setLoading(false);
    setError(null);
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
  const filteredPsdLayers = useMemo(() => {
    const layers = viewer?.psd?.layers || [];
    const query = psdQuery.trim().toLowerCase();
    if (!query) return layers;
    return layers.filter(layer =>
      layer.name.toLowerCase().includes(query) ||
      (layer.text || '').toLowerCase().includes(query)
    );
  }, [viewer?.psd?.layers, psdQuery]);
  const activeLayer = useMemo(
    () => viewer?.psd?.layers.find(layer => layer.id === activeLayerId) || null,
    [viewer?.psd?.layers, activeLayerId]
  );
  const viewerMeta = viewer
    ? `${extensionOf(viewer.file).toUpperCase()} · ${formatSize(viewer.file.size)} · ${
        viewer.mode === 'psd'
          ? `${viewer.psd?.width || 0}×${viewer.psd?.height || 0}px · 레이어 ${viewer.psd?.layerCount || 0}개`
          : viewer.converted
            ? 'PDF 미리보기'
            : viewer.mode === 'pdf'
              ? '원본 PDF'
              : '원본 이미지'
      }`
    : 'AI, EPS, SVG, PDF, PSD, PSB 파일을 열어 확대 검수';

  if (!viewer) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto bg-app">
        <div className="mx-auto w-full max-w-[920px] px-6 py-8 md:px-8">
          <FileWorkflowGate
            title="뷰어"
            description="AI, EPS, SVG, PDF, PSD, PSB 파일을 열어 확대 검수합니다."
            featureIcon={<FileImage className="size-5" />}
            featureIconClassName="text-emerald-500"
            uploadTitle={loading ? '파일을 불러오는 중입니다' : '확인할 파일을 드래그하거나 클릭하여 선택'}
            uploadDescription=".ai · .eps · .svg · .pdf · .psd · .psb"
            actionLabel="파일 열기"
            accept=".ai,.eps,.svg,.pdf,.psd,.psb"
            disabled={loading}
            onFiles={files => {
              const [file] = files;
              if (file) void openDirect(file);
            }}
          >
            {error && (
              <div role="alert" className="flex items-center gap-2 rounded-control border border-danger/20 bg-danger-subtle px-4 py-3 text-sm font-bold text-danger">
                <AlertCircle className="size-4 shrink-0" />
                <span className="flex-1">{error}</span>
                <button type="button" onClick={() => setError(null)} aria-label="오류 닫기"><X className="size-4" /></button>
              </div>
            )}
          </FileWorkflowGate>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[#fbfcfd] bg-[radial-gradient(circle_at_1px_1px,rgba(15,23,42,0.08)_1px,transparent_0)] [background-size:22px_22px]">
      <WorkspaceToolbar aria-label="뷰어 작업 도구">
        <div className="flex min-w-48 flex-1 items-center gap-2">
          <div className="grid size-8 shrink-0 place-items-center text-emerald-500">
            <FileImage className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold tracking-tight text-primary">
              {viewer ? viewer.file.name : '뷰어'}
            </p>
            <p className="truncate text-[11px] font-semibold text-muted">
              {viewerMeta}
            </p>
          </div>
        </div>

        {viewer && (
          <div className="flex flex-shrink-0 items-center gap-1.5">
            {viewer.pageCount > 1 && (
              <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
                <button
                  onClick={() => setPage(v => Math.max(1, v - 1))}
                  className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-50 disabled:opacity-30"
                  disabled={page <= 1}
                  title="이전 페이지"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-14 text-center text-[11px] font-black text-slate-600">{page} / {viewer.pageCount}</span>
                <button
                  onClick={() => setPage(v => Math.min(viewer.pageCount, v + 1))}
                  className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-50 disabled:opacity-30"
                  disabled={page >= viewer.pageCount}
                  title="다음 페이지"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
            {viewer.mode === 'pdf' && (
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
                <button
                  onClick={() => setRenderMode('native')}
                  className={cn(
                    'rounded-md px-2.5 py-1.5 text-[11px] font-black transition',
                    renderMode === 'native' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  PDF
                </button>
                <button
                  onClick={() => setRenderMode('image')}
                  className={cn(
                    'rounded-md px-2.5 py-1.5 text-[11px] font-black transition',
                    renderMode === 'image' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  이미지
                </button>
              </div>
            )}
            <button onClick={() => setZoom(z => Math.max(25, z - 25))} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50" title="축소"><ZoomOut className="h-4 w-4" /></button>
            <span className="min-w-14 rounded-lg bg-slate-100 px-3 py-2 text-center text-xs font-black text-slate-700">{zoomLabel}</span>
            <button onClick={() => setZoom(z => Math.min(800, z + 25))} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50" title="확대"><ZoomIn className="h-4 w-4" /></button>
            <button onClick={() => setZoom(100)} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50" title="화면 맞춤"><Maximize2 className="h-4 w-4" /></button>

            <button onClick={downloadOriginal} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white transition hover:bg-slate-700">
              <Download className="h-4 w-4" />
              원본
            </button>
            <NewWorkButton onConfirm={resetViewerWork} />
          </div>
        )}
      </WorkspaceToolbar>

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

      {viewer.mode === 'psd' ? (
        <div className="flex min-h-0 flex-1 bg-transparent">
          <aside className="flex w-80 flex-shrink-0 flex-col border-r border-slate-200 bg-white">
            <div className="border-b border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-black text-slate-900">{extensionOf(viewer.file).toUpperCase()} 레이어</p>
                  <p className="mt-1 text-[10px] font-bold text-slate-400">
                    텍스트 {viewer.psd?.textLayerCount || 0}개 · 전체 {viewer.psd?.layerCount || 0}개
                  </p>
                </div>
                <Layers className="h-4 w-4 text-slate-400" />
              </div>
              <button
                onClick={() => setActiveLayerId(null)}
                disabled={!activeLayerId}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-600 transition hover:bg-slate-50 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white"
              >
                <X className="h-3.5 w-3.5" />
                레이어 선택 해제
              </button>
              <input
                value={psdQuery}
                onChange={e => setPsdQuery(e.target.value)}
                placeholder="레이어 또는 텍스트 검색"
                className="mt-3 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 outline-none transition focus:border-slate-400 focus:bg-white"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-2">
              {filteredPsdLayers.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs font-bold text-slate-400">
                  검색 결과 없음
                </div>
              ) : (
                filteredPsdLayers.map(layer => (
                  <button
                    key={layer.id}
                    onClick={() => setActiveLayerId(current => current === layer.id ? null : layer.id)}
                    className={cn(
                      'mb-1 flex w-full items-start gap-2 rounded-lg border px-2 py-2 text-left transition',
                      activeLayerId === layer.id
                        ? 'border-slate-400 bg-slate-100'
                        : 'border-transparent hover:border-slate-200 hover:bg-slate-50',
                      layer.hidden && 'opacity-55'
                    )}
                    style={{ paddingLeft: `${8 + layer.depth * 14}px` }}
                  >
                    <div className="mt-0.5 flex-shrink-0 text-slate-400">
                      {layer.hidden ? <EyeOff className="h-3.5 w-3.5" /> : layer.text ? <Type className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-black text-slate-700">{layer.name}</p>
                      {layer.text && <p className="mt-1 line-clamp-2 text-[10px] font-semibold leading-snug text-slate-500">{layer.text}</p>}
                      {layer.bbox && (
                        <p className="mt-1 text-[9px] font-bold text-slate-400">
                          {Math.round(layer.bbox.width)}×{Math.round(layer.bbox.height)} px
                        </p>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>

          <div className="min-h-0 flex-1 overflow-auto p-4">
            <div
              className="relative mx-auto bg-white shadow-2xl"
              style={{
                width: `${zoom}%`,
                maxWidth: zoom <= 100 ? `${viewer.psd?.width || 1}px` : undefined,
                minWidth: zoom > 100 ? `${zoom}%` : undefined,
              }}
            >
              <img src={viewer.sourceUrl} alt={viewer.file.name} className="block h-auto w-full select-none" draggable={false} />
              {activeLayer?.bbox && viewer.psd && (
                <div
                  className="pointer-events-none absolute border-2 border-rose-500 bg-rose-500/10 shadow-[0_0_0_9999px_rgba(15,23,42,0.10)]"
                  style={{
                    left: `${(activeLayer.bbox.left / viewer.psd.width) * 100}%`,
                    top: `${(activeLayer.bbox.top / viewer.psd.height) * 100}%`,
                    width: `${(activeLayer.bbox.width / viewer.psd.width) * 100}%`,
                    height: `${(activeLayer.bbox.height / viewer.psd.height) * 100}%`,
                  }}
                >
                  <div className="absolute left-0 top-0 -translate-y-full rounded-t-md bg-rose-600 px-2 py-1 text-[10px] font-black text-white">
                    {activeLayer.name}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div
            className="mx-auto bg-white shadow-2xl"
            style={{
              width: `${zoom}%`,
              minWidth: zoom > 100 ? `${zoom}%` : undefined,
              height: viewer.mode === 'pdf' && renderMode === 'native' ? '100%' : undefined,
              minHeight: viewer.mode === 'pdf' && renderMode === 'native' ? '720px' : undefined,
            }}
          >
            {viewer.mode === 'svg' || viewer.mode === 'image' || (viewer.mode === 'pdf' && renderMode === 'image') ? (
              renderingImage || (viewer.mode === 'pdf' && renderMode === 'image' && !pdfImageUrl) ? (
                <div className="flex min-h-[520px] items-center justify-center text-sm font-black text-slate-400">
                  이미지 렌더 중...
                </div>
              ) : (
                <img
                  src={viewer.mode === 'pdf' ? pdfImageUrl : viewer.sourceUrl}
                  alt={viewer.file.name}
                  className="block h-auto w-full select-none"
                  draggable={false}
                />
              )
            ) : (
              <iframe
                src={viewerSrcForPage(viewer.sourceUrl, page)}
                title={viewer.file.name}
                className="h-full min-h-[720px] w-full border-0 bg-white"
              />
            )}
          </div>
        </div>
      )}

    </div>
  );
}
