import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Upload, FileText, Loader2, AlertCircle, X, ZoomIn, ZoomOut,
  ChevronLeft, ChevronRight, Hash, Type, LayoutTemplate, Box,
  MoveVertical, ImageIcon, CheckCircle2, Lock, Unlock,
  Layers, Columns, Split, CheckSquare, Square, Info, Sparkles, Filter, RotateCcw, ArrowRight
} from 'lucide-react';
import { cn } from '../../lib/utils';

// ─── Types ─────────────────────────────────────────────────────────────────────
type Diff = {
  type: string;
  severity: string;
  desc?: string;
  before?: string;
  bbox: { x: number; y: number; width: number; height: number };
  textInfo?: {
    beforeStr: string;
    afterStr: string;
    diffs: Array<[number, string]>; // diff-match-patch format: [-1: del, 0: keep, 1: ins]
  };
};

type PageResult = {
  page: number;
  diffs: Diff[];
  base64A: string;
  base64B: string;
};

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
function DiffBox({ diff, scale, active, onHover, checked }: {
  diff: Diff; scale: number; active: boolean; onHover: (v: boolean) => void; checked: boolean;
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
        <div 
          className="absolute -top-[5px] -right-[5px] w-2.5 h-2.5 rounded-full border border-white shadow-sm"
          style={{ backgroundColor: m.ring }} 
        />
      )}

      {active && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-50 bg-gray-950/95 backdrop-blur-md border border-gray-800 text-white rounded-xl shadow-2xl p-3 w-80 flex flex-col gap-2 pointer-events-none select-none animate-in fade-in slide-in-from-bottom-2 duration-150">
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

// ─── Single PDF Viewer Pane ───────────────────────────────────────────────────
function PdfPane({ base64, diffs, label, activeDiff, checkedItems, onScroll, innerRef, zoom = 100 }: {
  base64: string; diffs: Diff[]; label: string; activeDiff: number | null;
  checkedItems: Record<string, boolean>; onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
  innerRef?: React.RefObject<HTMLDivElement | null>;
  zoom?: number;
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
  
  return (
    <div className="flex flex-col flex-1 min-w-0 h-full border border-gray-200 bg-white rounded-2xl overflow-hidden shadow-sm">
      <div className="text-[10px] font-black text-gray-500 uppercase tracking-wider px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex justify-between items-center select-none">
        <span>{label}</span>
        <span className="text-[9px] bg-gray-200/60 text-gray-700 px-2.5 py-0.5 rounded font-mono font-semibold">PNG Rendered</span>
      </div>
      <div 
        ref={innerRef}
        onScroll={onScroll}
        className="relative overflow-auto bg-gray-100 flex-1 scrollbar-thin"
      >
        <div className="relative h-auto mx-auto" style={{ width: `${zoom}%` }}>
          <img
            ref={imgRef}
            src={`data:image/png;base64,${base64}`}
            alt={label}
            className="w-full h-auto block select-none"
            onLoad={recalc}
            draggable={false}
          />
          {diffs.map((d, i) => (
            <DiffBox
              key={i}
              diff={d}
              scale={scale}
              active={hover === i || activeDiff === i}
              onHover={(v) => setHover(v ? i : null)}
              checked={!!checkedItems[i]}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main CompareTab ──────────────────────────────────────────────────────────
export function CompareTab({
  results,
  setRes,
}: {
  results: PageResult[] | null;
  setRes: React.Dispatch<React.SetStateAction<PageResult[] | null>>;
}) {
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [comparing, setCmp] = useState(false);
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
  const [mode, setMode] = useState<'default' | 'layout' | 'ultra'>('default');

  const refA = useRef<HTMLInputElement>(null);
  const refB = useRef<HTMLInputElement>(null);

  const scrollRefA = useRef<HTMLDivElement>(null);
  const scrollRefB = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);

  // Sync scroll
  const handleScrollA = () => {
    if (!scrollLock || !scrollRefA.current || !scrollRefB.current) return;
    if (isSyncing.current) {
      isSyncing.current = false;
      return;
    }
    isSyncing.current = true;
    const ratio = scrollRefA.current.scrollTop / (scrollRefA.current.scrollHeight - scrollRefA.current.clientHeight);
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
    const ratio = scrollRefB.current.scrollTop / (scrollRefB.current.scrollHeight - scrollRefB.current.clientHeight);
    const scrollATop = ratio * (scrollRefA.current.scrollHeight - scrollRefA.current.clientHeight);
    scrollRefA.current.scrollTop = scrollATop;
  };

  // Get currently active page result
  const currentResult = useMemo(() => {
    if (!results || results.length === 0) return null;
    return results[currentPageIdx] || results[0];
  }, [results, currentPageIdx]);

  // Filter diffs based on severity checkboxes
  const filteredDiffs = useMemo(() => {
    if (!currentResult) return [];
    return currentResult.diffs.filter(d => 
      (d.severity === 'critical' && showCritical) ||
      (d.severity === 'high'     && showHigh)     ||
      (d.severity === 'medium'   && showMedium)   ||
      (d.severity === 'low'      && showLow)
    );
  }, [currentResult, showCritical, showHigh, showMedium, showLow]);

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

  // Unique key per page to avoid leakage when paging
  const getCheckedKey = (diffIdx: number) => {
    if (!currentResult) return '';
    return `${currentResult.page}_${diffIdx}`;
  };

  const toggleChecked = (idx: number) => {
    const key = getCheckedKey(idx);
    if (!key) return;
    setCheckedItems(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const resetChecked = () => {
    setCheckedItems({});
  };

  const completionRate = useMemo(() => {
    const total = filteredDiffs.length;
    if (total === 0) return 100;
    let checkedCount = 0;
    filteredDiffs.forEach((_, i) => {
      const key = getCheckedKey(i);
      if (checkedItems[key]) checkedCount++;
    });
    return Math.round((checkedCount / total) * 100);
  }, [checkedItems, filteredDiffs, currentResult]);

  const runCompare = async () => {
    const api = (window as any).electronAPI;
    if (!api) {
      // Browser environment mockup fallback for debugging and responsive review
      setCmp(true);
      setError(null);
      setRes(null);
      setCurrentPageIdx(0);
      setCheckedItems({});
      await new Promise(r => setTimeout(r, 1200)); // realistic loading effect
      
      const base64Pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      setRes([
        {
          page: 1,
          base64A: base64Pixel,
          base64B: base64Pixel,
          diffs: [
            {
              type: "number_changed",
              severity: "critical",
              desc: "금액/수량 정보 불일치: 12,000원 -> 15,000원",
              bbox: { x: 50, y: 80, width: 120, height: 25 },
              textInfo: {
                beforeStr: "12,000원",
                afterStr: "15,000원",
                diffs: [
                  [0, "단가: "],
                  [-1, "12,000"],
                  [1, "15,000"],
                  [0, "원"]
                ]
              }
            },
            {
              type: "text_modified",
              severity: "high",
              desc: "계약서 조항 문구 수정",
              bbox: { x: 50, y: 150, width: 450, height: 40 },
              textInfo: {
                beforeStr: "본 계약은 체결일로부터 1년간 효력을 가진다.",
                afterStr: "본 계약은 체결일로부터 3년간 효력을 가진다.",
                diffs: [
                  [0, "본 계약은 체결일로부터 "],
                  [-1, "1년간"],
                  [1, "3년간"],
                  [0, " 효력을 가진다."]
                ]
              }
            }
          ]
        },
        {
          page: 2,
          base64A: base64Pixel,
          base64B: base64Pixel,
          diffs: [
            {
              type: "layout_changed",
              severity: "medium",
              desc: "도형 배치 및 레이아웃 오차 감지",
              bbox: { x: 80, y: 120, width: 300, height: 60 }
            }
          ]
        }
      ]);
      setCmp(false);
      return;
    }

    if (!fileA || !fileB) { setError('원본과 수정본 PDF를 모두 선택해주세요.'); return; }
    setCmp(true); setError(null); setRes(null); setCurrentPageIdx(0); setCheckedItems({});
    try {
      const pathA = api.getPathForFile ? api.getPathForFile(fileA) : (fileA as any).path;
      const pathB = api.getPathForFile ? api.getPathForFile(fileB) : (fileB as any).path;
      const resp = await api.comparePdfs({ fileA: pathA, fileB: pathB, sensitivity: mode });
      if (resp.success) {
        setRes(resp.results);
      } else {
        setError(resp.error || '비교 중 오류가 발생했습니다.');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCmp(false);
    }
  };

  const resetAll = () => {
    setFileA(null);
    setFileB(null);
    setRes(null);
    setError(null);
    setCmp(false);
    setCheckedItems({});
    setCurrentPageIdx(0);
    setActiveDiff(null);
  };

  const DropZone = ({ file, setFile, inputRef, label, accent }: any) => (
    <div
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'border-2 rounded-2xl flex flex-col items-center justify-center gap-3 py-14 cursor-pointer transition-all select-none hover:shadow-md active:scale-[0.99]',
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

  return (
    <AnimatePresence mode="wait">
      {!results ? (
        // ─── Case 1: Upload Files State ──────────────────────────────────────────
        <motion.div 
          key="upload-view"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="flex flex-col gap-6"
          style={{ fontFamily: "'Inter', 'Noto Sans KR', system-ui, sans-serif" }}
        >
          {/* Header */}
          <div>
            <h2 className="text-xl font-black tracking-tight text-gray-900">PDF 정밀 대조 검수</h2>
            <p className="text-sm text-gray-500 mt-1">
              원본(Before)과 수정본(After) PDF 문서를 대조하여 문장 내용, 단가 변동, 도형 미세 오차를 <span className="font-bold text-gray-800 text-xs bg-gray-100 px-1.5 py-0.5 rounded">OCR &amp; Native 하이브리드 파이프라인</span>으로 검출합니다.
            </p>
          </div>

          {/* Two dropzones side-by-side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DropZone file={fileA} setFile={setFileA} inputRef={refA} label="원본 (Before)" accent="text-blue-600" />
            <DropZone file={fileB} setFile={setFileB} inputRef={refB} label="수정본 (After)" accent="text-orange-600" />
          </div>

          {/* Sleek Mode selector */}
          <div className="flex flex-col gap-2.5 select-none bg-white p-4 border border-gray-200 rounded-2xl shadow-sm">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1">
              <Filter className="w-3 h-3 text-gray-400" />
              검수 정밀도 필터 모드
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-gray-50 border border-gray-150 rounded-xl p-1.5">
              {([
                ['default', '실무 검수 (Default)', '아웃라인 변환 오차 자동 소거'],
                ['layout', '구조 검수 (Layout)', '텍스트 외에 레이아웃/도형 정밀 감지'],
                ['ultra', '초정밀 검수 (Ultra)', '미세 자간 및 미세 픽셀 변동까지'],
              ] as const).map(([v, label, desc]) => (
                <button
                  key={v}
                  onClick={() => setMode(v)}
                  className={cn(
                    'flex flex-col items-center justify-center py-3 px-4 rounded-lg text-xs transition-all cursor-pointer border',
                    mode === v
                      ? 'bg-gray-900 text-white font-semibold shadow-md border-gray-900 scale-[1.02]'
                      : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100 bg-white border-gray-100'
                  )}
                >
                  <span className="font-bold">{label}</span>
                  <span className={cn('text-[9px] mt-0.5 font-medium', mode === v ? 'text-gray-300' : 'text-gray-400')}>{desc}</span>
                </button>
              ))}
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
            disabled={comparing || (!!(window as any).electronAPI && (!fileA || !fileB))}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-xs font-bold transition-all shadow-md select-none',
              comparing || (!!(window as any).electronAPI && (!fileA || !fileB))
                ? 'bg-gray-100 text-gray-300 cursor-not-allowed border border-gray-100 shadow-none'
                : 'bg-gray-900 text-white hover:bg-gray-800 active:scale-[0.99] cursor-pointer'
            )}
          >
            {comparing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                <span>대조 분석 연산 중 (하이브리드 OCR 작동)...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>
                  {!(window as any).electronAPI && (!fileA || !fileB)
                    ? '시연용 샘플 대조 검수 시작 (데모 모드)'
                    : '정밀 하이브리드 대조 검수 시작'}
                </span>
              </>
            )}
          </button>
        </motion.div>
      ) : results.length === 0 ? (
        // ─── Case 3: No Differences Found State ──────────────────────────────────
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
      ) : (
        // ─── Case 2: Multi-View Inspection Board State ─────────────────────────────
        <motion.div 
          key="inspection-board"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="flex flex-col flex-1 min-h-0 w-full bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-lg"
          style={{ fontFamily: "'Inter', 'Noto Sans KR', system-ui, sans-serif" }}
        >
          {/* 1. Header Control HUD */}
          <div className="flex items-center justify-between px-6 h-16 border-b border-gray-200 bg-white flex-shrink-0 z-10 shadow-sm select-none">
            <div className="flex items-center gap-3">
              <button 
                onClick={resetAll}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-800 rounded-xl text-[10.5px] font-black border border-gray-150 transition-all active:scale-95 cursor-pointer"
              >
                <ArrowRight className="w-3 h-3 rotate-180" />
                새 파일 대조
              </button>
              <div className="w-px h-6 bg-gray-250 mx-1" />
              <div>
                <h2 className="text-sm font-black text-gray-900 tracking-tight flex items-center gap-2">
                  PDF 대조 검수 결과
                  <span className="text-[9px] bg-blue-50 text-blue-600 border border-blue-100 font-black px-2 py-0.5 rounded-full uppercase tracking-wider">
                    {mode.toUpperCase()} MODE
                  </span>
                </h2>
                <p className="text-[10.5px] text-gray-400 font-medium">검출된 변경사항 {filteredDiffs.length}개 • OCR &amp; Native 검증 완료</p>
              </div>
            </div>

            {/* Multi-View Mode Selector */}
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl border border-gray-200">
              {(['side', 'swipe', 'overlay'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setViewMode(m)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer",
                    viewMode === m
                      ? "bg-gray-900 text-white shadow-md scale-105"
                      : "text-gray-500 hover:text-gray-800 hover:bg-gray-200"
                  )}
                >
                  {m === 'side' && <Columns className="w-3.5 h-3.5" />}
                  {m === 'swipe' && <Split className="w-3.5 h-3.5" />}
                  {m === 'overlay' && <Layers className="w-3.5 h-3.5" />}
                  {m === 'side' ? '듀얼 연동' : m === 'swipe' ? '슬라이더' : '오버레이'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-4">
              {/* Page navigation */}
              <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 border border-gray-200">
                <button 
                  onClick={() => { setCurrentPageIdx(p => Math.max(0, p - 1)); setActiveDiff(null); }} 
                  disabled={currentPageIdx === 0}
                  className="p-1.5 hover:bg-gray-200 rounded-lg text-gray-500 disabled:opacity-20 hover:text-gray-800 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] text-gray-700 w-16 text-center font-bold">
                  {currentPageIdx + 1} / {results.length} 페이지
                </span>
                <button 
                  onClick={() => { setCurrentPageIdx(p => Math.min(results.length - 1, p + 1)); setActiveDiff(null); }} 
                  disabled={currentPageIdx === results.length - 1}
                  className="p-1.5 hover:bg-gray-200 rounded-lg text-gray-500 disabled:opacity-20 hover:text-gray-800 cursor-pointer"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Zoom controls */}
              <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 border border-gray-200">
                <button onClick={() => setZoom(z => Math.max(40, z - 20))}
                  className="p-1.5 hover:bg-gray-200 rounded-lg text-gray-500 hover:text-gray-800 transition-all cursor-pointer">
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] text-gray-700 w-10 text-center font-mono font-bold">{zoom}%</span>
                <button onClick={() => setZoom(z => Math.min(300, z + 20))}
                  className="p-1.5 hover:bg-gray-200 rounded-lg text-gray-500 hover:text-gray-800 transition-all cursor-pointer">
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* 2. Workspace Body */}
          <div className="flex flex-1 min-h-0">
            
            {/* Left Interactive Change Sidebar */}
            <div className="w-80 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden shadow-sm z-10">
              
              {/* Filter Bar */}
              <div className="px-4 py-3 border-b border-gray-150 bg-gray-50/70 select-none">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">
                  <Filter className="w-3 h-3 text-gray-400" />
                  변경 유형 필터링
                </div>
                <div className="flex flex-col gap-2 bg-white border border-gray-200 rounded-xl p-3 shadow-inner">
                  {([
                    ['critical', showCritical, setShowCritical, 'text-rose-600', Hash, 'Critical (금액/수치)'],
                    ['high', showHigh, setShowHigh, 'text-orange-500', Type, 'High (텍스트 변경)'],
                    ['medium', showMedium, setShowMedium, 'text-purple-600', Box, 'Medium (도형 수정)'],
                    ['low', showLow, setShowLow, 'text-gray-500', MoveVertical, 'Low (미세 위치 오차)'],
                  ] as const).map(([key, val, setter, color, Icon, label]) => (
                    <label key={key} className="flex items-center justify-between cursor-pointer select-none group">
                      <div className="flex items-center gap-2">
                        <Icon className={cn('w-3.5 h-3.5', color)} />
                        <span className="text-xs font-semibold text-gray-700 group-hover:text-gray-900 transition-colors">{label}</span>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={val} 
                        onChange={e => { setter(e.target.checked); setActiveDiff(null); }}
                        className="w-4 h-4 rounded cursor-pointer accent-gray-900 border-gray-300 focus:ring-0" 
                      />
                    </label>
                  ))}
                </div>
              </div>

              {/* Progress and resets */}
              <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center bg-gray-50 select-none">
                <span className="text-[10px] font-black tracking-widest text-gray-500 uppercase">변경사항 리스트</span>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 text-[10px] font-bold bg-blue-50 border border-blue-100 px-2.5 py-0.5 rounded-full text-blue-600 font-mono">
                    검수율 {completionRate}%
                  </div>
                  {completionRate > 0 && (
                    <button onClick={resetChecked} className="p-1 hover:bg-gray-200 rounded-lg text-gray-400 hover:text-gray-600 transition-all cursor-pointer" title="검수 초기화">
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Cards feed */}
              <div className="flex-1 overflow-y-auto divide-y divide-gray-100 p-3 space-y-2 bg-gray-50/50">
                {filteredDiffs.length === 0 ? (
                  <div className="py-12 px-4 flex flex-col items-center justify-center text-center gap-3 bg-white border border-gray-200 border-dashed rounded-xl">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                    <div>
                      <p className="text-xs font-black text-gray-800">활성화된 이슈가 없습니다</p>
                      <p className="text-[10px] text-gray-400 mt-1 leading-normal">
                        현재 페이지에서 이 유형의 변경사항이 없거나 검수가 끝난 상태입니다.
                      </p>
                    </div>
                  </div>
                ) : (
                  filteredDiffs.map((d, i) => {
                    const m = meta(d.type);
                    const isChecked = !!checkedItems[getCheckedKey(i)];
                    return (
                      <div 
                        key={i}
                        className={cn(
                          "group relative w-full text-left rounded-xl p-3 border transition-all flex flex-col gap-2 cursor-pointer duration-150 shadow-sm",
                          activeDiff === i 
                            ? "bg-blue-50/80 border-blue-300 ring-2 ring-blue-100" 
                            : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-md",
                          isChecked && "opacity-45 bg-gray-50 border-gray-150"
                        )}
                        onClick={() => goToDiff(i)}
                      >
                        <div className="flex items-center justify-between">
                          <span className={cn('text-[9px] font-black uppercase px-2 py-0.5 rounded-full', m.color)} style={{ backgroundColor: `${m.ring}18`, color: m.ring }}>
                            {m.label}
                          </span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); toggleChecked(i); }}
                            className="p-1 hover:bg-gray-150 rounded-lg transition-all text-gray-450 text-gray-400 hover:text-gray-700 cursor-pointer"
                          >
                            {isChecked ? (
                              <CheckSquare className="w-4 h-4 text-emerald-500" />
                            ) : (
                              <Square className="w-4 h-4 text-gray-400 group-hover:text-gray-555" />
                            )}
                          </button>
                        </div>
                        
                        <p className="text-xs text-gray-800 font-bold leading-relaxed break-words">
                          {d.desc || d.type}
                        </p>

                        {d.textInfo ? (
                          <div className="bg-gray-50 rounded-lg p-2 border border-gray-150 text-[10px] leading-relaxed text-gray-750 font-sans shadow-inner">
                            {renderInlineDiff(d.textInfo.diffs)}
                          </div>
                        ) : (
                          d.before && (
                            <div className="text-[10px] text-gray-500 bg-gray-100/50 px-2 py-1 rounded font-mono truncate border border-gray-200/40">
                              {d.before}
                            </div>
                          )
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Center Panel - View Modes */}
            <div className="flex-1 flex flex-col bg-gray-100 p-6 overflow-hidden min-w-0">
              
              {/* Info HUD alert */}
              <div className="mb-4 bg-white border border-gray-200 rounded-2xl p-3 flex items-center justify-between shadow-sm select-none">
                <div className="flex items-center gap-2.5">
                  <Sparkles className="w-4 h-4 text-blue-500" />
                  <div className="text-[11px] text-gray-600 font-medium">
                    <span className="font-bold text-gray-900">하이브리드 비교 상태:</span> 아웃라인 변환 오차 및 이미지 안티앨리어싱은 Ignore Rules에 의해 자동 정제되어 노이즈 없는 결과를 보증합니다.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 font-bold">Targeted OCR 검수 완료</span>
                  <Info className="w-3.5 h-3.5 text-gray-400" />
                </div>
              </div>

              {/* Side-by-Side Lock Scroll View */}
              {viewMode === 'side' && currentResult && (
                <div className="flex-1 flex gap-4 min-h-0 relative">
                  <PdfPane
                    innerRef={scrollRefA}
                    onScroll={handleScrollA}
                    base64={currentResult.base64A}
                    diffs={filteredDiffs}
                    label="BEFORE — 원본"
                    activeDiff={activeDiff}
                    checkedItems={checkedItems}
                    zoom={zoom}
                  />
                  
                  {/* Floating scroll lock indicator */}
                  <button 
                    onClick={() => setScrollLock(!scrollLock)}
                    className={cn(
                      "absolute top-3 left-1/2 -translate-x-1/2 z-20 shadow-lg rounded-full p-2.5 border transition-all duration-200 flex items-center justify-center bg-white cursor-pointer hover:scale-105 active:scale-95",
                      scrollLock 
                        ? "border-blue-500 text-blue-600" 
                        : "border-gray-200 text-gray-500"
                    )}
                    title={scrollLock ? "스크롤 동기화 켜짐" : "스크롤 동기화 꺼짐"}
                  >
                    {scrollLock ? <Lock className="w-4 h-4 animate-pulse" /> : <Unlock className="w-4 h-4" />}
                  </button>

                  <PdfPane
                    innerRef={scrollRefB}
                    onScroll={handleScrollB}
                    base64={currentResult.base64B}
                    diffs={filteredDiffs}
                    label="AFTER — 수정본"
                    activeDiff={activeDiff}
                    checkedItems={checkedItems}
                    zoom={zoom}
                  />
                </div>
              )}

              {/* Swipe View Slider */}
              {viewMode === 'swipe' && currentResult && (
                <div className="flex-1 border border-gray-200 rounded-2xl overflow-auto shadow-sm relative bg-gray-100 flex items-center justify-center select-none p-4 min-h-0 scrollbar-thin">
                  <div 
                    className="relative aspect-[1/1.414] overflow-hidden bg-white border border-gray-200 rounded-xl shadow-lg"
                    style={{ height: `${zoom}%`, maxHeight: `${zoom}%` }}
                  >
                    {/* Document A (Background) */}
                    <img 
                      src={`data:image/png;base64,${currentResult.base64A}`} 
                      className="absolute inset-0 w-full h-full object-contain select-none" 
                      draggable={false} 
                    />
                    
                    {/* Document B (Foreground with Clip Path) */}
                    <div 
                      className="absolute inset-0 w-full h-full overflow-hidden"
                      style={{ clipPath: `polygon(0 0, ${sliderPos}% 0, ${sliderPos}% 100%, 0 100%)` }}
                    >
                      <img 
                        src={`data:image/png;base64,${currentResult.base64B}`} 
                        className="absolute inset-0 w-full h-full object-contain select-none" 
                        draggable={false} 
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
                      <div className="w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-500 border-2 border-white shadow-2xl flex items-center justify-center text-white cursor-ew-resize select-none">
                        <Split className="w-4 h-4 rotate-90" />
                      </div>
                    </div>
                    
                    {/* Floating labels */}
                    <div className="absolute top-3 left-3 bg-white/95 backdrop-blur text-gray-800 text-[10px] font-black px-2.5 py-1 rounded-lg border border-gray-200 shadow-sm z-10 pointer-events-none">
                      BEFORE — 원본 (좌측)
                    </div>
                    <div className="absolute top-3 right-3 bg-white/95 backdrop-blur text-gray-800 text-[10px] font-black px-2.5 py-1 rounded-lg border border-gray-200 shadow-sm z-10 pointer-events-none">
                      AFTER — 수정본 (우측)
                    </div>
                  </div>
                </div>
              )}

              {/* Overlay Blend View */}
              {viewMode === 'overlay' && currentResult && (
                <div className="flex-1 flex flex-col gap-4 min-h-0">
                  <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-2xl p-3 flex-shrink-0 shadow-sm select-none">
                    <Layers className="w-4 h-4 text-blue-500" />
                    <span className="text-xs font-bold text-gray-700">오버레이 투명도 조절</span>
                    <input 
                      type="range" 
                      min="0" 
                      max="100" 
                      value={overlayOpacity * 100} 
                      onChange={(e) => setOverlayOpacity(parseInt(e.target.value) / 100)}
                      className="flex-1 accent-blue-600 cursor-pointer h-1.5 bg-gray-200 rounded-lg appearance-none" 
                    />
                    <span className="text-xs font-mono w-10 text-right text-gray-700 font-bold">{Math.round(overlayOpacity * 100)}%</span>
                  </div>

                  <div className="flex-1 border border-gray-200 rounded-2xl overflow-auto shadow-sm relative bg-gray-100 flex items-center justify-center p-4 min-h-0 scrollbar-thin">
                    <div 
                      className="relative aspect-[1/1.414] overflow-hidden bg-white border border-gray-200 rounded-lg shadow-lg"
                      style={{ height: `${zoom}%`, maxHeight: `${zoom}%` }}
                    >
                      {/* Base Image A */}
                      <img 
                        src={`data:image/png;base64,${currentResult.base64A}`} 
                        className="absolute inset-0 w-full h-full object-contain select-none opacity-100" 
                        draggable={false} 
                      />
                      {/* Blended Overlaid Image B */}
                      <img 
                        src={`data:image/png;base64,${currentResult.base64B}`} 
                        className="absolute inset-0 w-full h-full object-contain select-none mix-blend-difference transition-opacity duration-75" 
                        style={{ opacity: overlayOpacity }}
                        draggable={false} 
                      />
                    </div>
                  </div>
                </div>
              )}
              
            </div>

          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
