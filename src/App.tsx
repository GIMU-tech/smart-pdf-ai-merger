import React, { useState, useRef } from 'react';
import { PDFDocument } from 'pdf-lib';
import { motion, AnimatePresence } from 'motion/react';
import JSZip from 'jszip';
import {
  Upload,
  FilePlus2,
  Trash2,
  Download,
  Loader2,
  AlertCircle,
  X,
  CheckCircle2,
  FolderOpen,
  ChevronRight,
  Home,
  ArrowRight,
  Files,
  FileOutput,
  Printer,
  Search,
  FileImage,
  Images,
  Ruler,
  Layers3,
  Scissors,
  Braces,
  Plus,
  Settings,
  MoreHorizontal,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { cn } from './lib/utils';
import { CompareTab } from './features/compare/CompareTab';
import { IllustratorViewerTab } from './features/illustrator/IllustratorViewerTab';
import { ImageToolkitTab } from './features/images/ImageToolkitTab';
import type { ImageToolMode } from './features/images/types';

interface FileItem {
  id: string;
  file: File;
  name: string;
  size: number;
}

type DownloadItem = {
  id: string;
  label: string;
  fileName: string;
  blob: Blob;
  note?: string;
  emphasis?: boolean;
  editableName?: string;
  pageNumber?: number;
  totalPages?: number;
};

type AppTab = 'home' | 'merge' | 'split' | 'outline' | 'compare' | 'illustrator' | 'images';

type FeatureCard = {
  tab: Exclude<AppTab, 'home'>;
  title: string;
  eyebrow: string;
  description: string;
  formats: string;
  purpose: string;
  cta: string;
  accent: string;
  icon: React.ComponentType<{ className?: string }>;
};

const featureCards: FeatureCard[] = [
  {
    tab: 'merge',
    title: 'PDF 병합',
    eyebrow: '문서 정리',
    description: 'PDF, PDF 호환 AI, 이미지, SVG 파일을 순서대로 하나의 PDF로 합칩니다.',
    formats: 'PDF, AI, 이미지, SVG',
    purpose: '인쇄물 묶음, 이미지 포함 납품 파일 정리',
    cta: '파일 합치기',
    accent: 'from-sky-500 to-cyan-400',
    icon: Files,
  },
  {
    tab: 'split',
    title: 'PDF 분리',
    eyebrow: '문서 정리',
    description: '여러 페이지 PDF를 페이지별 단일 PDF로 나누고 ZIP으로 내려받습니다.',
    formats: 'PDF',
    purpose: '대지별 파일 분리, 페이지별 납품',
    cta: '페이지 나누기',
    accent: 'from-blue-500 to-indigo-400',
    icon: FileOutput,
  },
  {
    tab: 'outline',
    title: '인쇄용 변환',
    eyebrow: '출력 준비',
    description: '원본과 인쇄용 파일을 함께 내려받을 수 있도록 아웃라인 변환을 실행합니다.',
    formats: 'PDF, AI',
    purpose: '폰트 깨짐 방지, 출력소 전달',
    cta: '인쇄용 만들기',
    accent: 'from-amber-500 to-orange-400',
    icon: Printer,
  },
  {
    tab: 'compare',
    title: 'PDF 비교',
    eyebrow: '정밀 검수',
    description: '원본과 수정본을 대조해 텍스트, 수치, 도면 변경 후보를 검수합니다.',
    formats: 'PDF',
    purpose: '수정 전후 확인, 인쇄 사고 예방',
    cta: '변경점 찾기',
    accent: 'from-rose-500 to-red-400',
    icon: Search,
  },
  {
    tab: 'illustrator',
    title: '뷰어',
    eyebrow: '벡터 확인',
    description: 'AI, EPS, SVG, PDF, PSD, PSB 파일을 빠르게 열어 확대 검수하고 원본을 내려받습니다.',
    formats: 'AI, EPS, SVG, PDF, PSD, PSB',
    purpose: '파일 미리보기, 확대 검수',
    cta: '파일 열어보기',
    accent: 'from-emerald-500 to-teal-400',
    icon: FileImage,
  },
  {
    tab: 'images',
    title: '이미지 툴킷',
    eyebrow: '상세페이지',
    description: '이미지 크기 변경, 이어붙이기, 자르기, HTML 이미지 수집을 처리합니다.',
    formats: 'PNG, JPG, JPEG, WebP, HTML',
    purpose: '상세페이지 제작, 쇼핑몰 이미지 정리',
    cta: '이미지 작업하기',
    accent: 'from-violet-500 to-fuchsia-400',
    icon: Images,
  },
];

const homeRailItems: Array<{ tab?: AppTab; label: string; icon: React.ComponentType<{ className?: string }>; muted?: boolean }> = [
  { label: 'New', icon: Plus, muted: true },
  { tab: 'home', label: '홈', icon: Home },
  { tab: 'merge', label: '병합', icon: Files },
  { tab: 'split', label: '분리', icon: FileOutput },
  { tab: 'outline', label: '출력', icon: Printer },
  { tab: 'compare', label: '비교', icon: Search },
  { tab: 'illustrator', label: '뷰어', icon: FileImage },
  { tab: 'images', label: '이미지', icon: Images },
];

type WorkspaceItem = {
  tab: Exclude<AppTab, 'home'>;
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  imageMode?: ImageToolMode;
};

const workspaceGroups: Array<{
  label: string;
  items: WorkspaceItem[];
}> = [
  {
    label: '문서 준비',
    items: [
      { tab: 'merge', title: 'PDF 병합', desc: 'PDF, AI, 이미지 묶음', icon: Files, color: 'text-sky-500' },
      { tab: 'split', title: 'PDF 분리', desc: '페이지별 PDF 저장', icon: FileOutput, color: 'text-blue-500' },
      { tab: 'outline', title: '인쇄용 변환', desc: '출력 전달 파일 생성', icon: Printer, color: 'text-amber-500' },
    ],
  },
  {
    label: '정밀 검수',
    items: [
      { tab: 'compare', title: 'PDF 비교', desc: '수정 전후 변경점 확인', icon: Search, color: 'text-rose-500' },
    ],
  },
  {
    label: '파일 확인',
    items: [
      { tab: 'illustrator', title: '뷰어', desc: 'AI, PDF, PSD/PSB 확대 검수', icon: FileImage, color: 'text-emerald-500' },
    ],
  },
  {
    label: '이미지 제작',
    items: [
      { tab: 'images', imageMode: 'resize', title: '크기 변경', desc: '지정 폭 일괄 변환', icon: Ruler, color: 'text-violet-500' },
      { tab: 'images', imageMode: 'stitch', title: '이어붙이기', desc: '이미지 세로 합치기', icon: Layers3, color: 'text-fuchsia-500' },
      { tab: 'images', imageMode: 'split', title: '자르기', desc: '긴 이미지 분할', icon: Scissors, color: 'text-orange-500' },
      { tab: 'images', imageMode: 'html', title: 'HTML 수집', desc: '이미지 링크 추출', icon: Braces, color: 'text-cyan-500' },
    ],
  },
];

function formatSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function uniqueWorkspaceItems(items: WorkspaceItem[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = workspaceItemKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function workspaceItemKey(item: WorkspaceItem) {
  return item.imageMode ? `${item.tab}-${item.imageMode}` : `${item.tab}-${item.title}`;
}

function workspacePreviewText(item: WorkspaceItem) {
  if (item.tab === 'compare') {
    return {
      title: '수정 전후 변경점 확인',
      desc: '두 PDF를 나란히 놓고 숫자, 문구, 도면 차이를 카드와 표시 영역으로 검수합니다.',
      meta: '샘플 비교 결과',
    };
  }
  if (item.tab === 'merge') {
    return {
      title: '인쇄 파일 한 번에 묶기',
      desc: 'PDF, AI, 이미지 파일을 순서대로 정리해 하나의 전달용 PDF로 만듭니다.',
      meta: '샘플 파일 목록',
    };
  }
  if (item.tab === 'split') {
    return {
      title: '페이지별 PDF 자동 분리',
      desc: '여러 페이지 PDF를 읽어 각 페이지를 독립 PDF로 만들고 ZIP 패키지로 정리합니다.',
      meta: '페이지별 결과',
    };
  }
  if (item.tab === 'outline') {
    return {
      title: '출력용 변환 파일 생성',
      desc: '인쇄 전달에 필요한 변환 작업을 실행하고 결과 파일을 바로 내려받습니다.',
      meta: '샘플 변환 결과',
    };
  }
  if (item.tab === 'illustrator') {
    return {
      title: 'AI, PDF, PSD/PSB 확대 검수',
      desc: '대지와 레이어를 크게 열어보고 원본 파일을 시각적으로 확인합니다.',
      meta: 'AI · PS · PDF',
    };
  }
  if (item.imageMode === 'resize') {
    return {
      title: '이미지 일괄 크기 변경',
      desc: '여러 이미지를 지정 폭 기준으로 맞추고 PNG 결과를 생성합니다.',
      meta: '샘플 결과',
    };
  }
  if (item.imageMode === 'stitch') {
    return {
      title: '이미지 세로 이어붙이기',
      desc: '상세페이지 이미지를 순서대로 쌓아 긴 이미지로 합칩니다.',
      meta: '샘플 결과',
    };
  }
  if (item.imageMode === 'split') {
    return {
      title: '긴 이미지 자르기',
      desc: '긴 상세 이미지를 원하는 기준으로 나눠 업로드용 파일로 정리합니다.',
      meta: '샘플 분할 결과',
    };
  }
  return {
    title: 'HTML 이미지 링크 수집',
    desc: '상세페이지 HTML에서 이미지 링크를 추출해 제작 자료를 정리합니다.',
    meta: '샘플 링크 목록',
  };
}

function workspacePreviewImagePath(item: WorkspaceItem) {
  if (item.tab === 'merge') return '/workspace-previews/merge.png';
  if (item.tab === 'split') return '/workspace-previews/merge.png';
  if (item.tab === 'outline') return '/workspace-previews/outline.png';
  if (item.tab === 'compare') return '/workspace-previews/compare.png';
  if (item.tab === 'illustrator') return '/workspace-previews/viewer.png';
  if (item.imageMode === 'resize') return '/workspace-previews/image-resize.png';
  if (item.imageMode === 'stitch') return '/workspace-previews/image-stitch.png';
  if (item.imageMode === 'split') return '/workspace-previews/image-split.png';
  return '/workspace-previews/image-html.png';
}

function WorkspacePreviewMeta({ item, meta }: { item: WorkspaceItem; meta: string }) {
  if (item.tab !== 'illustrator') {
    return <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">{meta}</span>;
  }

  const fileTypes = [
    { label: 'AI', className: 'bg-[#2b1600] text-[#ff9f1a]' },
    { label: 'PS', className: 'bg-[#061a33] text-sky-300' },
    { label: 'PDF', className: 'bg-rose-50 text-rose-600 ring-rose-100' },
  ];

  return (
    <span className="flex items-center gap-1" aria-label={meta}>
      {fileTypes.map(type => (
        <span
          key={type.label}
          className={cn(
            'flex h-[23px] w-[23px] items-center justify-center rounded-md text-[10px] font-black leading-none shadow-sm ring-1 ring-slate-200',
            type.className
          )}
        >
          {type.label}
        </span>
      ))}
    </span>
  );
}

function WorkspaceHoverPreview({ item }: { item: WorkspaceItem }) {
  const Icon = item.icon;
  const preview = workspacePreviewText(item);
  const previewImage = workspacePreviewImagePath(item);

  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-5 hidden w-[440px] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-[0_24px_70px_rgba(15,23,42,0.18)] ring-1 ring-slate-950/5 lg:block">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-950">
              <Icon className={cn('h-4 w-4', item.color)} />
            </span>
            <span className="text-[11px] font-black text-slate-900">{item.title}</span>
          </div>
          <WorkspacePreviewMeta item={item} meta={preview.meta} />
        </div>
        <div className="relative aspect-[16/9] overflow-hidden bg-slate-100">
          <img
            src={previewImage}
            alt={`${preview.title} 화면 미리보기`}
            className="h-full w-full object-contain object-top"
            draggable={false}
          />
          <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-slate-950/5" />
        </div>
      </div>
      <div className="mt-3 px-1">
        <p className="text-sm font-black leading-5 text-slate-950">{preview.title}</p>
        <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{preview.desc}</p>
      </div>
    </div>
  );
}

const MERGE_EXTENSIONS = ['pdf', 'ai', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'];
const IMAGE_MERGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'];
const DEFAULT_SPLIT_NAME_RULE = '{name}_page_{page0}';

function extensionOfName(name: string) {
  return name.split('.').pop()?.toLowerCase() || '';
}

function baseNameOfFile(name: string) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function safeOutputBaseName(name: string, fallback: string) {
  const trimmed = name.trim();
  return (trimmed || fallback).replace(/[\\/:*?"<>|]/g, '_');
}

function splitEditablePdfName(item: DownloadItem) {
  return safeOutputBaseName(item.editableName ?? baseNameOfFile(item.fileName), baseNameOfFile(item.fileName));
}

function splitDownloadFileName(item: DownloadItem) {
  return `${splitEditablePdfName(item)}.pdf`;
}

function uniqueFileName(fileName: string, used: Map<string, number>) {
  const ext = extensionOfName(fileName);
  const base = ext ? fileName.slice(0, -(ext.length + 1)) : fileName;
  let candidate = fileName;
  let suffix = 2;

  while (used.has(candidate.toLowerCase())) {
    candidate = ext ? `${base}_${suffix}.${ext}` : `${fileName}_${suffix}`;
    suffix += 1;
  }

  used.set(candidate.toLowerCase(), 1);
  return candidate;
}

function padPageNumber(pageNumber: number, totalPages: number) {
  return String(pageNumber).padStart(Math.max(2, String(totalPages).length), '0');
}

function formatSplitRuleName(rule: string, baseName: string, pageNumber: number, totalPages: number) {
  const safeBaseName = safeOutputBaseName(baseName, '분리_문서');
  const page = String(pageNumber);
  const page0 = padPageNumber(pageNumber, totalPages);
  const total = String(totalPages);
  const rendered = (rule.trim() || DEFAULT_SPLIT_NAME_RULE)
    .replace(/\{name\}/g, safeBaseName)
    .replace(/\{page0\}/g, page0)
    .replace(/\{page\}/g, page)
    .replace(/\{total\}/g, total);

  return safeOutputBaseName(rendered, `${safeBaseName}_page_${page0}`);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function readImage(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.'));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function addImagePageToPdf(target: PDFDocument, file: File) {
  const img = await readImage(file);
  const width = img.naturalWidth || img.width || 1000;
  const height = img.naturalHeight || img.height || 1000;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이미지 변환 캔버스를 만들 수 없습니다.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const pngBytes = await new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob(async blob => {
      if (!blob) {
        reject(new Error('이미지를 PDF 페이지로 변환하지 못했습니다.'));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });

  const embedded = await target.embedPng(pngBytes);
  const page = target.addPage([width, height]);
  page.drawImage(embedded, { x: 0, y: 0, width, height });
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [imageInitialMode, setImageInitialMode] = useState<ImageToolMode>('resize');
  const [hoveredWorkspaceKey, setHoveredWorkspaceKey] = useState<string | null>(null);

  // ── Merge tab state ──
  const [mergeFiles, setMergeFiles] = useState<FileItem[]>([]);
  const [mergeDragging, setMergeDragging] = useState(false);
  const [mergeSortingId, setMergeSortingId] = useState<string | null>(null);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeOutputName, setMergeOutputName] = useState('');
  const [mergeError, setMergeError] = useState<string | null>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);

  // ── Split tab state ──
  const [splitFile, setSplitFile] = useState<File | null>(null);
  const [splitDragging, setSplitDragging] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitOutputName, setSplitOutputName] = useState('');
  const [splitError, setSplitError] = useState<string | null>(null);
  const [splitSuccess, setSplitSuccess] = useState<string | null>(null);
  const [splitDownloads, setSplitDownloads] = useState<DownloadItem[]>([]);
  const [splitNameRule, setSplitNameRule] = useState(DEFAULT_SPLIT_NAME_RULE);
  const splitInputRef = useRef<HTMLInputElement>(null);

  // ── Outline tab state ──
  const [outlineFile, setOutlineFile] = useState<File | null>(null);
  const [outlineDragging, setOutlineDragging] = useState(false);
  const [outlineName, setOutlineName] = useState('');
  const [isOutlining, setIsOutlining] = useState(false);
  const [outlineError, setOutlineError] = useState<string | null>(null);
  const [outlineSuccess, setOutlineSuccess] = useState<string | null>(null);
  const [outlineDownloads, setOutlineDownloads] = useState<DownloadItem[]>([]);
  const [outlineResultName, setOutlineResultName] = useState('');
  const outlineInputRef = useRef<HTMLInputElement>(null);

  // ── Compare tab state ──
  const [compareResults, setCompareResults] = useState<any[] | null>(null);
  const [compareExpanded, setCompareExpanded] = useState(false);

  // ── Merge handlers ──
  const addMergeFiles = (uploaded: FileList | null) => {
    if (!uploaded) return;
    const valid: FileItem[] = [];
    for (let i = 0; i < uploaded.length; i++) {
      const f = uploaded[i];
      const ext = extensionOfName(f.name);
      if (MERGE_EXTENSIONS.includes(ext)) {
        valid.push({ id: crypto.randomUUID(), file: f, name: f.name, size: f.size });
      }
    }
    if (valid.length === 0) {
      setMergeError('PDF, AI, 이미지, SVG 파일만 추가할 수 있습니다.');
      return;
    }
    setMergeFiles(prev => [...prev, ...valid]);
    setMergeError(null);
  };

  const handleMergeDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setMergeDragging(false);
    addMergeFiles(e.dataTransfer.files);
  };

  const moveMergeFile = (id: string, direction: -1 | 1) => {
    setMergeFiles(current => {
      const currentIndex = current.findIndex(item => item.id === id);
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= current.length) return current;

      const next = [...current];
      [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
      return next;
    });
  };

  const reorderMergeFile = (sourceId: string | null, targetId: string) => {
    if (!sourceId || sourceId === targetId) return;
    setMergeFiles(current => {
      const sourceIndex = current.findIndex(item => item.id === sourceId);
      const targetIndex = current.findIndex(item => item.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;

      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const runMerge = async () => {
    if (mergeFiles.length < 2) {
      setMergeError('파일을 2개 이상 추가해주세요.');
      return;
    }
    setIsMerging(true);
    setMergeError(null);
    try {
      const merged = await PDFDocument.create();
      for (const item of mergeFiles) {
        const ext = extensionOfName(item.name);
        if (IMAGE_MERGE_EXTENSIONS.includes(ext)) {
          await addImagePageToPdf(merged, item.file);
          continue;
        }
        const bytes = await item.file.arrayBuffer();
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await merged.copyPages(doc, doc.getPageIndices());
        pages.forEach(p => merged.addPage(p));
      }
      const outBytes = await merged.save();
      const name = `${mergeOutputName.trim() || '병합_문서'}.pdf`;
      if ('showSaveFilePicker' in window) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: name,
            types: [{ description: 'PDF 문서', accept: { 'application/pdf': ['.pdf'] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(outBytes);
          await writable.close();
          setIsMerging(false);
          return;
        } catch (err: any) {
          if (err.name === 'AbortError') { setIsMerging(false); return; }
        }
      }
      const blob = new Blob([outBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setMergeError(err.message || '병합 중 오류가 발생했습니다.');
    } finally {
      setIsMerging(false);
    }
  };

  // ── Split handlers ──
  const setSplitTarget = (f: File) => {
    const ext = extensionOfName(f.name);
    if (ext !== 'pdf') {
      setSplitError('PDF 파일만 분리할 수 있습니다.');
      return;
    }
    setSplitFile(f);
    setSplitOutputName(baseNameOfFile(f.name));
    setSplitError(null);
    setSplitSuccess(null);
    setSplitDownloads([]);
    setSplitNameRule(DEFAULT_SPLIT_NAME_RULE);
  };

  const handleSplitDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setSplitDragging(false);
    if (e.dataTransfer.files.length > 0) setSplitTarget(e.dataTransfer.files[0]);
  };

  const runSplit = async () => {
    if (!splitFile) {
      setSplitError('분리할 PDF 파일을 선택해주세요.');
      return;
    }
    setIsSplitting(true);
    setSplitError(null);
    setSplitSuccess(null);
    setSplitDownloads([]);

    try {
      const sourceBytes = await splitFile.arrayBuffer();
      const source = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
      const pageCount = source.getPageCount();
      if (pageCount < 1) throw new Error('PDF 페이지를 찾을 수 없습니다.');

      const baseName = safeOutputBaseName(splitOutputName || baseNameOfFile(splitFile.name), '분리_문서');
      const downloads: DownloadItem[] = [];

      for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        const singlePageDoc = await PDFDocument.create();
        const [page] = await singlePageDoc.copyPages(source, [pageIndex]);
        singlePageDoc.addPage(page);
        const outBytes = await singlePageDoc.save({ useObjectStreams: true });
        const pageNumber = pageIndex + 1;
        const editableName = formatSplitRuleName(splitNameRule, baseName, pageNumber, pageCount);
        downloads.push({
          id: crypto.randomUUID(),
          label: `${pageNumber}페이지`,
          fileName: `${editableName}.pdf`,
          blob: new Blob([outBytes], { type: 'application/pdf' }),
          note: `원본 PDF의 ${pageNumber}페이지를 단일 PDF로 저장합니다.`,
          emphasis: pageIndex === 0,
          editableName,
          pageNumber,
          totalPages: pageCount,
        });
      }

      setSplitDownloads(downloads);
      setSplitSuccess(`${pageCount}개 페이지를 각각의 PDF로 분리했습니다.`);
    } catch (err: any) {
      setSplitError(err.message || 'PDF 분리 중 오류가 발생했습니다.');
    } finally {
      setIsSplitting(false);
    }
  };

  // ── Outline handlers ──
  const setOutlineTarget = (f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (ext !== 'pdf' && ext !== 'ai') {
      setOutlineError('PDF 또는 AI 파일만 지원합니다.');
      return;
    }
    setOutlineFile(f);
    setOutlineName(f.name.substring(0, f.name.lastIndexOf('.')) || f.name);
    setOutlineError(null);
    setOutlineSuccess(null);
    setOutlineDownloads([]);
    setOutlineResultName('');
  };

  const handleOutlineDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOutlineDragging(false);
    if (e.dataTransfer.files.length > 0) setOutlineTarget(e.dataTransfer.files[0]);
  };

  const runOutlining = async () => {
    if (!outlineFile) return;
    const api = (window as any).electronAPI;
    setIsOutlining(true);
    setOutlineError(null);
    setOutlineSuccess(null);
    try {
      if (api) {
        // Desktop Electron environment
        const saveDir = await api.selectDirectory();
        if (!saveDir) { setIsOutlining(false); return; }

        let filePath = '';
        if (api.getPathForFile) filePath = api.getPathForFile(outlineFile);
        else filePath = (outlineFile as any).path;
        if (!filePath) throw new Error('파일 경로를 읽을 수 없습니다.');

        const result = await api.processOutline({
          filePath,
          saveDirectory: saveDir,
          baseName: outlineName.trim() || '출력문서',
        });

        if (result.success) {
          setOutlineDownloads([]);
          setOutlineSuccess(`로컬 저장 완료: ${saveDir}. 인쇄용 AI는 Illustrator 대지 인식을 돕기 위한 PDF 기반 호환 파일입니다.`);
          setOutlineFile(null);
          setOutlineName('');
        } else {
          setOutlineError(result.error || '변환 중 오류가 발생했습니다.');
        }
      } else {
        // Web Browser environment
        const API_URL = window.location.hostname === 'localhost'
          ? 'http://localhost:8080'
          : (window.location.hostname.includes('vercel.app')
              ? 'https://smart-pdf-ai-merger.onrender.com'
              : window.location.origin);

        const formData = new FormData();
        formData.append('file', outlineFile);

        const response = await fetch(`${API_URL}/process-outline`, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({ error: '서버 연결에 실패했습니다.' }));
          throw new Error(errData.error || '아웃라인 서버 처리 오류');
        }

        const result = await response.json();
        if (result.success) {
          const byteCharacters = atob(result.fileData);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const outlinedBlob = new Blob([byteArray], { type: 'application/pdf' });
          const originalBlob = outlineFile;
          const baseName = outlineName.trim() || result.originalName || '출력문서';

          const originalExt = extensionOfName(outlineFile.name);
          const downloads: DownloadItem[] = [
            {
              id: crypto.randomUUID(),
              label: '원본 파일',
              fileName: `(원본)${baseName}.${originalExt || 'pdf'}`,
              blob: originalBlob,
              note: '업로드한 원본 그대로 저장합니다.',
            },
            ...(originalExt !== 'pdf' ? [{
              id: crypto.randomUUID(),
              label: '원본 PDF',
              fileName: `(원본)${baseName}.pdf`,
              blob: originalBlob,
              note: 'Illustrator/PDF 호환 워크플로우용 원본 PDF 사본입니다.',
            }] : []),
            {
              id: crypto.randomUUID(),
              label: '인쇄용 PDF',
              fileName: `(인쇄용)${baseName}.pdf`,
              blob: outlinedBlob,
              note: '페이지 박스를 유지하고 폰트를 아웃라인 처리한 인쇄용 PDF입니다.',
              emphasis: true,
            },
            {
              id: crypto.randomUUID(),
              label: '인쇄용 AI 호환',
              fileName: `(인쇄용)${baseName}.ai`,
              blob: outlinedBlob,
              note: 'Illustrator가 대지로 인식하기 쉽도록 만든 PDF 기반 AI 호환 파일입니다.',
              emphasis: true,
            },
          ];

          setOutlineDownloads(downloads);
          setOutlineResultName(baseName);
          setOutlineSuccess(`변환이 완료되었습니다. 인쇄용 AI는 Illustrator 대지 인식을 돕기 위한 PDF 기반 호환 파일입니다.`);
          setOutlineFile(null);
          setOutlineName('');
        } else {
          setOutlineError(result.error || '변환 중 오류가 발생했습니다.');
        }
      }
    } catch (err: any) {
      setOutlineError(err.message || '처리 중 오류가 발생했습니다.');
    } finally {
      setIsOutlining(false);
    }
  };

  const navItems: { tab: AppTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { tab: 'home', label: '홈', icon: Home },
    { tab: 'merge', label: '병합', icon: Files },
    { tab: 'split', label: '분리', icon: FileOutput },
    { tab: 'outline', label: '출력', icon: Printer },
    { tab: 'compare', label: '비교', icon: Search },
    { tab: 'illustrator', label: '뷰어', icon: FileImage },
    { tab: 'images', label: '이미지', icon: Images },
  ];

  const downloadOutlineItem = (item: DownloadItem) => {
    downloadBlob(item.blob, item.fileName);
  };

  const downloadSplitItem = (item: DownloadItem) => {
    downloadBlob(item.blob, splitDownloadFileName(item));
  };

  const updateSplitDownloadName = (id: string, value: string) => {
    setSplitDownloads(items => items.map(item => (
      item.id === id ? { ...item, editableName: value.replace(/[\\/:*?"<>|]/g, '_') } : item
    )));
  };

  const applySplitNameRule = () => {
    if (splitDownloads.length === 0) return;
    const baseName = safeOutputBaseName(splitOutputName || (splitFile ? baseNameOfFile(splitFile.name) : ''), '분리_문서');
    setSplitDownloads(items => items.map((item, index) => {
      const totalPages = item.totalPages || items.length;
      const pageNumber = item.pageNumber || index + 1;
      const editableName = formatSplitRuleName(splitNameRule, baseName, pageNumber, totalPages);
      return {
        ...item,
        editableName,
        fileName: `${editableName}.pdf`,
        pageNumber,
        totalPages,
      };
    }));
  };

  const openWorkspaceItem = (item: WorkspaceItem) => {
    if (item.tab === 'images' && item.imageMode) {
      setImageInitialMode(item.imageMode);
    }
    setActiveTab(item.tab);
  };

  const downloadOutlineZip = async () => {
    if (outlineDownloads.length === 0) return;
    const zip = new JSZip();
    outlineDownloads.forEach(item => zip.file(item.fileName, item.blob));
    zip.file(
      'README.txt',
      '인쇄용 AI는 네이티브 AI가 아니라 Illustrator 대지 인식을 돕기 위한 PDF 기반 호환 파일입니다.\n파일별 Illustrator 해석 차이가 있을 수 있으니 최종 인쇄 전 (인쇄용).pdf와 함께 확인해주세요.\n'
    );
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, `${outlineResultName || '인쇄용_변환_결과'}.zip`);
  };

  const downloadSplitZip = async () => {
    if (splitDownloads.length === 0) return;
    const zip = new JSZip();
    const usedNames = new Map<string, number>();
    splitDownloads.forEach(item => {
      zip.file(uniqueFileName(splitDownloadFileName(item), usedNames), item.blob);
    });
    zip.file(
      'README.txt',
      `PDF 페이지 분리 결과입니다.\n원본 파일: ${splitFile?.name || 'unknown.pdf'}\n분리 페이지 수: ${splitDownloads.length}\n`
    );
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const baseName = safeOutputBaseName(splitOutputName || (splitFile ? baseNameOfFile(splitFile.name) : ''), '분리_문서');
    downloadBlob(zipBlob, `${baseName}_pages.zip`);
  };

  const splitRuleBaseName = safeOutputBaseName(splitOutputName || (splitFile ? baseNameOfFile(splitFile.name) : ''), '분리_문서');
  const splitRulePreview = `${formatSplitRuleName(
    splitNameRule,
    splitRuleBaseName,
    splitDownloads[0]?.pageNumber || 1,
    splitDownloads[0]?.totalPages || splitDownloads.length || 4
  )}.pdf`;

  return (
    <div className="min-h-screen bg-[#fbfcfd] text-slate-950 flex flex-col bg-[radial-gradient(circle_at_1px_1px,rgba(15,23,42,0.025)_1px,transparent_0)] [background-size:22px_22px]" style={{ fontFamily: "'Inter', 'Noto Sans KR', system-ui, sans-serif" }}>

      {/* ── Top bar ── */}
      {activeTab !== 'illustrator' && activeTab !== 'home' && (
      <header className="h-14 flex-shrink-0 border-b border-slate-200/80 bg-white/95 px-4 backdrop-blur">
        <div className="flex h-full items-center justify-between gap-4">
        <button onClick={() => setActiveTab('home')} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm" title="홈">
          <FilePlus2 className="h-4 w-4" />
        </button>
        <nav className="flex min-w-0 items-center justify-end gap-2 overflow-x-auto">
          {navItems.map(({ tab, label, icon: NavIcon }) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'group flex h-9 flex-shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-bold leading-none transition',
                activeTab === tab
                  ? 'bg-slate-100 text-slate-950'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
              )}
              title={label}
            >
              <NavIcon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        </div>
      </header>
      )}

      {/* ── Content ── */}
      <main className={cn(
        "flex-grow flex flex-col w-full min-h-0 min-w-0 transition-all duration-300",
        activeTab === 'home'
          ? "max-w-none p-0 bg-white h-screen"
          : activeTab === 'compare'
          ? (compareResults && compareResults.length > 0) || compareExpanded
            ? "max-w-none p-4 bg-[#fbfcfd]/80 h-[calc(100vh-56px)]"
            : "max-w-2xl mx-auto px-6 py-10 gap-5"
          : activeTab === 'illustrator'
            ? "max-w-none p-0 bg-[#fbfcfd] h-screen"
          : activeTab === 'images'
            ? "max-w-none p-0 bg-[#fbfcfd] h-[calc(100vh-56px)]"
            : "max-w-2xl mx-auto px-6 py-10 gap-5"
      )}>

        {/* ── HOME DASHBOARD ── */}
        <div style={{ display: activeTab === 'home' ? 'flex' : 'none' }} className="h-full w-full animate-fadeIn bg-[#fbfcfd] text-slate-950">
          <aside className="flex h-full w-[72px] flex-shrink-0 flex-col items-center border-r border-slate-200/80 bg-white px-2 py-4">
            <button
              onClick={() => setActiveTab('home')}
              className="mb-8 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm"
              title="PDF & AI 툴킷"
            >
              <FilePlus2 className="h-4 w-4" />
            </button>

            <div className="flex flex-1 flex-col items-center gap-3">
              {homeRailItems.map(item => {
                const Icon = item.icon;
                const active = item.tab === activeTab;
                return (
                  <button
                    key={item.label}
                    onClick={() => item.tab && setActiveTab(item.tab)}
                    className={cn(
                      'group flex w-full flex-col items-center gap-1 rounded-2xl px-1.5 py-2 text-[10px] font-bold transition',
                      active ? 'bg-slate-100 text-slate-950' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900',
                      item.muted && 'text-slate-400'
                    )}
                    title={item.label}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="leading-none">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col items-center gap-2">
              <button className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-50 hover:text-slate-700" title="설정">
                <Settings className="h-4 w-4" />
              </button>
              <button className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-50 hover:text-slate-700" title="더보기">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </div>
          </aside>

          <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(15,23,42,0.025)_1px,transparent_0)] [background-size:22px_22px]" />
            <div className="relative h-14 flex-shrink-0" aria-hidden="true" />

            <div className="relative flex flex-1 flex-col items-center justify-center px-6 py-8">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-[1220px] -translate-y-[6vh] lg:-translate-y-[9vh]"
              >
                <div className="mx-auto max-w-[820px] px-1 text-center">
                  <div className="flex flex-col items-center">
                    <div className="min-w-0">
                      <h1 className="text-[30px] font-extrabold tracking-tight text-slate-950 sm:text-[38px]">
                        디자인 통합 작업 허브 2.0
                      </h1>
                      <p className="mt-2 text-sm font-medium text-slate-500">
                        파일 정리, 변환, 검수, 이미지 작업을 한 곳에서 시작합니다.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mx-auto mt-14 flex w-fit max-w-full flex-wrap justify-center gap-y-5 rounded-[28px] border border-slate-200/80 bg-white/85 px-7 py-6 shadow-[0_24px_90px_rgba(15,23,42,0.10)] ring-1 ring-white/80 backdrop-blur md:px-8">
                  {workspaceGroups.map(group => (
                    <div key={group.label} className="relative w-fit min-w-0 px-5 py-2 after:hidden after:absolute after:bottom-2 after:right-0 after:top-2 after:w-px after:bg-slate-300/85 lg:py-1 lg:after:block first:lg:pl-0 last:lg:pr-0 last:after:hidden">
                      <p className="mb-4 text-center text-xs font-black text-slate-500">{group.label}</p>
                      <div className="flex flex-wrap justify-center gap-3">
                        {uniqueWorkspaceItems(group.items).map(item => {
                          const Icon = item.icon;
                          const itemKey = workspaceItemKey(item);
                          const previewVisible = hoveredWorkspaceKey === itemKey;
                          return (
                            <button
                              key={itemKey}
                              onClick={() => openWorkspaceItem(item)}
                              onMouseEnter={() => setHoveredWorkspaceKey(itemKey)}
                              onMouseLeave={() => setHoveredWorkspaceKey(current => current === itemKey ? null : current)}
                              onFocus={() => setHoveredWorkspaceKey(itemKey)}
                              onBlur={() => setHoveredWorkspaceKey(current => current === itemKey ? null : current)}
                              className="group relative flex w-[98px] flex-col items-center gap-2 rounded-2xl px-2 py-2.5 text-center transition hover:bg-slate-50/90 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                            >
                              {previewVisible && <WorkspaceHoverPreview item={item} />}
                              <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/90 bg-white shadow-[0_8px_22px_rgba(15,23,42,0.08)] transition group-hover:-translate-y-0.5 group-hover:border-slate-300 group-hover:shadow-[0_14px_34px_rgba(15,23,42,0.12)]">
                                <Icon className={cn('h-5 w-5', item.color)} />
                              </span>
                              <span className="text-xs font-black text-slate-950">{item.title}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          </section>
        </div>

        <div style={{ display: 'none' }} className="w-full animate-fadeIn">
          <section className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] border border-white/70 bg-white/70 p-6 shadow-sm sm:p-9">
            <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(15,23,42,.045)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,.045)_1px,transparent_1px)] [background-size:28px_28px]" />
            <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-amber-200/50 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-sky-200/50 blur-3xl" />

            <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.28em] text-gray-400">Print Studio Desk</p>
                <h1 className="mt-3 text-3xl font-black tracking-tight text-gray-950 sm:text-5xl">필요한 인쇄 도구를 바로 시작하세요</h1>
                <p className="mt-4 max-w-2xl text-sm font-medium leading-6 text-gray-500">
                  병합, 인쇄용 변환, 수정 검수, 파일 확인을 한 화면에서 고르고 작업 흐름을 이어갑니다.
                </p>
              </div>
              <div className="rounded-2xl border border-gray-200/80 bg-white/80 px-4 py-3 text-xs font-bold text-gray-500 shadow-sm">
                최근 작업 기록은 다음 버전에서 추가하고, 이번 화면은 빠른 진입에 집중했습니다.
              </div>
            </div>

            <div className="relative mt-8 grid gap-4 md:grid-cols-2">
              {featureCards.map((card, index) => {
                const Icon = card.icon;
                return (
                  <motion.button
                    key={card.tab}
                    type="button"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.04 }}
                    onClick={() => setActiveTab(card.tab)}
                    className="group relative overflow-hidden rounded-3xl border border-gray-200/80 bg-white/90 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-xl"
                  >
                    <div className={cn('absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r', card.accent)} />
                    <div className="flex items-start justify-between gap-4">
                      <div className={cn('rounded-2xl bg-gradient-to-br p-3 text-white shadow-sm', card.accent)}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <span className="rounded-full bg-gray-100 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-gray-500">{card.eyebrow}</span>
                    </div>
                    <h2 className="mt-5 text-xl font-black tracking-tight text-gray-950">{card.title}</h2>
                    <p className="mt-2 min-h-12 text-sm font-medium leading-6 text-gray-500">{card.description}</p>
                    <div className="mt-5 grid gap-2 rounded-2xl border border-gray-100 bg-gray-50/70 p-3 text-xs font-bold text-gray-500">
                      <div className="flex justify-between gap-3">
                        <span className="text-gray-400">지원 포맷</span>
                        <span className="text-gray-800">{card.formats}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-gray-400">사용 목적</span>
                        <span className="text-right text-gray-800">{card.purpose}</span>
                      </div>
                    </div>
                    <div className="mt-5 flex items-center justify-between">
                      <span className="text-sm font-black text-gray-900">{card.cta}</span>
                      <span className="rounded-full bg-gray-900 p-2 text-white transition group-hover:translate-x-1">
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </section>
        </div>

        {/* ════ TAB 1: MERGE ════ */}
        <div style={{ display: activeTab === 'merge' ? 'flex' : 'none' }} className="flex-col gap-5 w-full flex animate-fadeIn">
          <div>
            <h2 className="text-lg font-black tracking-tight text-slate-950">PDF 병합</h2>
            <p className="mt-1 text-xs font-semibold text-slate-400">PDF와 AI 파일을 순서대로 하나의 PDF로 합칩니다.</p>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setMergeDragging(true); }}
            onDragLeave={() => setMergeDragging(false)}
            onDrop={handleMergeDrop}
            onClick={() => mergeInputRef.current?.click()}
            className={cn(
              'border rounded-2xl bg-white/85 flex flex-col items-center justify-center gap-2 py-10 cursor-pointer transition-all select-none shadow-sm',
              mergeDragging
                ? 'border-slate-400 bg-slate-50'
                : 'border-dashed border-slate-200 hover:border-slate-300 hover:bg-white'
            )}
          >
            <Upload className="w-5 h-5 text-gray-300" />
            <p className="text-sm text-gray-400">파일을 드래그하거나 클릭하여 추가</p>
            <p className="text-xs text-gray-300">.pdf · .ai · .png · .jpg · .webp · .gif · .bmp · .svg</p>
            <input
              ref={mergeInputRef}
              type="file"
              multiple
              accept=".pdf,.ai,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,image/*"
              className="hidden"
              onChange={e => addMergeFiles(e.target.files)}
            />
          </div>

          {/* Error */}
          <AnimatePresence>
            {mergeError && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex items-center gap-2 text-sm text-red-500 bg-red-50 border border-red-100 px-4 py-2.5 rounded-lg">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1">{mergeError}</span>
                <button onClick={() => setMergeError(null)}><X className="w-4 h-4" /></button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* File list */}
          {mergeFiles.length > 0 && (
            <div className="border border-slate-200 rounded-2xl overflow-hidden animate-fadeIn bg-white/90 shadow-sm">
              <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/70">
                <span className="text-xs text-gray-400 font-medium">{mergeFiles.length}개 파일</span>
                <button onClick={() => setMergeFiles([])} className="text-xs text-gray-400 hover:text-red-500 transition-colors">전체 제거</button>
              </div>
              <ul className="divide-y divide-gray-50">
                {mergeFiles.map((f, idx) => {
                  const ext = extensionOfName(f.name);
                  const isAi = ext === 'ai';
                  const isPdf = ext === 'pdf';
                  return (
                    <motion.li
                      key={f.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      draggable
                      onDragStart={event => {
                        setMergeSortingId(f.id);
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', f.id);
                      }}
                      onDragOver={event => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={event => {
                        event.preventDefault();
                        reorderMergeFile(mergeSortingId || event.dataTransfer.getData('text/plain'), f.id);
                        setMergeSortingId(null);
                      }}
                      onDragEnd={() => setMergeSortingId(null)}
                      className={cn(
                        'flex items-center px-4 py-3 gap-3 group transition-colors',
                        mergeSortingId === f.id ? 'bg-slate-100/80 opacity-70' : 'hover:bg-slate-50/70'
                      )}
                    >
                      <span className="text-xs text-gray-300 w-5 text-right flex-shrink-0">{idx + 1}</span>
                      <span className={cn(
                        'text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0',
                        isAi ? 'bg-orange-50 text-orange-500' : isPdf ? 'bg-blue-50 text-blue-500' : 'bg-emerald-50 text-emerald-600'
                      )}>{isAi ? 'AI' : isPdf ? 'PDF' : ext.toUpperCase()}</span>
                      <span className="flex-1 text-sm text-gray-700 truncate">{f.name}</span>
                      <span className="text-xs text-gray-300 font-mono flex-shrink-0">{formatSize(f.size)}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveMergeFile(f.id, -1)}
                          disabled={idx === 0}
                          className={cn(
                            'rounded-md border border-slate-200 p-1.5 transition',
                            idx === 0
                              ? 'cursor-not-allowed text-slate-200'
                              : 'text-slate-400 hover:bg-white hover:text-slate-900'
                          )}
                          aria-label={`${f.name} 위로 이동`}
                          title="위로 이동"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveMergeFile(f.id, 1)}
                          disabled={idx === mergeFiles.length - 1}
                          className={cn(
                            'rounded-md border border-slate-200 p-1.5 transition',
                            idx === mergeFiles.length - 1
                              ? 'cursor-not-allowed text-slate-200'
                              : 'text-slate-400 hover:bg-white hover:text-slate-900'
                          )}
                          aria-label={`${f.name} 아래로 이동`}
                          title="아래로 이동"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <button onClick={() => setMergeFiles(p => p.filter(x => x.id !== f.id))}
                        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </motion.li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Output name + merge button */}
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <input
                type="text"
                value={mergeOutputName}
                onChange={e => setMergeOutputName(e.target.value)}
                placeholder="출력 파일 이름"
                className="w-full text-sm px-4 py-2.5 border border-slate-200 bg-white/90 rounded-xl focus:outline-none focus:border-slate-400 transition-colors pr-12 placeholder:text-slate-300 shadow-sm"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-gray-300 font-mono">.pdf</span>
            </div>
            <button
              onClick={runMerge}
              disabled={isMerging || mergeFiles.length < 2}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex-shrink-0',
                isMerging || mergeFiles.length < 2
                  ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                  : 'bg-slate-950 text-white hover:bg-slate-800 active:scale-[0.98]'
              )}
            >
              {isMerging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {isMerging ? '병합 중…' : '병합'}
            </button>
          </div>
        </div>

        {/* ════ TAB 2: SPLIT ════ */}
        <div style={{ display: activeTab === 'split' ? 'flex' : 'none' }} className="flex-col gap-5 w-full flex animate-fadeIn">
          <div>
            <h2 className="text-lg font-black tracking-tight text-slate-950">PDF 분리</h2>
            <p className="mt-1 text-xs font-semibold text-slate-400">여러 페이지 PDF를 페이지별 단일 PDF로 나눕니다.</p>
          </div>

          {!splitFile && (
            <div
              onDragOver={e => { e.preventDefault(); setSplitDragging(true); }}
              onDragLeave={() => setSplitDragging(false)}
              onDrop={handleSplitDrop}
              onClick={() => splitInputRef.current?.click()}
              className={cn(
                'border rounded-2xl bg-white/85 flex flex-col items-center justify-center gap-2 py-10 cursor-pointer transition-all select-none shadow-sm',
                splitDragging
                  ? 'border-slate-400 bg-slate-50'
                  : 'border-dashed border-slate-200 hover:border-slate-300 hover:bg-white'
              )}
            >
              <Upload className="w-5 h-5 text-gray-300" />
              <p className="text-sm text-gray-400">PDF 파일을 드래그하거나 클릭하여 선택</p>
              <p className="text-xs text-gray-300">.pdf</p>
              <input
                ref={splitInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={e => { if (e.target.files?.[0]) setSplitTarget(e.target.files[0]); }}
              />
            </div>
          )}

          {splitFile && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              className="border border-slate-200 rounded-2xl bg-white/90 p-4 flex items-center gap-3 animate-fadeIn shadow-sm">
              <div className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 bg-blue-50 text-blue-500">
                PDF
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{splitFile.name}</p>
                <p className="text-xs text-gray-400 font-mono">{formatSize(splitFile.size)}</p>
              </div>
              <button
                onClick={() => {
                  setSplitFile(null);
                  setSplitOutputName('');
                  setSplitSuccess(null);
                  setSplitError(null);
                  setSplitDownloads([]);
                  if (splitInputRef.current) splitInputRef.current.value = '';
                }}
                className="text-gray-300 hover:text-red-400 transition-colors"
                title="파일 제거"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          <AnimatePresence>
            {splitError && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex items-center gap-2 text-sm text-red-500 bg-red-50 border border-red-100 px-4 py-2.5 rounded-lg">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1">{splitError}</span>
                <button onClick={() => setSplitError(null)}><X className="w-4 h-4" /></button>
              </motion.div>
            )}
          </AnimatePresence>

          {splitFile && (
            <div className="flex gap-2 items-center">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={splitOutputName}
                  onChange={e => setSplitOutputName(e.target.value)}
                  placeholder="분리 파일 기본 이름"
                  className="w-full text-sm px-4 py-2.5 border border-slate-200 bg-white/90 rounded-xl focus:outline-none focus:border-slate-400 transition-colors pr-32 placeholder:text-slate-300 shadow-sm"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-gray-300 font-mono">_page_01.pdf</span>
              </div>
              <button
                onClick={runSplit}
                disabled={isSplitting}
                className={cn(
                  'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex-shrink-0',
                  isSplitting
                    ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                    : 'bg-slate-950 text-white hover:bg-slate-800 active:scale-[0.98]'
                )}
              >
                {isSplitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileOutput className="w-4 h-4" />}
                {isSplitting ? '분리 중…' : '분리 실행'}
              </button>
            </div>
          )}

          <AnimatePresence>
            {splitSuccess && (
              <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                className="border border-slate-200 rounded-2xl overflow-hidden bg-white/90 shadow-sm">
                <div className="bg-slate-50/70 px-5 py-4 flex flex-wrap items-center gap-3 border-b border-slate-100">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-semibold text-gray-800">분리 완료</span>
                    <p className="mt-1 text-xs text-gray-400">{splitSuccess}</p>
                  </div>
                  <button
                    onClick={() => void downloadSplitZip()}
                    className="flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800"
                  >
                    <Download className="h-3.5 w-3.5" />
                    전체 ZIP 다운로드
                  </button>
                </div>
                <div className="border-b border-slate-100 bg-white px-5 py-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[260px] flex-1">
                      <label className="text-[11px] font-black text-slate-500">파일명 일괄 규칙</label>
                      <div className="mt-2 flex items-center rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 focus-within:border-slate-400 focus-within:bg-white">
                        <input
                          value={splitNameRule}
                          onChange={e => setSplitNameRule(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') applySplitNameRule();
                          }}
                          className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-slate-900 outline-none"
                          placeholder={DEFAULT_SPLIT_NAME_RULE}
                        />
                        <span className="ml-2 flex-shrink-0 text-xs font-semibold text-slate-300">.pdf</span>
                      </div>
                    </div>
                    <button
                      onClick={applySplitNameRule}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                    >
                      전체 적용
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-400">
                    <span>예: <span className="font-mono text-slate-600">{splitRulePreview}</span></span>
                    <span className="font-mono">{'{name}'}</span>
                    <span className="font-mono">{'{page}'}</span>
                    <span className="font-mono">{'{page0}'}</span>
                    <span className="font-mono">{'{total}'}</span>
                  </div>
                </div>
                <div className="max-h-[320px] overflow-y-auto px-5 py-4 space-y-3">
                  {splitDownloads.map(item => (
                    <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 bg-white px-3 py-3">
                      <ChevronRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center rounded-lg border border-transparent bg-slate-50/70 px-2 py-1.5 transition focus-within:border-slate-200 focus-within:bg-white focus-within:shadow-sm">
                          <input
                            aria-label={`${item.label} 파일명`}
                            value={item.editableName ?? baseNameOfFile(item.fileName)}
                            onChange={e => updateSplitDownloadName(item.id, e.target.value)}
                            onBlur={() => updateSplitDownloadName(item.id, splitEditablePdfName(item))}
                            onKeyDown={e => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                              if (e.key === 'Escape') {
                                updateSplitDownloadName(item.id, baseNameOfFile(item.fileName));
                                e.currentTarget.blur();
                              }
                            }}
                            className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-gray-900 outline-none"
                          />
                          <span className="ml-1 flex-shrink-0 text-xs font-semibold text-gray-300">.pdf</span>
                        </div>
                        <p className="mt-1 text-[11px] text-gray-400">{item.note}</p>
                      </div>
                      <span className="rounded bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-500">{item.label}</span>
                      <button
                        onClick={() => downloadSplitItem(item)}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
                      >
                        다운로드
                      </button>
                    </div>
                  ))}
                </div>
                <div className="px-5 py-3 border-t border-gray-50 flex justify-end">
                  <button
                    onClick={() => { setSplitSuccess(null); setSplitDownloads([]); }}
                    className="text-xs text-gray-400 hover:text-gray-700 transition-colors font-medium"
                  >
                    닫기
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {!splitSuccess && (
            <div className="text-xs text-gray-400 leading-relaxed border-l-2 border-gray-100 pl-4">
              <strong className="text-gray-500 font-medium">생성되는 파일</strong>
              <div className="mt-1.5 space-y-0.5 font-mono">
                <div>[이름]_page_01.pdf · [이름]_page_02.pdf · ...</div>
                <div>전체 결과는 ZIP 파일로 한 번에 내려받을 수 있습니다.</div>
              </div>
            </div>
          )}
        </div>

        {/* ════ TAB 3: OUTLINE ════ */}
        <div style={{ display: activeTab === 'outline' ? 'flex' : 'none' }} className="flex-col gap-5 w-full flex animate-fadeIn">
          <div>
            <h2 className="text-lg font-black tracking-tight text-slate-950">인쇄용 변환</h2>
            <p className="mt-1 text-xs font-semibold text-slate-400">글씨를 아웃라인화하여 4종 파일로 자동 패키징합니다.</p>
          </div>

          {/* Drop zone */}
          {!outlineFile && (
            <div
              onDragOver={e => { e.preventDefault(); setOutlineDragging(true); }}
              onDragLeave={() => setOutlineDragging(false)}
              onDrop={handleOutlineDrop}
              onClick={() => outlineInputRef.current?.click()}
              className={cn(
                'border rounded-2xl bg-white/85 flex flex-col items-center justify-center gap-2 py-10 cursor-pointer transition-all select-none shadow-sm',
                outlineDragging
                  ? 'border-slate-400 bg-slate-50'
                  : 'border-dashed border-slate-200 hover:border-slate-300 hover:bg-white'
              )}
            >
              <Upload className="w-5 h-5 text-gray-300" />
              <p className="text-sm text-gray-400">AI 또는 PDF 파일을 드래그하거나 클릭하여 선택</p>
              <p className="text-xs text-gray-300">.ai · .pdf</p>
              <input
                ref={outlineInputRef}
                type="file"
                accept=".pdf,.ai"
                className="hidden"
                onChange={e => { if (e.target.files?.[0]) setOutlineTarget(e.target.files[0]); }}
              />
            </div>
          )}

          {/* Selected file card */}
          {outlineFile && !outlineSuccess && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              className="border border-slate-200 rounded-2xl bg-white/90 p-4 flex items-center gap-3 animate-fadeIn shadow-sm">
              <div className={cn(
                'text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0',
                outlineFile.name.toLowerCase().endsWith('.ai') ? 'bg-orange-50 text-orange-500' : 'bg-blue-50 text-blue-500'
              )}>
                {outlineFile.name.split('.').pop()?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{outlineFile.name}</p>
                <p className="text-xs text-gray-400 font-mono">{formatSize(outlineFile.size)}</p>
              </div>
              <button onClick={() => { setOutlineFile(null); setOutlineName(''); }}
                className="text-gray-300 hover:text-red-400 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {/* Error */}
          <AnimatePresence>
            {outlineError && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex items-center gap-2 text-sm text-red-500 bg-red-50 border border-red-100 px-4 py-2.5 rounded-lg">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1">{outlineError}</span>
                <button onClick={() => setOutlineError(null)}><X className="w-4 h-4" /></button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Success card */}
          <AnimatePresence>
            {outlineSuccess && (
              <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="bg-gray-50/50 px-5 py-4 flex flex-wrap items-center gap-3 border-b border-gray-100">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-semibold text-gray-800">변환 완료</span>
                    <p className="mt-1 text-xs text-gray-400">{outlineSuccess}</p>
                  </div>
                  {outlineDownloads.length > 0 && (
                    <button
                      onClick={() => void downloadOutlineZip()}
                      className="flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800"
                    >
                      <Download className="h-3.5 w-3.5" />
                      전체 ZIP 다운로드
                    </button>
                  )}
                </div>
                <div className="px-5 py-4 space-y-3">
                  {outlineDownloads.length > 0 ? outlineDownloads.map(item => (
                    <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 bg-white px-3 py-3">
                      <ChevronRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className={cn('truncate text-xs font-semibold', item.emphasis ? 'text-gray-900' : 'text-gray-600')}>
                          {item.fileName}
                        </p>
                        <p className="mt-1 text-[11px] text-gray-400">{item.note}</p>
                      </div>
                      {item.emphasis && (
                        <span className="rounded bg-orange-50 px-2 py-1 text-[10px] font-semibold text-orange-500">아웃라인</span>
                      )}
                      <button
                        onClick={() => downloadOutlineItem(item)}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
                      >
                        다운로드
                      </button>
                    </div>
                  )) : (
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span className="font-mono truncate">{outlineSuccess}</span>
                    </div>
                  )}
                  <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
                    인쇄용 AI는 Illustrator에서 대지 인식이 잘 되도록 페이지 박스를 유지한 PDF 기반 호환 파일입니다. 파일별 Illustrator 해석 차이가 있을 수 있으니 인쇄용 PDF와 함께 확인해주세요.
                  </div>
                </div>
                <div className="px-5 py-3 border-t border-gray-50 flex justify-end">
                  <button onClick={() => { setOutlineSuccess(null); setOutlineDownloads([]); }}
                    className="text-xs text-gray-400 hover:text-gray-700 transition-colors font-medium">
                    닫기
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Filename + run button */}
          {outlineFile && !outlineSuccess && (
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={outlineName}
                onChange={e => setOutlineName(e.target.value)}
                placeholder="출력 파일 이름"
                 className="flex-1 text-sm px-4 py-2.5 border border-slate-200 bg-white/90 rounded-xl focus:outline-none focus:border-slate-400 transition-colors placeholder:text-slate-300 shadow-sm"
              />
              <button
                onClick={runOutlining}
                disabled={isOutlining}
                className={cn(
                  'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex-shrink-0',
                  isOutlining
                    ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                    : 'bg-slate-950 text-white hover:bg-slate-800 active:scale-[0.98]'
                )}
              >
                {isOutlining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {isOutlining ? '변환 중…' : '4종 추출'}
              </button>
            </div>
          )}

          {/* Info box */}
          {!outlineSuccess && (
            <div className="text-xs text-gray-400 leading-relaxed border-l-2 border-gray-100 pl-4">
              <strong className="text-gray-500 font-medium">생성되는 파일</strong>
              <div className="mt-1.5 space-y-0.5 font-mono">
                <div>(원본)[이름].ai &nbsp;·&nbsp; (원본)[이름].pdf</div>
                <div>(인쇄용)[이름].ai &nbsp;·&nbsp; (인쇄용)[이름].pdf</div>
              </div>
            </div>
          )}
        </div>

        {/* ════ TAB 3: COMPARE ════ */}
        {/* TAB 4: ILLUSTRATOR VIEWER */}
        <div
          style={{ display: activeTab === 'illustrator' ? 'flex' : 'none' }}
          className="w-full flex-1 min-h-0 min-w-0 animate-fadeIn"
        >
          <IllustratorViewerTab onGoHome={() => setActiveTab('home')} />
        </div>

        <div
          style={{ display: activeTab === 'images' ? 'flex' : 'none' }}
          className="w-full flex-1 min-h-0 min-w-0 animate-fadeIn"
        >
          <ImageToolkitTab initialMode={imageInitialMode} />
        </div>

        <div 
          style={{ display: activeTab === 'compare' ? 'flex' : 'none' }} 
          className="w-full flex-1 min-h-0 min-w-0 animate-fadeIn"
        >
          <CompareTab results={compareResults} setRes={setCompareResults} onExpandChange={setCompareExpanded} />
        </div>
      </main>
    </div>
  );
}
