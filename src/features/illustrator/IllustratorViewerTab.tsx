import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertCircle,
  Download,
  FileImage,
  Loader2,
  Maximize2,
  RefreshCcw,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
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

const SUPPORTED_EXTENSIONS = ['ai', 'eps', 'svg', 'pdf'];

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

function viewerSrc(url: string, page: number) {
  return `${url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH&page=${page}`;
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

export function IllustratorViewerTab() {
  const inputRef = useRef<HTMLInputElement>(null);
  const previousUrlRef = useRef<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
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

  const openDirect = async (file: File) => {
    const ext = extensionOf(file);
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      setError('AI, EPS, SVG, PDF 파일만 열 수 있습니다.');
      return;
    }

    setError(null);
    setLoading(false);
    setPage(1);
    setZoom(100);

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
    } catch (err: any) {
      setError(err.message || 'PDF 호환 저장된 AI 파일이 아니거나 EPS 변환에 실패했습니다.');
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

  const canConvert = !!viewer && ['ai', 'eps'].includes(extensionOf(viewer.file));
  const zoomLabel = useMemo(() => `${zoom}%`, [zoom]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight text-gray-950">일러스트 뷰어</h2>
          <p className="mt-1 text-sm font-medium text-gray-400">AI, EPS, SVG, PDF 파일을 빠르게 열어 확대 검수합니다.</p>
        </div>
        {viewer && (
          <button
            onClick={() => inputRef.current?.click()}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-600 shadow-sm transition hover:bg-gray-50"
          >
            새 파일 열기
          </button>
        )}
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-600"
          >
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X className="h-4 w-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {!viewer ? (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex flex-1 min-h-[480px] cursor-pointer select-none flex-col items-center justify-center gap-4 rounded-3xl border bg-white transition-all',
            dragging ? 'border-gray-500 bg-gray-50 shadow-lg' : 'border-dashed border-gray-200 hover:border-gray-300 hover:bg-gray-50/60'
          )}
        >
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-5 text-gray-400 shadow-sm">
            <Upload className="h-8 w-8" />
          </div>
          <div className="text-center">
            <p className="text-base font-black text-gray-800">일러스트 파일을 드래그하거나 클릭해서 열기</p>
            <p className="mt-2 text-xs font-bold tracking-wide text-gray-400">.ai · .eps · .svg · .pdf</p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/70 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="rounded-xl bg-gray-900 p-2 text-white">
                <FileImage className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-gray-900">{viewer.file.name}</p>
                <p className="text-[11px] font-bold text-gray-400">
                  {extensionOf(viewer.file).toUpperCase()} · {formatSize(viewer.file.size)} · {viewer.converted ? '변환 미리보기' : '원본 벡터'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-16 text-center text-xs font-black text-gray-700">{page} / {viewer.pageCount}</span>
              <button
                onClick={() => setPage(p => Math.min(viewer.pageCount, p + 1))}
                disabled={page >= viewer.pageCount}
                className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>

              <button onClick={() => setZoom(z => Math.max(25, z - 25))} className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500"><ZoomOut className="h-4 w-4" /></button>
              <span className="min-w-14 text-center text-xs font-black text-gray-700">{zoomLabel}</span>
              <button onClick={() => setZoom(z => Math.min(800, z + 25))} className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500"><ZoomIn className="h-4 w-4" /></button>
              <button onClick={() => setZoom(100)} className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500" title="화면 맞춤"><Maximize2 className="h-4 w-4" /></button>
              {canConvert && (
                <button
                  onClick={() => void convertPreview()}
                  disabled={loading}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-600 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="flex items-center gap-1"><RefreshCcw className="h-4 w-4" /> 변환 보기</span>}
                </button>
              )}
              <button onClick={downloadOriginal} className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-black text-white">
                <span className="flex items-center gap-1"><Download className="h-4 w-4" /> 원본</span>
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_1px_1px,#d7dce3_1px,transparent_0)] [background-size:18px_18px] p-6">
            <div className="mx-auto bg-white shadow-2xl" style={{ width: `${zoom}%`, minWidth: zoom > 100 ? `${zoom}%` : undefined, minHeight: '70vh' }}>
              {viewer.mode === 'svg' || viewer.mode === 'image' ? (
                <img src={viewer.sourceUrl} alt={viewer.file.name} className="block h-auto w-full select-none" draggable={false} />
              ) : (
                <iframe
                  src={viewerSrc(viewer.sourceUrl, page)}
                  title={viewer.file.name}
                  className="h-[78vh] w-full border-0 bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".ai,.eps,.svg,.pdf"
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />
    </div>
  );
}
