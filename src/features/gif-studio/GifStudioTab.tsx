import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Download, Eye, Film, ImagePlus, Loader2, Redo2, Save, ScanLine, Trash2, Undo2, Upload } from 'lucide-react';
import { GifCanvasStage } from './components/GifCanvasStage';
import { GifFileDropzone } from './components/GifFileDropzone';
import { GifPlaybackControls } from './components/GifPlaybackControls';
import { GifPresetPanel } from './components/GifPresetPanel';
import { GifPreviewCanvas } from './components/GifPreviewCanvas';
import { PdfPageNavigation } from './components/PdfPageNavigation';
import { PsdLayerList } from './components/PsdLayerList';
import { gifProjectReducer, initialGifStudioState } from './model/gifProjectReducer';
import {
  commitEditHistory,
  createEditHistory,
  redoEditHistory,
  resetEditHistory,
  undoEditHistory,
} from './model/editHistory';
import { DEFAULT_GIF_PRESET, evaluatePreset, getPresetAvailability, GIF_PRESET_DEFINITIONS } from './model/presets';
import { GIF_STUDIO_PROJECT_MAX_BYTES, parseGifStudioProject, serializeGifStudioProject } from './model/projectFile';
import {
  selectionRectForCanvas,
  type GifEditSnapshot,
  type GifPresetId,
  type GifSelection,
  type PresetDirection,
  type PresetSourceFormat,
  type Rect,
} from './model/types';
import { renderPresetFrame } from './render/renderPresetFrame';
import { importAiEpsFile } from './utils/aiEpsImporter';
import { formatFileSize, hasAiOrEpsExtension, hasHtmlExtension, hasPsdExtension, hasSvgExtension, isPngFile } from './utils/fileType';
import { sanitizeHtmlFile } from './utils/htmlImporter';
import { useObjectUrl } from './utils/objectUrl';
import { hasPdfExtension, openPdfFile, renderPdfPage, type OpenedPdf } from './utils/pdfImporter';
import { importPsdFile } from './utils/psdImporter';
import { sanitizeSvgFile } from './utils/svgSanitizer';

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener('change', updatePreference);
    return () => mediaQuery.removeEventListener('change', updatePreference);
  }, []);

  return prefersReducedMotion;
}

function hasRenderableSelection(selection: Rect | null): selection is Rect {
  return Boolean(selection && selection.width > 0 && selection.height > 0);
}

function inferPresetSourceFormat(name: string, fallback: Exclude<PresetSourceFormat, 'ai' | 'eps'>): PresetSourceFormat {
  if (/\.ai$/i.test(name)) return 'ai';
  if (/\.eps$/i.test(name)) return 'eps';
  return fallback;
}

const GIF_EXPORT_FPS = 12;
const GIF_EXPORT_MAX_FRAMES = 60;
const GIF_EXPORT_WIDTH = 860;
const GIF_EXPORT_MAX_FRAME_BYTES = 8 * 1024 * 1024;
const GIF_EXPORT_MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

const INITIAL_EDIT_SNAPSHOT: GifEditSnapshot = {
  selection: null,
  presetId: DEFAULT_GIF_PRESET.id,
  durationMs: DEFAULT_GIF_PRESET.defaultDurationMs,
  intensity: DEFAULT_GIF_PRESET.defaultParams.intensity,
  accentColor: DEFAULT_GIF_PRESET.defaultParams.accentColor,
  direction: DEFAULT_GIF_PRESET.defaultParams.direction,
  loopCount: 0,
};

type GifExportStatus = {
  kind: 'idle' | 'rendering' | 'uploading' | 'success' | 'error';
  message: string;
  progress: number;
};

type ElectronGifExportResponse = {
  success: boolean;
  canceled: boolean;
  path: string | null;
  error?: string;
};

type ElectronGifExportApi = {
  isElectron?: () => boolean;
  gifExport?: (payload: {
    frames: ArrayBuffer[];
    suggestedName: string;
    options: {
      width: number;
      durationMs: number;
      loopCount: number;
      colors: number;
      dither: number;
      effort: number;
      delays: number[];
    };
  }) => Promise<ElectronGifExportResponse>;
};

function loadExportImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('내보낼 PNG 이미지를 다시 열 수 없습니다.'));
    image.src = url;
  });
}

function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('PNG 프레임을 생성하지 못했습니다.'));
    }, 'image/png');
  });
}

function distributeFrameDelays(durationMs: number, frameCount: number) {
  return Array.from({ length: frameCount }, (_, index) => (
    Math.floor(((index + 1) * durationMs) / frameCount)
      - Math.floor((index * durationMs) / frameCount)
  ));
}

export function GifStudioTab() {
  const [state, dispatch] = useReducer(gifProjectReducer, initialGifStudioState);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceRaster, setSourceRaster] = useState<Blob | null>(null);
  const [presetId, setPresetId] = useState<GifPresetId>(INITIAL_EDIT_SNAPSHOT.presetId);
  const [durationMs, setDurationMs] = useState(INITIAL_EDIT_SNAPSHOT.durationMs);
  const [intensity, setIntensity] = useState(INITIAL_EDIT_SNAPSHOT.intensity);
  const [accentColor, setAccentColor] = useState(INITIAL_EDIT_SNAPSHOT.accentColor);
  const [direction, setDirection] = useState<PresetDirection>(INITIAL_EDIT_SNAPSHOT.direction);
  const [loopCount, setLoopCount] = useState(INITIAL_EDIT_SNAPSHOT.loopCount);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPdfPageRendering, setIsPdfPageRendering] = useState(false);
  const [exportStatus, setExportStatus] = useState<GifExportStatus>({ kind: 'idle', message: '', progress: 0 });
  const [projectMessage, setProjectMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const currentTimeRef = useRef(0);
  const pdfDocumentRef = useRef<OpenedPdf['document'] | null>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const currentEditRef = useRef<GifEditSnapshot>(INITIAL_EDIT_SNAPSHOT);
  const editHistoryRef = useRef(createEditHistory(INITIAL_EDIT_SNAPSHOT));
  const editGestureStartRef = useRef<GifEditSnapshot | null>(null);
  const [, bumpHistoryRevision] = useReducer((revision: number) => revision + 1, 0);
  const imageUrl = useObjectUrl(sourceRaster ?? sourceFile);
  const prefersReducedMotion = usePrefersReducedMotion();
  const canvasSelection = state.source ? selectionRectForCanvas(state.selection, state.source) : null;
  const hasSelection = Boolean(state.source && hasRenderableSelection(canvasSelection));
  const targetContext = {
    selectionKind: state.selection?.kind ?? null,
    sourceFormat: state.source
      ? inferPresetSourceFormat(sourceFile?.name ?? state.source.name, state.source.kind)
      : null,
  };
  const selectedPresetAvailability = getPresetAvailability(presetId, targetContext);
  const canPreview = hasSelection && selectedPresetAvailability.supported;

  const seekTo = useCallback((timeMs: number) => {
    const nextTime = Math.max(0, Math.min(durationMs, timeMs));
    currentTimeRef.current = nextTime;
    setCurrentTimeMs(nextTime);
  }, [durationMs]);

  const resetPlayback = useCallback(() => {
    currentTimeRef.current = 0;
    setCurrentTimeMs(0);
    setIsPlaying(false);
  }, []);

  const applyEditSnapshot = useCallback((snapshot: GifEditSnapshot) => {
    currentEditRef.current = snapshot;
    dispatch({ type: 'selection-changed', selection: snapshot.selection });
    setPresetId(snapshot.presetId);
    setDurationMs(snapshot.durationMs);
    setIntensity(snapshot.intensity);
    setAccentColor(snapshot.accentColor);
    setDirection(snapshot.direction);
    setLoopCount(snapshot.loopCount);
  }, []);

  const commitEditSnapshot = useCallback((snapshot: GifEditSnapshot) => {
    const nextHistory = commitEditHistory(editHistoryRef.current, snapshot);
    editHistoryRef.current = nextHistory;
    applyEditSnapshot(nextHistory.present);
    bumpHistoryRevision();
  }, [applyEditSnapshot]);

  const updateEditSnapshot = useCallback((patch: Partial<GifEditSnapshot>) => {
    const next = { ...currentEditRef.current, ...patch };
    if (editGestureStartRef.current) applyEditSnapshot(next);
    else commitEditSnapshot(next);
  }, [applyEditSnapshot, commitEditSnapshot]);

  const beginEditGesture = useCallback(() => {
    if (!editGestureStartRef.current) editGestureStartRef.current = currentEditRef.current;
  }, []);

  const finishEditGesture = useCallback(() => {
    if (!editGestureStartRef.current) return;
    editGestureStartRef.current = null;
    editHistoryRef.current = commitEditHistory(editHistoryRef.current, currentEditRef.current);
    bumpHistoryRevision();
  }, []);

  const resetHistoryForSourceChange = useCallback(() => {
    editGestureStartRef.current = null;
    const next = { ...currentEditRef.current, selection: null };
    editHistoryRef.current = resetEditHistory(next);
    applyEditSnapshot(next);
    setProjectMessage(null);
    bumpHistoryRevision();
  }, [applyEditSnapshot]);

  const performUndo = useCallback(() => {
    finishEditGesture();
    const nextHistory = undoEditHistory(editHistoryRef.current);
    if (nextHistory === editHistoryRef.current) return;
    editHistoryRef.current = nextHistory;
    applyEditSnapshot(nextHistory.present);
    resetPlayback();
    setExportStatus({ kind: 'idle', message: '', progress: 0 });
    setProjectMessage(null);
    bumpHistoryRevision();
  }, [applyEditSnapshot, finishEditGesture, resetPlayback]);

  const performRedo = useCallback(() => {
    finishEditGesture();
    const nextHistory = redoEditHistory(editHistoryRef.current);
    if (nextHistory === editHistoryRef.current) return;
    editHistoryRef.current = nextHistory;
    applyEditSnapshot(nextHistory.present);
    resetPlayback();
    setExportStatus({ kind: 'idle', message: '', progress: 0 });
    setProjectMessage(null);
    bumpHistoryRevision();
  }, [applyEditSnapshot, finishEditGesture, resetPlayback]);

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) performRedo();
      else performUndo();
    };
    window.addEventListener('keydown', handleHistoryShortcut);
    return () => window.removeEventListener('keydown', handleHistoryShortcut);
  }, [performRedo, performUndo]);

  const releasePdfDocument = useCallback(() => {
    const document = pdfDocumentRef.current;
    pdfDocumentRef.current = null;
    if (document) void document.destroy().catch(() => undefined);
  }, []);

  useEffect(() => () => releasePdfDocument(), [releasePdfDocument]);

  useEffect(() => {
    if (!sourceFile || !imageUrl || !sourceFile.name.toLowerCase().endsWith('.png')) return;
    const image = new Image();
    let cancelled = false;

    image.onload = () => {
      if (cancelled) return;
      dispatch({
        type: 'import-succeeded',
        source: {
          id: crypto.randomUUID(),
          kind: 'png',
          name: sourceFile.name,
          size: sourceFile.size,
          width: image.naturalWidth,
          height: image.naturalHeight,
          coordinateOrigin: { x: 0, y: 0 },
        },
      });
    };
    image.onerror = () => {
      if (!cancelled) {
        dispatch({ type: 'import-failed', message: 'PNG 이미지를 열 수 없습니다. 파일이 손상되지 않았는지 확인해 주세요.' });
        setSourceFile(null);
      }
    };
    image.src = imageUrl;

    return () => {
      cancelled = true;
      image.src = '';
    };
  }, [imageUrl, sourceFile]);

  useEffect(() => {
    if (!isPlaying || prefersReducedMotion || !canPreview) return;

    let animationFrameId = 0;
    const playbackStart = performance.now();
    const startTime = currentTimeRef.current >= durationMs ? 0 : currentTimeRef.current;

    const renderNextFrame = (now: number) => {
      const nextTime = (startTime + now - playbackStart) % durationMs;
      currentTimeRef.current = nextTime;
      setCurrentTimeMs(nextTime);
      animationFrameId = requestAnimationFrame(renderNextFrame);
    };

    animationFrameId = requestAnimationFrame(renderNextFrame);
    return () => cancelAnimationFrame(animationFrameId);
  }, [canPreview, durationMs, isPlaying, prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion || !canPreview) setIsPlaying(false);
  }, [canPreview, prefersReducedMotion]);

  const handleFileSelected = async (file: File) => {
    try {
      resetPlayback();
      setExportStatus({ kind: 'idle', message: '', progress: 0 });
      setIsPdfPageRendering(false);
      releasePdfDocument();
      setSourceFile(null);
      setSourceRaster(null);
      resetHistoryForSourceChange();
      dispatch({ type: 'import-started' });
      if (hasAiOrEpsExtension(file)) {
        const imported = await importAiEpsFile(file);
        const opened = await openPdfFile(imported.pdfFile);
        pdfDocumentRef.current = opened.document;
        try {
          const rendered = await renderPdfPage(opened.document, file, 1);
          setSourceFile(file);
          setSourceRaster(rendered.blob);
          dispatch({ type: 'import-succeeded', source: rendered.source });
        } catch (error) {
          releasePdfDocument();
          throw error;
        }
        return;
      }
      if (hasPdfExtension(file)) {
        const opened = await openPdfFile(file);
        pdfDocumentRef.current = opened.document;
        try {
          const rendered = await renderPdfPage(opened.document, file, 1);
          setSourceFile(file);
          setSourceRaster(rendered.blob);
          dispatch({ type: 'import-succeeded', source: rendered.source });
        } catch (error) {
          releasePdfDocument();
          throw error;
        }
        return;
      }
      if (hasPsdExtension(file)) {
        const imported = await importPsdFile(file);
        setSourceFile(file);
        setSourceRaster(imported.previewBlob);
        dispatch({ type: 'import-succeeded', source: imported.source });
        return;
      }
      if (hasSvgExtension(file)) {
        const imported = await sanitizeSvgFile(file);
        setSourceFile(imported.file);
        dispatch({ type: 'import-succeeded', source: imported.source });
        return;
      }
      if (hasHtmlExtension(file)) {
        const imported = await sanitizeHtmlFile(file);
        setSourceFile(file);
        setSourceRaster(imported.renderBlob);
        dispatch({ type: 'import-succeeded', source: imported.source });
        return;
      }
      if (!(await isPngFile(file))) {
        dispatch({ type: 'import-failed', message: '확장자와 파일 내용이 일치하는 PNG, SVG, PSD, PDF, AI, EPS 또는 HTML만 업로드할 수 있습니다.' });
        return;
      }
      setSourceFile(file);
    } catch (error) {
      setSourceFile(null);
      setSourceRaster(null);
      dispatch({
        type: 'import-failed',
        message: error instanceof Error ? error.message : '파일 형식을 확인할 수 없습니다. 다른 PNG, SVG, PSD, PDF, AI, EPS 또는 HTML을 선택해 주세요.',
      });
    }
  };

  const handlePdfPageChange = async (pageNumber: number) => {
    if (
      state.source?.kind !== 'pdf'
      || !sourceFile
      || !pdfDocumentRef.current
      || isPdfPageRendering
      || pageNumber === state.source.currentPage
    ) return;

    resetPlayback();
    setExportStatus({ kind: 'idle', message: '', progress: 0 });
    resetHistoryForSourceChange();
    setIsPdfPageRendering(true);
    try {
      const rendered = await renderPdfPage(pdfDocumentRef.current, sourceFile, pageNumber);
      setSourceRaster(rendered.blob);
      dispatch({ type: 'import-succeeded', source: rendered.source });
    } catch (error) {
      dispatch({
        type: 'import-failed',
        message: error instanceof Error ? error.message : `PDF ${pageNumber}페이지를 열 수 없습니다.`,
      });
    } finally {
      setIsPdfPageRendering(false);
    }
  };

  const resetStudio = () => {
    releasePdfDocument();
    setSourceFile(null);
    setSourceRaster(null);
    setIsPdfPageRendering(false);
    resetPlayback();
    setExportStatus({ kind: 'idle', message: '', progress: 0 });
    resetHistoryForSourceChange();
    dispatch({ type: 'reset' });
  };

  const handleSelectionChange = (selection: GifSelection | null) => {
    resetPlayback();
    setExportStatus({ kind: 'idle', message: '', progress: 0 });
    updateEditSnapshot({ selection });
  };

  const handlePresetChange = (nextPresetId: GifPresetId) => {
    const preset = GIF_PRESET_DEFINITIONS.find(candidate => candidate.id === nextPresetId);
    if (!preset || !getPresetAvailability(nextPresetId, targetContext).supported) return;
    commitEditSnapshot({
      ...currentEditRef.current,
      presetId: nextPresetId,
      durationMs: preset.defaultDurationMs,
      intensity: preset.defaultParams.intensity,
      accentColor: preset.defaultParams.accentColor,
      direction: preset.defaultParams.direction,
    });
    resetPlayback();
    setExportStatus({ kind: 'idle', message: '', progress: 0 });
  };

  const handleDurationChange = (nextDurationMs: number) => {
    const clampedDuration = Math.max(600, Math.min(4000, nextDurationMs));
    updateEditSnapshot({ durationMs: clampedDuration });
    if (currentTimeRef.current > clampedDuration) {
      currentTimeRef.current = clampedDuration;
      setCurrentTimeMs(clampedDuration);
    }
  };

  const handleSaveProject = () => {
    if (!state.source) return;
    try {
      finishEditGesture();
      const json = serializeGifStudioProject(state.source, currentEditRef.current);
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const baseName = state.source.name.replace(/\.(?:png|svg|psd|pdf|ai|eps)$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'motion';
      anchor.href = url;
      anchor.download = `${baseName}.gifstudio.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setProjectMessage({ kind: 'success', text: '프로젝트 설정을 저장했습니다.' });
    } catch (error) {
      setProjectMessage({ kind: 'error', text: error instanceof Error ? error.message : '프로젝트 설정을 저장하지 못했습니다.' });
    }
  };

  const handleLoadProject = async (file: File) => {
    if (!state.source) return;
    try {
      if (file.size > GIF_STUDIO_PROJECT_MAX_BYTES) throw new Error('프로젝트 JSON은 256KB 이하여야 합니다.');
      const json = await file.text();
      const project = parseGifStudioProject(json, state.source);
      finishEditGesture();
      commitEditSnapshot(project.snapshot);
      resetPlayback();
      setExportStatus({ kind: 'idle', message: '', progress: 0 });
      setProjectMessage({ kind: 'success', text: '현재 원본에 프로젝트 설정을 적용했습니다.' });
    } catch (error) {
      setProjectMessage({ kind: 'error', text: error instanceof Error ? error.message : '프로젝트 설정을 불러오지 못했습니다.' });
    }
  };

  const progress = durationMs > 0 ? currentTimeMs / durationMs : 0;
  const isExporting = exportStatus.kind === 'rendering' || exportStatus.kind === 'uploading';
  const canUndo = editHistoryRef.current.past.length > 0;
  const canRedo = editHistoryRef.current.future.length > 0;

  const handleExportGif = async () => {
    if (!state.source || !imageUrl || !hasRenderableSelection(canvasSelection) || isExporting) return;

    setIsPlaying(false);
    try {
      const frameCount = Math.min(
        GIF_EXPORT_MAX_FRAMES,
        Math.max(2, Math.round((durationMs / 1000) * GIF_EXPORT_FPS)),
      );
      const delays = distributeFrameDelays(durationMs, frameCount);
      const outputWidth = Math.max(1, Math.round(Math.min(GIF_EXPORT_WIDTH, state.source.width)));
      const outputHeight = Math.max(1, Math.round(state.source.height * (outputWidth / state.source.width)));
      const scale = outputWidth / state.source.width;
      const exportSelection = {
        x: canvasSelection.x * scale,
        y: canvasSelection.y * scale,
        width: canvasSelection.width * scale,
        height: canvasSelection.height * scale,
      };
      const image = await loadExportImage(imageUrl);
      const canvas = document.createElement('canvas');
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('브라우저에서 GIF 프레임 캔버스를 만들 수 없습니다.');

      const frameBlobs: Blob[] = [];
      let totalBytes = 0;
      for (let index = 0; index < frameCount; index += 1) {
        const frameProgress = index / frameCount;
        const frame = evaluatePreset(presetId, frameProgress, exportSelection, { intensity, accentColor, direction });
        renderPresetFrame(context, image, outputWidth, outputHeight, frame);
        const blob = await canvasToPng(canvas);
        if (blob.size > GIF_EXPORT_MAX_FRAME_BYTES) {
          throw new Error('생성된 PNG 프레임이 8MB 제한을 초과했습니다.');
        }
        totalBytes += blob.size;
        if (totalBytes > GIF_EXPORT_MAX_UPLOAD_BYTES) {
          throw new Error('생성된 PNG 프레임 전체가 80MB 제한을 초과했습니다.');
        }
        frameBlobs.push(blob);
        setExportStatus({
          kind: 'rendering',
          message: `PNG 프레임 생성 중 ${index + 1}/${frameCount}`,
          progress: Math.round(((index + 1) / frameCount) * 85),
        });
      }

      const baseName = state.source.name.replace(/\.(?:png|svg|psd|pdf|ai|eps)$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'motion';
      const electronApi = (window as unknown as { electronAPI?: ElectronGifExportApi }).electronAPI;
      if (electronApi?.isElectron?.()) {
        if (!electronApi.gifExport) {
          throw new Error('Electron GIF 저장 API를 사용할 수 없습니다.');
        }
        setExportStatus({ kind: 'uploading', message: '앱에서 GIF 인코딩 중', progress: 92 });
        const result = await electronApi.gifExport({
          frames: await Promise.all(frameBlobs.map(blob => blob.arrayBuffer())),
          suggestedName: `${baseName}-motion.gif`,
          options: {
            width: outputWidth,
            durationMs,
            loopCount,
            colors: 256,
            dither: 0.75,
            effort: 7,
            delays,
          },
        });
        if (!result.success) {
          throw new Error(result.error || 'Electron GIF 저장에 실패했습니다.');
        }
        if (result.canceled) {
          setExportStatus({ kind: 'success', message: 'GIF 저장을 취소했습니다.', progress: 0 });
          return;
        }
        setExportStatus({
          kind: 'success',
          message: `${outputWidth} × ${outputHeight}px · ${frameCount}프레임 GIF를 저장했습니다. ${result.path ?? ''}`.trim(),
          progress: 100,
        });
        return;
      }

      const formData = new FormData();
      frameBlobs.forEach((blob, index) => {
        formData.append('frames', blob, `frame-${String(index).padStart(3, '0')}.png`);
      });
      formData.append('options', JSON.stringify({
        width: GIF_EXPORT_WIDTH,
        fps: GIF_EXPORT_FPS,
        durationMs,
        loopCount,
        colors: 256,
        dither: 0.75,
        effort: 7,
        delays,
      }));

      setExportStatus({ kind: 'uploading', message: '서버에서 GIF 인코딩 중', progress: 92 });
      const response = await fetch('/gif-export', { method: 'POST', body: formData });
      if (!response.ok) {
        let message = 'GIF 내보내기에 실패했습니다.';
        try {
          const payload = await response.json() as { error?: string };
          if (payload.error) message = payload.error;
        } catch (_) {}
        throw new Error(message);
      }

      const gifBlob = await response.blob();
      const signature = new TextDecoder('ascii').decode(await gifBlob.slice(0, 6).arrayBuffer());
      if (gifBlob.size === 0 || (signature !== 'GIF87a' && signature !== 'GIF89a')) {
        throw new Error('서버 응답이 올바른 GIF 파일이 아닙니다.');
      }

      const downloadUrl = URL.createObjectURL(gifBlob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = `${baseName}-motion.gif`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

      setExportStatus({
        kind: 'success',
        message: `${outputWidth} × ${outputHeight}px · ${frameCount}프레임 GIF를 다운로드했습니다.`,
        progress: 100,
      });
    } catch (error) {
      setExportStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'GIF 내보내기에 실패했습니다.',
        progress: 0,
      });
    }
  };

  return (
    <section className="flex min-h-0 w-full flex-1 flex-col gap-5" aria-labelledby="gif-studio-title">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 id="gif-studio-title" className="text-lg font-black tracking-tight text-slate-950">GIF 생성</h2>
            <span className="rounded-md bg-pink-100 px-2 py-1 text-[10px] font-black tracking-wide text-pink-700">BETA</span>
          </div>
          <p className="mt-1 text-xs font-semibold text-slate-500">PNG·PDF·AI·EPS 영역, SVG·정적 HTML 객체 또는 PSD 레이어를 선택하고 결정적 프리셋을 실시간으로 미리 봅니다.</p>
        </div>
        {state.source && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <input
              ref={projectInputRef}
              type="file"
              accept=".gifstudio.json,application/json"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void handleLoadProject(file);
              }}
            />
            <button
              type="button"
              onClick={performUndo}
              disabled={!canUndo}
              className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 shadow-sm hover:border-pink-200 hover:text-pink-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:text-slate-300"
              aria-label="실행 취소 (Ctrl 또는 Command+Z)"
              title="실행 취소 (Ctrl/Cmd+Z)"
            >
              <Undo2 className="h-4 w-4" aria-hidden="true" />
              실행 취소
            </button>
            <button
              type="button"
              onClick={performRedo}
              disabled={!canRedo}
              className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 shadow-sm hover:border-pink-200 hover:text-pink-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:text-slate-300"
              aria-label="다시 실행 (Ctrl 또는 Command+Shift+Z)"
              title="다시 실행 (Ctrl/Cmd+Shift+Z)"
            >
              <Redo2 className="h-4 w-4" aria-hidden="true" />
              다시 실행
            </button>
            <button
              type="button"
              onClick={handleSaveProject}
              className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 shadow-sm hover:border-pink-200 hover:text-pink-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              설정 저장
            </button>
            <button
              type="button"
              onClick={() => projectInputRef.current?.click()}
              className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 shadow-sm hover:border-pink-200 hover:text-pink-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              설정 불러오기
            </button>
            <button
              type="button"
              onClick={resetStudio}
              className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 shadow-sm hover:border-rose-200 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              작업 비우기
            </button>
          </div>
        )}
      </header>

      {projectMessage && (
        <p
          role="status"
          className={`rounded-xl border px-4 py-2.5 text-xs font-bold ${projectMessage.kind === 'success' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-rose-100 bg-rose-50 text-rose-700'}`}
        >
          {projectMessage.text}
        </p>
      )}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[250px_minmax(0,1fr)_250px]">
        <aside className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm" aria-labelledby="gif-source-heading">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950 text-pink-400">
              <ImagePlus className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h3 id="gif-source-heading" className="text-sm font-black text-slate-900">원본 이미지</h3>
              <p className="text-[11px] font-semibold text-slate-400">PNG · 안전하게 정제한 SVG/HTML · PSD · PDF · AI · EPS</p>
            </div>
          </div>
          <GifFileDropzone onFileSelected={file => void handleFileSelected(file)} hasSource={Boolean(state.source)} />

          {state.source && (
            <dl className="mt-4 space-y-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-xs">
              <div>
                <dt className="font-bold text-slate-400">파일명</dt>
                <dd className="mt-0.5 break-all font-black text-slate-700">{state.source.name}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-bold text-slate-400">크기</dt>
                <dd className="font-black text-slate-700">{state.source.width} × {state.source.height}px</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-bold text-slate-400">용량</dt>
                <dd className="font-black text-slate-700">{formatFileSize(state.source.size)}</dd>
              </div>
              {(state.source.kind === 'svg' || state.source.kind === 'html') && (
                <>
                  <div className="flex justify-between gap-3">
                    <dt className="font-bold text-slate-400">{state.source.kind === 'svg' ? 'SVG 객체' : 'HTML 객체'}</dt>
                    <dd className="font-black text-slate-700">{state.source.objectCount}개</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-slate-400">보안 정제</dt>
                    <dd className="mt-0.5 font-black text-emerald-700">
                      {state.source.securityReport.length > 0 ? state.source.securityReport.join(' · ') : '위험 요소 없음'}
                    </dd>
                  </div>
                </>
              )}
              {state.source.kind === 'pdf' && (
                <>
                  <div className="flex justify-between gap-3">
                    <dt className="font-bold text-slate-400">페이지</dt>
                    <dd className="font-black text-slate-700">{state.source.currentPage} / {state.source.pageCount}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="font-bold text-slate-400">렌더 기준</dt>
                    <dd className="font-black text-slate-700">최대 2048px</dd>
                  </div>
                </>
              )}
            </dl>
          )}
          {state.source?.kind === 'html' && (
            <p className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-2.5 py-2 text-[10px] font-bold leading-4 text-amber-800">
              정적 디자인 BETA입니다. 원본 HTML 재저장, JavaScript 실행, 동적 상태, 외부 폰트·이미지는 지원하지 않습니다.
            </p>
          )}
          {state.source?.kind === 'pdf' && (
            <PdfPageNavigation
              source={state.source}
              busy={isPdfPageRendering}
              onPageChange={pageNumber => void handlePdfPageChange(pageNumber)}
            />
          )}
          {state.source?.kind === 'psd' && (
            <>
              {state.source.warnings.map(warning => (
                <p key={warning} className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-2.5 py-2 text-[10px] font-bold leading-4 text-amber-800">
                  {warning}
                </p>
              ))}
              <PsdLayerList source={state.source} selection={state.selection} onSelectionChange={handleSelectionChange} />
            </>
          )}
        </aside>

        <div className="flex min-h-[460px] min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-sm">
          {state.status === 'importing' && (
            <div className="flex min-h-[360px] flex-1 flex-col items-center justify-center px-6 text-center" role="status">
              <Loader2 className="h-7 w-7 animate-spin text-pink-500 motion-reduce:animate-none" aria-hidden="true" />
              <p className="mt-3 text-sm font-black text-slate-700">PNG, SVG, PSD, PDF, AI, EPS 또는 HTML을 불러오는 중입니다</p>
            </div>
          )}

          {state.status === 'ready' && state.source && imageUrl && (
            <div className="grid min-h-0 flex-1 divide-y divide-slate-100 2xl:grid-cols-2 2xl:divide-x 2xl:divide-y-0">
              <section className="flex min-h-0 min-w-0 flex-col" aria-labelledby="gif-editor-canvas-heading">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Film className="h-4 w-4 text-pink-500" aria-hidden="true" />
                    <h3 id="gif-editor-canvas-heading" className="text-sm font-black text-slate-900">Editor Canvas</h3>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-pink-50 px-2.5 py-1 text-[11px] font-black text-pink-700">
                    <ScanLine className="h-3.5 w-3.5" aria-hidden="true" />
                    {state.selection?.kind === 'object' ? `${state.selection.label} · ${state.selection.objectType}` : '영역 선택'}
                  </span>
                </div>
                <GifCanvasStage
                  imageUrl={imageUrl}
                  source={state.source}
                  selection={state.selection}
                  onSelectionChange={handleSelectionChange}
                  onSelectionGestureStart={beginEditGesture}
                  onSelectionGestureEnd={finishEditGesture}
                />
              </section>

              <section className="flex min-h-0 min-w-0 flex-col" aria-labelledby="gif-preview-canvas-heading">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Eye className="h-4 w-4 text-pink-500" aria-hidden="true" />
                    <h3 id="gif-preview-canvas-heading" className="text-sm font-black text-slate-900">Preview Canvas</h3>
                  </div>
                  <span className="text-[11px] font-black text-slate-400">{Math.round(progress * 100)}%</span>
                </div>
                <GifPreviewCanvas
                  imageUrl={imageUrl}
                  source={state.source}
                  selection={canvasSelection}
                  presetId={presetId}
                  progress={progress}
                  intensity={intensity}
                  accentColor={accentColor}
                  direction={direction}
                />
              </section>
            </div>
          )}

          {state.status === 'idle' && (
            <section className="flex min-h-[360px] flex-1 flex-col items-center justify-center px-6 text-center" aria-labelledby="gif-empty-title">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-pink-100 bg-pink-50 text-pink-500">
                <ImagePlus className="h-7 w-7" aria-hidden="true" />
              </span>
              <h3 id="gif-empty-title" className="mt-5 text-lg font-black tracking-tight text-slate-900">편집할 PNG, SVG, PSD, PDF, AI, EPS 또는 HTML을 선택해 주세요</h3>
              <p className="mt-2 max-w-sm text-sm font-medium leading-6 text-slate-500">왼쪽의 파일 선택 버튼을 사용하면 이미지가 캔버스에 표시됩니다.</p>
            </section>
          )}
        </div>

        <GifPresetPanel value={presetId} disabled={!hasSelection} targetContext={targetContext} onChange={handlePresetChange} />
      </div>

      <GifPlaybackControls
        currentTimeMs={currentTimeMs}
        durationMs={durationMs}
        intensity={intensity}
        accentColor={accentColor}
        direction={direction}
        loopCount={loopCount}
        isPlaying={isPlaying}
        disabled={!canPreview}
        prefersReducedMotion={prefersReducedMotion}
        onTogglePlayback={() => setIsPlaying(playing => !playing)}
        onRestart={resetPlayback}
        onScrub={timeMs => {
          setIsPlaying(false);
          seekTo(timeMs);
        }}
        onDurationChange={handleDurationChange}
        onIntensityChange={nextIntensity => updateEditSnapshot({ intensity: Math.max(0, Math.min(1, nextIntensity)) })}
        onAccentColorChange={nextAccentColor => updateEditSnapshot({ accentColor: nextAccentColor })}
        onDirectionChange={nextDirection => updateEditSnapshot({ direction: nextDirection })}
        onLoopCountChange={nextLoopCount => updateEditSnapshot({ loopCount: Math.max(0, Math.min(3, nextLoopCount)) })}
        onEditGestureStart={beginEditGesture}
        onEditGestureEnd={finishEditGesture}
      />

      <section className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm" aria-labelledby="gif-export-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="gif-export-heading" className="text-sm font-black text-slate-900">웹 GIF 내보내기</h3>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
              12 FPS · 최대 60프레임 · 860px 이하 · {loopCount === 0 ? '무한 반복' : `${loopCount}회 반복`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleExportGif()}
            disabled={!canPreview || isExporting}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-xs font-black text-white shadow-sm transition hover:bg-pink-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
          >
            {isExporting
              ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              : <Download className="h-4 w-4" aria-hidden="true" />}
            {isExporting ? 'GIF 만드는 중' : 'GIF 다운로드'}
          </button>
        </div>

        {exportStatus.kind !== 'idle' && exportStatus.kind !== 'error' && (
          <div className="mt-3" role="status" aria-live="polite">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={exportStatus.progress}>
              <div className="h-full rounded-full bg-pink-500 transition-[width]" style={{ width: `${exportStatus.progress}%` }} />
            </div>
            <p className={`mt-2 text-xs font-bold ${exportStatus.kind === 'success' ? 'text-emerald-700' : 'text-slate-600'}`}>{exportStatus.message}</p>
          </div>
        )}
      </section>

      <div className="min-h-5" aria-live="assertive" aria-atomic="true">
        {state.error && <p className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700">{state.error}</p>}
        {exportStatus.kind === 'error' && <p className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700">{exportStatus.message}</p>}
      </div>
    </section>
  );
}
