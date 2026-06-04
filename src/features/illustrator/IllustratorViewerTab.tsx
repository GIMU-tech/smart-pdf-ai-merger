import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertCircle,
  Download,
  FileImage,
  Maximize2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
  Home,
  FilePlus2,
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

type IllustratorViewerTabProps = {
  onGoHome?: () => void;
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

export function IllustratorViewerTab({ onGoHome }: IllustratorViewerTabProps) {
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

  const zoomLabel = useMemo(() => `${zoom}%`, [zoom]);

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
                ? `${extensionOf(viewer.file).toUpperCase()} · ${formatSize(viewer.file.size)} · ${viewer.converted ? 'PDF 미리보기' : '원본 벡터'}`
                : 'AI, EPS, SVG, PDF 파일을 열어 확대 검수'}
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
              <p className="mt-2 text-xs font-bold tracking-wide text-slate-400">.ai · .eps · .svg · .pdf</p>
            </div>
          </div>
        </div>
      ) : (
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
              <img src={viewer.sourceUrl} alt={viewer.file.name} className="block h-auto w-full select-none" draggable={false} />
            ) : (
              <iframe
                src={viewerSrc(viewer.sourceUrl)}
                title={viewer.file.name}
                className="h-full min-h-[720px] w-full border-0 bg-white"
              />
            )}
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
