import React, { useState, useRef } from 'react';
import { PDFDocument } from 'pdf-lib';
import { motion, AnimatePresence } from 'motion/react';
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
} from 'lucide-react';
import { cn } from './lib/utils';
import { CompareTab } from './features/compare/CompareTab';

interface FileItem {
  id: string;
  file: File;
  name: string;
  size: number;
}

function formatSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'merge' | 'outline' | 'compare'>('merge');

  // ── Merge tab state ──
  const [mergeFiles, setMergeFiles] = useState<FileItem[]>([]);
  const [mergeDragging, setMergeDragging] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeOutputName, setMergeOutputName] = useState('');
  const [mergeError, setMergeError] = useState<string | null>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);

  // ── Outline tab state ──
  const [outlineFile, setOutlineFile] = useState<File | null>(null);
  const [outlineDragging, setOutlineDragging] = useState(false);
  const [outlineName, setOutlineName] = useState('');
  const [isOutlining, setIsOutlining] = useState(false);
  const [outlineError, setOutlineError] = useState<string | null>(null);
  const [outlineSuccess, setOutlineSuccess] = useState<string | null>(null);
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
      const ext = f.name.split('.').pop()?.toLowerCase();
      if (ext === 'pdf' || ext === 'ai') {
        valid.push({ id: crypto.randomUUID(), file: f, name: f.name, size: f.size });
      }
    }
    if (valid.length === 0) {
      setMergeError('PDF 또는 AI 파일만 추가할 수 있습니다.');
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
          setOutlineSuccess(`로컬 저장 완료: ${saveDir}`);
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
          // Trigger browser file download from base64 string
          const byteCharacters = atob(result.fileData);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const outlinedBlob = new Blob([byteArray], { type: 'application/pdf' });
          const originalBlob = outlineFile;
          
          const baseName = outlineName.trim() || result.originalName || '출력문서';
          
          const downloadFile = (blob: Blob, filename: string) => {
            return new Promise<void>((resolve) => {
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = filename;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
              setTimeout(resolve, 300); // 300ms delay to prevent browser blocking multiple downloads
            });
          };

          await downloadFile(originalBlob, `(원본)${baseName}.ai`);
          await downloadFile(originalBlob, `(원본)${baseName}.pdf`);
          await downloadFile(outlinedBlob, `(인쇄용)${baseName}.pdf`);
          await downloadFile(outlinedBlob, `(인쇄용)${baseName}.ai`);

          setOutlineSuccess(`웹 아웃라인 문서 4종이 다운로드 폴더로 저장되었습니다! 파일명: ${baseName}`);
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

  return (
    <div className="min-h-screen bg-white text-gray-900 flex flex-col" style={{ fontFamily: "'Inter', 'Noto Sans KR', system-ui, sans-serif" }}>

      {/* ── Top bar ── */}
      <header className="border-b border-gray-100 px-8 h-14 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 bg-gray-900 rounded flex items-center justify-center">
            <FilePlus2 className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold tracking-tight">PDF & AI 툴킷</span>
        </div>
        <nav className="flex items-center gap-1">
          {(['merge', 'outline', 'compare'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-1.5 rounded-md text-xs font-medium transition-all',
                activeTab === tab
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
              )}
            >
              {tab === 'merge' ? 'PDF 병합' : tab === 'outline' ? '인쇄용 변환' : 'PDF 비교'}
            </button>
          ))}
        </nav>
      </header>

      {/* ── Content ── */}
      <main className={cn(
        "flex-grow flex flex-col w-full min-h-0 min-w-0 transition-all duration-300",
        activeTab === 'compare'
          ? (compareResults && compareResults.length > 0) || compareExpanded
            ? "max-w-none p-6 bg-gray-150/40 h-[calc(100vh-56px)]"
            : "max-w-2xl mx-auto px-6 py-10 gap-6"
          : "max-w-2xl mx-auto px-6 py-10 gap-6"
      )}>

        {/* ════ TAB 1: MERGE ════ */}
        <div style={{ display: activeTab === 'merge' ? 'flex' : 'none' }} className="flex-col gap-6 w-full flex animate-fadeIn">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">PDF 병합</h2>
            <p className="text-sm text-gray-400 mt-1">PDF와 AI 파일을 순서대로 하나의 PDF로 합칩니다.</p>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setMergeDragging(true); }}
            onDragLeave={() => setMergeDragging(false)}
            onDrop={handleMergeDrop}
            onClick={() => mergeInputRef.current?.click()}
            className={cn(
              'border rounded-xl flex flex-col items-center justify-center gap-2 py-10 cursor-pointer transition-all select-none',
              mergeDragging
                ? 'border-gray-400 bg-gray-50'
                : 'border-dashed border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
            )}
          >
            <Upload className="w-5 h-5 text-gray-300" />
            <p className="text-sm text-gray-400">파일을 드래그하거나 클릭하여 추가</p>
            <p className="text-xs text-gray-300">.pdf · .ai</p>
            <input
              ref={mergeInputRef}
              type="file"
              multiple
              accept=".pdf,.ai"
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
            <div className="border border-gray-100 rounded-xl overflow-hidden animate-fadeIn">
              <div className="px-4 py-3 border-b border-gray-50 flex justify-between items-center bg-gray-50/50">
                <span className="text-xs text-gray-400 font-medium">{mergeFiles.length}개 파일</span>
                <button onClick={() => setMergeFiles([])} className="text-xs text-gray-400 hover:text-red-500 transition-colors">전체 제거</button>
              </div>
              <ul className="divide-y divide-gray-50">
                {mergeFiles.map((f, idx) => {
                  const isAi = f.name.toLowerCase().endsWith('.ai');
                  return (
                    <motion.li key={f.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      className="flex items-center px-4 py-3 gap-3 group hover:bg-gray-50/50 transition-colors">
                      <span className="text-xs text-gray-300 w-5 text-right flex-shrink-0">{idx + 1}</span>
                      <span className={cn(
                        'text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0',
                        isAi ? 'bg-orange-50 text-orange-500' : 'bg-blue-50 text-blue-500'
                      )}>{isAi ? 'AI' : 'PDF'}</span>
                      <span className="flex-1 text-sm text-gray-700 truncate">{f.name}</span>
                      <span className="text-xs text-gray-300 font-mono flex-shrink-0">{formatSize(f.size)}</span>
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
                className="w-full text-sm px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 transition-colors pr-12 placeholder:text-gray-300"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-gray-300 font-mono">.pdf</span>
            </div>
            <button
              onClick={runMerge}
              disabled={isMerging || mergeFiles.length < 2}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all flex-shrink-0',
                isMerging || mergeFiles.length < 2
                  ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                  : 'bg-gray-900 text-white hover:bg-gray-700 active:scale-[0.98]'
              )}
            >
              {isMerging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {isMerging ? '병합 중…' : '병합'}
            </button>
          </div>
        </div>

        {/* ════ TAB 2: OUTLINE ════ */}
        <div style={{ display: activeTab === 'outline' ? 'flex' : 'none' }} className="flex-col gap-6 w-full flex animate-fadeIn">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">인쇄용 변환</h2>
            <p className="text-sm text-gray-400 mt-1">글씨를 아웃라인화하여 4종 파일로 자동 패키징합니다.</p>
          </div>

          {/* Drop zone */}
          {!outlineFile && (
            <div
              onDragOver={e => { e.preventDefault(); setOutlineDragging(true); }}
              onDragLeave={() => setOutlineDragging(false)}
              onDrop={handleOutlineDrop}
              onClick={() => outlineInputRef.current?.click()}
              className={cn(
                'border rounded-xl flex flex-col items-center justify-center gap-2 py-10 cursor-pointer transition-all select-none',
                outlineDragging
                  ? 'border-gray-400 bg-gray-50'
                  : 'border-dashed border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
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
              className="border border-gray-100 rounded-xl p-4 flex items-center gap-3 animate-fadeIn">
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
                <div className="bg-gray-50/50 px-5 py-4 flex items-center gap-3 border-b border-gray-100">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span className="text-sm font-medium text-gray-800">변환 완료</span>
                </div>
                <div className="px-5 py-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-gray-400 mb-3">
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span className="font-mono truncate">{outlineSuccess}</span>
                  </div>
                  {['(원본)', '(인쇄용)'].flatMap(prefix =>
                    ['.ai', '.pdf'].map(ext => (
                      <div key={prefix + ext} className="flex items-center gap-2 text-sm text-gray-600">
                        <ChevronRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                        <span className={cn('font-mono text-xs', prefix === '(인쇄용)' ? 'text-gray-800 font-semibold' : 'text-gray-500')}>
                          {prefix}{outlineName}{ext}
                        </span>
                        {prefix === '(인쇄용)' && (
                          <span className="ml-auto text-[10px] bg-orange-50 text-orange-500 px-1.5 py-0.5 rounded font-medium">아웃라인</span>
                        )}
                      </div>
                    ))
                  )}
                </div>
                <div className="px-5 py-3 border-t border-gray-50 flex justify-end">
                  <button onClick={() => setOutlineSuccess(null)}
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
                className="flex-1 text-sm px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 transition-colors placeholder:text-gray-300"
              />
              <button
                onClick={runOutlining}
                disabled={isOutlining}
                className={cn(
                  'flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all flex-shrink-0',
                  isOutlining
                    ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                    : 'bg-gray-900 text-white hover:bg-gray-700 active:scale-[0.98]'
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
