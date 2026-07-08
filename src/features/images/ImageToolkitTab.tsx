import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import JSZip from 'jszip';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Braces,
  CheckCircle2,
  Download,
  Eye,
  ImageDown,
  Layers3,
  Loader2,
  RotateCcw,
  Ruler,
  Scissors,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { runImageProcess, type ImageProcessFile } from './imageClient';
import type { ImageToolMode, OutputFormat, SplitAxis, SplitStrategy, StitchDirection } from './types';

type PendingFile = {
  id: string;
  file: File;
  extension: string;
  width?: number;
  height?: number;
  metadataError?: string;
};

type UploadFileMode = Exclude<ImageToolMode, 'html'>;
type FilesByMode = Record<UploadFileMode, PendingFile[]>;

function createEmptyFilesByMode(): FilesByMode {
  return {
    resize: [],
    stitch: [],
    split: [],
  };
}

type OutputFile = {
  id: string;
  fileName: string;
  displayName: string;
  size?: number;
  width?: number;
  height?: number;
  format?: string;
  blob?: Blob;
  source: 'web' | 'electron';
  selected: boolean;
};

type ModeCopy = {
  id: ImageToolMode;
  label: string;
  title: string;
  description: string;
  icon: LucideIcon;
};

const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp']);
const imageOutputPattern = /\.(png|jpe?g|webp|avif|gif|bmp)$/i;
const previewZoomStep = 25;
const minPreviewZoom = 25;
const maxPreviewZoom = 300;

const outputFormatOptions: Array<{ value: OutputFormat; label: string }> = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPG' },
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'gif', label: 'GIF' },
  { value: 'tiff', label: 'TIFF' },
];

function outputFormatExtension(format: OutputFormat) {
  return format === 'jpeg' ? 'jpg' : format;
}

function parseManualCutValues(raw: string) {
  const tokens = raw.split(/[,\s]+/).map(token => token.trim()).filter(Boolean);
  const invalidTokens: string[] = [];
  const values: number[] = [];

  tokens.forEach(token => {
    const value = Number(token);
    if (!Number.isFinite(value) || value <= 0) {
      invalidTokens.push(token);
      return;
    }
    values.push(Math.round(value));
  });

  return {
    values: Array.from(new Set(values)).sort((a, b) => a - b),
    invalidTokens,
  };
}

function previewSplitFileName(template: string, startIndex: number, padding: number, format: OutputFormat) {
  const sequence = Math.max(1, Math.round(startIndex || 1));
  const paddedIndex = String(sequence).padStart(Math.min(Math.max(Math.round(padding || 3), 1), 8), '0');
  const rendered = (template.trim() || '{name}_part_{index}')
    .replace(/\{name\}/g, 'sample')
    .replace(/\{index\}/g, paddedIndex)
    .replace(/\{number\}/g, paddedIndex)
    .replace(/\{n\}/g, String(sequence))
    .replace(/\{total\}/g, '12')
    .replace(/\{width\}/g, '860')
    .replace(/\{height\}/g, '3000')
    .replace(/\{start\}/g, '0')
    .replace(/\{end\}/g, '3000')
    .replace(/\{axis\}/g, 'vertical');
  return `${rendered}.${outputFormatExtension(format)}`;
}

function clampPreviewZoom(value: number) {
  return Math.min(maxPreviewZoom, Math.max(minPreviewZoom, value));
}

const modes: ModeCopy[] = [
  {
    id: 'resize',
    label: '크기 변경',
    title: '이미지 일괄 크기 변경',
    description: '업로드한 이미지를 지정 폭 기준 PNG로 변환합니다.',
    icon: Ruler,
  },
  {
    id: 'stitch',
    label: '이어붙이기',
    title: '이미지 세로 이어붙이기',
    description: '여러 이미지를 지정 폭으로 맞춘 뒤 위에서 아래로 합칩니다.',
    icon: Layers3,
  },
  {
    id: 'split',
    label: '자르기',
    title: '긴 이미지 자르기',
    description: '긴 이미지를 최대 픽셀 기준으로 여러 조각으로 나눕니다.',
    icon: Scissors,
  },
  {
    id: 'html',
    label: 'HTML 수집',
    title: 'HTML 이미지 수집',
    description: 'HTML의 이미지 링크를 수집하고 필요하면 통이미지를 생성합니다.',
    icon: Braces,
  },
];

function formatSize(bytes?: number) {
  if (!bytes) return '-';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function extensionOfName(name: string) {
  return name.split('.').pop()?.toLowerCase() || '';
}

function baseName(fileName: string) {
  return fileName.split('/').pop() || fileName;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function PreviewImage({
  source,
  alt,
  className = 'h-full w-full object-contain',
  style,
}: {
  source: Blob;
  alt: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    const nextUrl = URL.createObjectURL(source);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [source]);

  if (!url) {
    return <div className="h-full w-full animate-pulse rounded bg-gray-100" />;
  }

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      style={style}
      draggable={false}
    />
  );
}

async function readImageMetadata(file: File | Blob) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('이미지 크기를 읽을 수 없습니다.'));
      image.src = url;
    });
    return {
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function outputFilesFromWebZip(zipBlob: Blob, fallbackFileName: string) {
  const zip = await JSZip.loadAsync(zipBlob);
  const entries = Object.values(zip.files).filter(entry => !entry.dir && entry.name !== 'manifest.json');
  const outputs: OutputFile[] = [];

  for (const entry of entries) {
    const blob = await entry.async('blob');
    let dimensions: { width?: number; height?: number } = {};
    if (imageOutputPattern.test(entry.name)) {
      dimensions = await readImageMetadata(blob).catch(() => ({}));
    }

    outputs.push({
      id: crypto.randomUUID(),
      fileName: entry.name,
      displayName: baseName(entry.name),
      size: blob.size,
      width: dimensions.width,
      height: dimensions.height,
      format: extensionOfName(entry.name) || 'file',
      blob,
      source: 'web',
      selected: true,
    });
  }

  if (outputs.length === 0) {
    outputs.push({
      id: crypto.randomUUID(),
      fileName: fallbackFileName,
      displayName: fallbackFileName,
      size: zipBlob.size,
      format: 'zip',
      blob: zipBlob,
      source: 'web',
      selected: true,
    });
  }

  return outputs;
}

function outputFilesFromElectron(files: ImageProcessFile[]) {
  return files.map(file => ({
    id: crypto.randomUUID(),
    fileName: file.path || file.fileName,
    displayName: file.fileName,
    size: file.size,
    width: file.width,
    height: file.height,
    format: file.format,
    source: 'electron' as const,
    selected: true,
  }));
}

type ImageToolkitTabProps = {
  initialMode?: ImageToolMode;
};

export function ImageToolkitTab({ initialMode = 'resize' }: ImageToolkitTabProps) {
  const [activeMode, setActiveMode] = useState<ImageToolMode>(initialMode);
  const [filesByMode, setFilesByMode] = useState<FilesByMode>(() => createEmptyFilesByMode());
  const [dragging, setDragging] = useState(false);
  const [htmlText, setHtmlText] = useState('');
  const [htmlFile, setHtmlFile] = useState<File | null>(null);
  const [htmlBaseUrl, setHtmlBaseUrl] = useState('');
  const [htmlCombinedWidth, setHtmlCombinedWidth] = useState(860);
  const [resizeWidth, setResizeWidth] = useState(860);
  const [stitchWidth, setStitchWidth] = useState(860);
  const [stitchDirection, setStitchDirection] = useState<StitchDirection>('vertical');
  const [splitMaxPixels, setSplitMaxPixels] = useState(3000);
  const [splitAxis, setSplitAxis] = useState<SplitAxis>('vertical');
  const [splitStrategy, setSplitStrategy] = useState<SplitStrategy>('flow');
  const [splitOverlap, setSplitOverlap] = useState(0);
  const [splitMinLastChunkPixels, setSplitMinLastChunkPixels] = useState(300);
  const [splitSearchWindow, setSplitSearchWindow] = useState(300);
  const [splitManualCuts, setSplitManualCuts] = useState('');
  const [splitNameTemplate, setSplitNameTemplate] = useState('{name}_part_{index}');
  const [splitNameStartIndex, setSplitNameStartIndex] = useState(1);
  const [splitNamePadding, setSplitNamePadding] = useState(3);
  const [splitPreviewGap, setSplitPreviewGap] = useState(32);
  const [splitShowSectionLabels, setSplitShowSectionLabels] = useState(true);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('png');
  const [processing, setProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [outputFiles, setOutputFiles] = useState<OutputFile[]>([]);
  const [outputLocation, setOutputLocation] = useState('');
  const [bundleBlob, setBundleBlob] = useState<Blob | null>(null);
  const [bundleName, setBundleName] = useState('');
  const [previewOutputId, setPreviewOutputId] = useState('');
  const [previewZoom, setPreviewZoom] = useState(100);
  const inputRef = useRef<HTMLInputElement>(null);
  const htmlFileInputRef = useRef<HTMLInputElement>(null);
  const activeUploadMode = activeMode === 'html' ? null : activeMode;

  useEffect(() => {
    setActiveMode(initialMode);
  }, [initialMode]);
  const files = activeUploadMode ? filesByMode[activeUploadMode] : [];

  const activeModeCopy = useMemo(
    () => modes.find(mode => mode.id === activeMode) || modes[0],
    [activeMode]
  );
  const ActiveIcon = activeModeCopy.icon;
  const activeTitle =
    activeMode === 'stitch'
      ? `이미지 ${stitchDirection === 'vertical' ? '세로' : '가로'} 이어붙이기`
      : activeMode === 'split'
        ? `긴 이미지 ${splitAxis === 'vertical' ? '세로' : '가로'} 자르기`
        : activeModeCopy.title;
  const activeDescription =
    activeMode === 'stitch'
      ? `여러 이미지를 지정 ${stitchDirection === 'vertical' ? '폭' : '높이'}으로 맞춘 뒤 ${stitchDirection === 'vertical' ? '위에서 아래로' : '왼쪽에서 오른쪽으로'} 합칩니다.`
      : activeMode === 'split'
        ? `긴 이미지를 ${splitAxis === 'vertical' ? '위에서 아래로' : '왼쪽에서 오른쪽으로'} ${splitStrategy === 'flow' ? '흐름 기준' : '지정 픽셀 기준'}으로 나눕니다.`
        : activeModeCopy.description;
  const selectedOutputs = outputFiles.filter(file => file.selected);
  const parsedManualCuts = useMemo(() => parseManualCutValues(splitManualCuts), [splitManualCuts]);
  const splitFileNameSample = useMemo(
    () => previewSplitFileName(splitNameTemplate, splitNameStartIndex, splitNamePadding, outputFormat),
    [outputFormat, splitNamePadding, splitNameStartIndex, splitNameTemplate]
  );
  const previewableOutputFiles = outputFiles.filter(file => file.blob && imageOutputPattern.test(file.fileName));
  const selectedPreviewOutput = previewableOutputFiles.find(file => file.id === previewOutputId) || previewableOutputFiles[0];
  const splitPreviewOutputs = activeMode === 'split' ? previewableOutputFiles : [];
  const visiblePreviewOutputs =
    activeMode === 'split' && splitPreviewOutputs.length > 0
      ? splitPreviewOutputs
      : selectedPreviewOutput
        ? [selectedPreviewOutput]
        : [];
  const hasPreviewOutput = visiblePreviewOutputs.length > 0;
  const splitPreviewMaxWidth = splitPreviewOutputs.reduce((max, file) => Math.max(max, file.width || 0), 0);
  const previewCanvasWidth =
    activeMode === 'split' && splitPreviewMaxWidth
      ? Math.min(Math.max(splitPreviewMaxWidth, 220), 1100)
      : selectedPreviewOutput?.width
        ? Math.min(Math.max(selectedPreviewOutput.width, 220), 1200)
        : 920;
  const manualPreviewFile =
    activeMode === 'split' && splitStrategy === 'manual' && files[0] && !files[0].metadataError
      ? files[0]
      : null;
  const showManualSourcePreview = !hasPreviewOutput && Boolean(manualPreviewFile);
  const previewStatusText =
    activeMode === 'split' && splitPreviewOutputs.length > 0
      ? `${splitPreviewOutputs.length}개 섹션을 대지에 표시 중`
      : showManualSourcePreview
        ? '원본 대지에서 절단선을 클릭해 추가합니다.'
      : selectedPreviewOutput
        ? selectedPreviewOutput.displayName
        : '실행 후 결과가 대지에 표시됩니다.';
  useEffect(() => {
    const nextPreviewable = outputFiles.filter(file => file.blob && imageOutputPattern.test(file.fileName));
    if (nextPreviewable.length === 0) {
      if (previewOutputId) setPreviewOutputId('');
      return;
    }
    if (!nextPreviewable.some(file => file.id === previewOutputId)) {
      setPreviewOutputId(nextPreviewable[0].id);
    }
  }, [outputFiles, previewOutputId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;

      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setPreviewZoom(current => clampPreviewZoom(current + previewZoomStep));
        return;
      }

      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        setPreviewZoom(current => clampPreviewZoom(current - previewZoomStep));
        return;
      }

      if (event.key === '0') {
        event.preventDefault();
        setPreviewZoom(100);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const resetOutputs = () => {
    setStatusMessage(null);
    setOutputFiles([]);
    setOutputLocation('');
    setBundleBlob(null);
    setBundleName('');
    setPreviewOutputId('');
  };

  const addFiles = async (fileList: FileList | null) => {
    if (!fileList || !activeUploadMode) return;

    const nextFiles: PendingFile[] = [];
    const rejected: string[] = [];

    for (const file of Array.from(fileList)) {
      const extension = extensionOfName(file.name);
      if (!imageExtensions.has(extension)) {
        rejected.push(file.name);
        continue;
      }

      try {
        const metadata = await readImageMetadata(file);
        nextFiles.push({ id: crypto.randomUUID(), file, extension, ...metadata });
      } catch (error) {
        nextFiles.push({
          id: crypto.randomUUID(),
          file,
          extension,
          metadataError: error instanceof Error ? error.message : '이미지 크기를 읽을 수 없습니다.',
        });
      }
    }

    if (nextFiles.length > 0) {
      setFilesByMode(current => ({
        ...current,
        [activeUploadMode]: [...current[activeUploadMode], ...nextFiles],
      }));
      setErrorMessage(null);
      resetOutputs();
    }

    if (rejected.length > 0) {
      setErrorMessage(`지원하지 않는 파일 형식입니다: ${rejected.slice(0, 3).join(', ')}${rejected.length > 3 ? ' 외' : ''}`);
    }
  };

  const removeFile = (id: string) => {
    if (!activeUploadMode) return;
    setFilesByMode(current => ({
      ...current,
      [activeUploadMode]: current[activeUploadMode].filter(item => item.id !== id),
    }));
    resetOutputs();
  };

  const moveFile = (id: string, direction: -1 | 1) => {
    if (!activeUploadMode) return;
    setFilesByMode(current => {
      const currentFiles = current[activeUploadMode];
      const currentIndex = currentFiles.findIndex(item => item.id === id);
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentFiles.length) return current;

      const next = [...currentFiles];
      [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
      return {
        ...current,
        [activeUploadMode]: next,
      };
    });
    resetOutputs();
  };

  const updateHtmlFile = (file: File | null) => {
    setHtmlFile(file);
    setErrorMessage(null);
    resetOutputs();
  };

  const expectedSizeLabel = (item: PendingFile) => {
    if (item.metadataError) return item.metadataError;
    if (!item.width || !item.height) return '분석 중';

    if (activeMode === 'resize') {
      if (!resizeWidth || resizeWidth < 1) return '가로 값 필요';
      const nextHeight = Math.max(1, Math.round((item.height * resizeWidth) / item.width));
      return `${resizeWidth} x ${nextHeight}`;
    }

    if (activeMode === 'stitch') {
      if (stitchDirection === 'vertical') {
        if (!stitchWidth || stitchWidth < 1) return '가로 값 필요';
        const nextHeight = Math.max(1, Math.round((item.height * stitchWidth) / item.width));
        return `${stitchWidth} x ${nextHeight}`;
      }
      if (!stitchWidth || stitchWidth < 1) return '세로 값 필요';
      const nextWidth = Math.max(1, Math.round((item.width * stitchWidth) / item.height));
      return `${nextWidth} x ${stitchWidth}`;
    }

    if (activeMode === 'split') {
      if (!splitMaxPixels || splitMaxPixels < 100) return '100px 이상 필요';
      const sourcePixels = splitAxis === 'vertical' ? item.height : item.width;
      if (splitStrategy === 'manual') {
        const validCuts = parsedManualCuts.values.filter(cut => cut > 0 && cut < sourcePixels);
        return validCuts.length === 0 ? '수동 절단선 필요' : `${validCuts.length + 1}개 조각`;
      }
      const splitCount = Math.max(1, Math.ceil(sourcePixels / splitMaxPixels));
      return splitCount === 1 ? '분할 없음' : `${splitCount}개 조각`;
    }

    return '-';
  };

  const validateBeforeRun = () => {
    if (activeMode !== 'html' && files.length === 0) return '이미지 파일을 추가해주세요.';
    if (activeMode !== 'html' && files.some(file => file.metadataError)) return '이미지 크기를 읽을 수 없는 파일이 있습니다.';
    if (activeMode === 'html' && !htmlText.trim() && !htmlFile) return 'HTML 파일을 업로드하거나 HTML 코드를 입력해주세요.';
    if (activeMode === 'resize' && (!resizeWidth || resizeWidth < 1)) return '가로 값을 입력해주세요.';
    if (activeMode === 'stitch' && files.length < 2) return '이미지를 합치려면 최소 2개 이상의 이미지가 필요합니다.';
    if (activeMode === 'stitch' && (!stitchWidth || stitchWidth < 1)) {
      return stitchDirection === 'vertical' ? '가로 값을 입력해주세요.' : '세로 값을 입력해주세요.';
    }
    if (activeMode === 'split' && (!splitMaxPixels || splitMaxPixels < 100)) return '자르기 기준 픽셀은 100 이상이어야 합니다.';
    if (activeMode === 'split' && splitOverlap < 0) return '겹침 픽셀은 0 이상이어야 합니다.';
    if (activeMode === 'split' && splitOverlap >= splitMaxPixels) return '겹침 픽셀은 자르기 기준 픽셀보다 작아야 합니다.';
    if (activeMode === 'split' && splitMinLastChunkPixels < 0) return '마지막 조각 최소값은 0 이상이어야 합니다.';
    if (activeMode === 'split' && splitSearchWindow < 80) return '흐름 탐색 범위는 80px 이상이어야 합니다.';
    if (activeMode === 'split' && splitStrategy === 'manual' && parsedManualCuts.invalidTokens.length > 0) {
      return `수동 절단선에 숫자가 아닌 값이 있습니다: ${parsedManualCuts.invalidTokens.slice(0, 3).join(', ')}`;
    }
    if (activeMode === 'split' && splitStrategy === 'manual' && parsedManualCuts.values.length === 0) return '수동 절단선 픽셀 값을 입력해주세요.';
    if (activeMode === 'split' && !splitNameTemplate.trim()) return '파일명 규칙을 입력해주세요.';
    if (activeMode === 'split' && splitNameStartIndex < 1) return '파일명 시작 번호는 1 이상이어야 합니다.';
    if (activeMode === 'split' && (splitNamePadding < 1 || splitNamePadding > 8)) return '번호 자릿수는 1~8 사이로 입력해주세요.';
    if (activeMode === 'split' && splitPreviewGap < 0) return '대지 섹션 간격은 0 이상이어야 합니다.';
    return '';
  };

  const runActiveMode = async () => {
    const validationError = validateBeforeRun();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setProcessing(true);
    setErrorMessage(null);
    resetOutputs();
    setStatusMessage(
      activeMode === 'resize'
        ? '이미지 크기 변경 중'
        : activeMode === 'stitch'
          ? '이미지 이어붙이는 중'
          : activeMode === 'split'
            ? '이미지 자르는 중'
            : 'HTML 이미지 링크 분석 중'
    );

    try {
      const options =
        activeMode === 'resize'
          ? {
              mode: 'width' as const,
              targetWidth: resizeWidth,
              outputFormat,
              quality: 92,
              preventUpscale: false,
            }
          : activeMode === 'stitch'
            ? {
                direction: stitchDirection,
                matchPolicy: 'resize-to-target' as const,
                targetWidth: stitchDirection === 'vertical' ? stitchWidth : undefined,
                targetHeight: stitchDirection === 'horizontal' ? stitchWidth : undefined,
                gap: 0,
                background: '#ffffff',
                outputFormat,
                quality: 92,
              }
            : activeMode === 'split'
              ? {
                  axis: splitAxis,
                  strategy: splitStrategy,
                  maxPixels: splitMaxPixels,
                  overlap: splitStrategy === 'manual' ? 0 : splitOverlap,
                  minLastChunkPixels: splitMinLastChunkPixels,
                  searchWindow: splitSearchWindow,
                  manualCuts: splitStrategy === 'manual' ? parsedManualCuts.values : undefined,
                  fileNameTemplate: splitNameTemplate,
                  fileNameStartIndex: splitNameStartIndex,
                  fileNamePadding: splitNamePadding,
                  outputFormat,
                  quality: 92,
                }
              : {
                  baseUrl: htmlBaseUrl.trim() || undefined,
                  downloadOriginalImages: true,
                  createCombinedImage: true,
                  combinedTargetWidth: htmlCombinedWidth || undefined,
                  outputFormat,
                  quality: 92,
                  includeManifest: true,
                };

      const result = await runImageProcess(
        activeMode,
        activeMode === 'html' ? [] : files.map(item => item.file),
        options,
        activeMode === 'html' ? { htmlText, htmlFile } : {}
      );

      if (!result) {
        setStatusMessage('저장 폴더 선택이 취소되었습니다.');
        return;
      }

      if (result.mode === 'web' && result.zipBlob) {
        const outputs = await outputFilesFromWebZip(result.zipBlob, result.downloadedFileName || 'image_results.zip');
        setOutputFiles(outputs);
        setBundleBlob(result.zipBlob);
        setBundleName(result.downloadedFileName || 'image_results.zip');
        setOutputLocation('Web 결과가 준비되었습니다. 필요한 파일만 선택해서 다운로드하세요.');
        setStatusMessage('처리 완료');
      } else if (result.mode === 'electron') {
        setOutputFiles(outputFilesFromElectron(result.files || []));
        setOutputLocation(result.saveDirectory);
        setStatusMessage('처리 완료');
      } else {
        setErrorMessage('처리 결과를 확인할 수 없습니다.');
        setStatusMessage(null);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '이미지 처리 중 오류가 발생했습니다.');
      setStatusMessage(null);
    } finally {
      setProcessing(false);
    }
  };

  const toggleOutput = (id: string) => {
    setOutputFiles(current => current.map(file => file.id === id ? { ...file, selected: !file.selected } : file));
  };

  const setAllOutputsSelected = (selected: boolean) => {
    setOutputFiles(current => current.map(file => ({ ...file, selected })));
  };

  const adjustPreviewZoom = (delta: number) => {
    setPreviewZoom(current => clampPreviewZoom(current + delta));
  };

  const updateManualCuts = (values: number[]) => {
    const nextValues = Array.from(new Set(values.filter(value => value > 0))).sort((a, b) => a - b);
    setSplitManualCuts(nextValues.join(', '));
    resetOutputs();
  };

  const addManualCutFromPreview = (event: MouseEvent<HTMLDivElement>, item: PendingFile) => {
    if (!item.width || !item.height) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const axisLength = splitAxis === 'vertical' ? item.height : item.width;
    const rawOffset =
      splitAxis === 'vertical'
        ? event.clientY - rect.top
        : event.clientX - rect.left;
    const renderedLength = splitAxis === 'vertical' ? rect.height : rect.width;
    const coordinate = Math.round((rawOffset / Math.max(1, renderedLength)) * axisLength);

    if (coordinate <= 0 || coordinate >= axisLength) return;
    updateManualCuts([...parsedManualCuts.values, coordinate]);
  };

  const removeManualCut = (coordinate: number) => {
    updateManualCuts(parsedManualCuts.values.filter(value => value !== coordinate));
  };

  const downloadOne = (file: OutputFile) => {
    if (!file.blob) {
      setStatusMessage('Electron 결과는 이미 선택한 폴더에 저장되어 있습니다.');
      return;
    }
    downloadBlob(file.blob, file.displayName);
  };

  const downloadSelected = async () => {
    const filesToDownload = selectedOutputs.filter(file => file.blob);
    if (filesToDownload.length === 0) {
      setErrorMessage('다운로드할 결과 파일을 선택해주세요.');
      return;
    }

    if (filesToDownload.length === 1 && filesToDownload[0].blob) {
      downloadBlob(filesToDownload[0].blob, filesToDownload[0].displayName);
      return;
    }

    const zip = new JSZip();
    filesToDownload.forEach(file => {
      if (file.blob) zip.file(file.fileName, file.blob);
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `${activeMode}_selected_results.zip`);
  };

  const downloadAll = async () => {
    if (bundleBlob) {
      downloadBlob(bundleBlob, bundleName || 'image_results.zip');
      return;
    }
    await downloadSelected();
  };

  const clearAll = () => {
    setFilesByMode(createEmptyFilesByMode());
    setHtmlText('');
    setHtmlFile(null);
    setErrorMessage(null);
    setPreviewZoom(100);
    resetOutputs();
  };

  return (
    <div className="flex h-full w-full flex-col bg-[#fbfcfd] bg-[radial-gradient(circle_at_1px_1px,rgba(15,23,42,0.08)_1px,transparent_0)] [background-size:22px_22px]">
      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden px-4 py-4 sm:px-6 xl:grid-cols-[240px_minmax(650px,1fr)_300px]">
        <aside className="min-h-0 overflow-y-auto">
          <div className="rounded-2xl border border-slate-200 bg-white/90 p-2 shadow-sm">
            {modes.map(mode => {
              const Icon = mode.icon;
              const selected = activeMode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => {
                    setActiveMode(mode.id);
                    setErrorMessage(null);
                    resetOutputs();
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition',
                    selected ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-950'
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-black">{mode.label}</p>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-xs font-black text-slate-900">
              <ActiveIcon className="h-4 w-4" />
              옵션
            </div>
            <div className="grid gap-3">
              {activeMode === 'resize' && (
                <>
                  <label className="grid gap-1 text-xs font-semibold text-gray-500">
                    기준 폭
                    <input
                      className="w-full min-w-0 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-400"
                      type="number"
                      min={1}
                      value={resizeWidth}
                      onChange={event => setResizeWidth(Number(event.target.value))}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-gray-500">
                    출력 포맷
                    <select
                      className="w-full min-w-0 rounded-md border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-gray-400"
                      value={outputFormat}
                      onChange={event => {
                        setOutputFormat(event.target.value as OutputFormat);
                        resetOutputs();
                      }}
                    >
                      {outputFormatOptions.map(format => (
                        <option key={format.value} value={format.value}>{format.label}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {activeMode === 'stitch' && (
                <>
                  <label className="grid gap-1 text-xs font-semibold text-gray-500">
                    방향
                    <select
                      className="w-full min-w-0 rounded-md border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-gray-400"
                      value={stitchDirection}
                      onChange={event => {
                        setStitchDirection(event.target.value as StitchDirection);
                        resetOutputs();
                      }}
                    >
                      <option value="vertical">세로</option>
                      <option value="horizontal">가로</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-gray-500">
                    {stitchDirection === 'vertical' ? '기준 폭' : '기준 높이'}
                    <input
                      className="w-full min-w-0 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-400"
                      type="number"
                      min={1}
                      value={stitchWidth}
                      onChange={event => setStitchWidth(Number(event.target.value))}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-gray-500">
                    출력 포맷
                    <select
                      className="w-full min-w-0 rounded-md border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-gray-400"
                      value={outputFormat}
                      onChange={event => {
                        setOutputFormat(event.target.value as OutputFormat);
                        resetOutputs();
                      }}
                    >
                      {outputFormatOptions.map(format => (
                        <option key={format.value} value={format.value}>{format.label}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {activeMode === 'split' && (
                <>
                  <label className="grid gap-1 text-xs font-semibold text-gray-500">
                    자르기 방식
                    <select
                      className="w-full min-w-0 rounded-md border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-gray-400"
                      value={splitStrategy}
                      onChange={event => {
                        setSplitStrategy(event.target.value as SplitStrategy);
                        resetOutputs();
                      }}
                    >
                      <option value="flow">흐름 기준</option>
                      <option value="fixed">고정 픽셀</option>
                      <option value="manual">수동 절단선</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-gray-500">
                    기준 축
                    <select
                      className="w-full min-w-0 rounded-md border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-gray-400"
                      value={splitAxis}
                      onChange={event => {
                        setSplitAxis(event.target.value as SplitAxis);
                        resetOutputs();
                      }}
                    >
                      <option value="vertical">세로</option>
                      <option value="horizontal">가로</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-gray-500">
                    {splitAxis === 'vertical' ? '최대 높이(px)' : '최대 폭(px)'}
                    <input
                      className="w-full min-w-0 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-400"
                      type="number"
                      min={100}
                      value={splitMaxPixels}
                      onChange={event => setSplitMaxPixels(Number(event.target.value))}
                    />
                  </label>
                  {splitStrategy === 'manual' ? (
                    <label className="grid gap-1 border-t border-gray-100 pt-3 text-xs font-semibold text-gray-500">
                      수동 절단선(px)
                      <textarea
                        className="min-h-20 w-full min-w-0 resize-y rounded-md border border-gray-200 px-3 py-2 font-mono text-xs leading-5 text-gray-800 outline-none focus:border-gray-400"
                        value={splitManualCuts}
                        onChange={event => {
                          setSplitManualCuts(event.target.value);
                          resetOutputs();
                        }}
                        placeholder="3000, 6120, 9040"
                      />
                      <span className="text-[11px] font-medium leading-4 text-gray-400">
                        {splitAxis === 'vertical' ? '위에서부터' : '왼쪽에서부터'}의 절단 위치를 쉼표나 줄바꿈으로 입력합니다.
                      </span>
                    </label>
                  ) : (
                    <div className="grid gap-3 border-t border-gray-100 pt-3">
                      <label className="grid gap-1 text-xs font-semibold text-gray-500">
                        겹침(px)
                        <input
                          className="w-full min-w-0 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-400"
                          type="number"
                          min={0}
                          value={splitOverlap}
                          onChange={event => {
                            setSplitOverlap(Number(event.target.value));
                            resetOutputs();
                          }}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-semibold text-gray-500">
                        마지막 조각 최소(px)
                        <input
                          className="w-full min-w-0 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-400"
                          type="number"
                          min={0}
                          value={splitMinLastChunkPixels}
                          onChange={event => {
                            setSplitMinLastChunkPixels(Number(event.target.value));
                            resetOutputs();
                          }}
                        />
                      </label>
                      {splitStrategy === 'flow' && (
                        <label className="grid gap-1 text-xs font-semibold text-gray-500">
                          흐름 탐색 범위(px)
                          <input
                            className="w-full min-w-0 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-400"
                            type="number"
                            min={80}
                            value={splitSearchWindow}
                            onChange={event => {
                              setSplitSearchWindow(Number(event.target.value));
                              resetOutputs();
                            }}
                          />
                        </label>
                      )}
                    </div>
                  )}
                  <div className="grid gap-3 border-t border-gray-100 pt-3">
                    <label className="grid gap-1 text-xs font-semibold text-gray-500">
                      파일명 규칙
                      <input
                        className="w-full min-w-0 rounded-md border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 outline-none focus:border-gray-400"
                        value={splitNameTemplate}
                        onChange={event => {
                          setSplitNameTemplate(event.target.value);
                          resetOutputs();
                        }}
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="grid gap-1 text-xs font-semibold text-gray-500">
                        시작 번호
                        <input
                          className="w-full min-w-0 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-400"
                          type="number"
                          min={1}
                          value={splitNameStartIndex}
                          onChange={event => {
                            setSplitNameStartIndex(Number(event.target.value));
                            resetOutputs();
                          }}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-semibold text-gray-500">
                        번호 자릿수
                        <input
                          className="w-full min-w-0 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-400"
                          type="number"
                          min={1}
                          max={8}
                          value={splitNamePadding}
                          onChange={event => {
                            setSplitNamePadding(Number(event.target.value));
                            resetOutputs();
                          }}
                        />
                      </label>
                    </div>
                    <p className="truncate rounded bg-gray-50 px-2 py-1 font-mono text-[11px] font-medium text-gray-400">
                      예: {splitFileNameSample}
                    </p>
                  </div>
                  <div className="grid gap-3 border-t border-gray-100 pt-3">
                    <label className="grid gap-1 text-xs font-semibold text-gray-500">
                      대지 섹션 간격(px)
                      <input
                        className="w-full min-w-0 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-400"
                        type="number"
                        min={0}
                        value={splitPreviewGap}
                        onChange={event => setSplitPreviewGap(Number(event.target.value))}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs font-semibold text-gray-500">
                      <input
                        type="checkbox"
                        checked={splitShowSectionLabels}
                        onChange={event => setSplitShowSectionLabels(event.target.checked)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      섹션명과 가로세로 표시
                    </label>
                  </div>
                  <label className="grid gap-1 text-xs font-semibold text-gray-500">
                    출력 포맷
                    <select
                      className="w-full min-w-0 rounded-md border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-gray-400"
                      value={outputFormat}
                      onChange={event => {
                        setOutputFormat(event.target.value as OutputFormat);
                        resetOutputs();
                      }}
                    >
                      {outputFormatOptions.map(format => (
                        <option key={format.value} value={format.value}>{format.label}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {activeMode === 'html' && (
                <>
                  <label className="grid gap-1 text-xs font-semibold text-gray-500">
                    baseUrl
                    <input
                      className="w-full min-w-0 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-400"
                      value={htmlBaseUrl}
                      onChange={event => setHtmlBaseUrl(event.target.value)}
                      placeholder="https://example.com/"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-gray-500">
                    통이미지 폭
                    <input
                      className="w-full min-w-0 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-400"
                      type="number"
                      min={1}
                      value={htmlCombinedWidth}
                      onChange={event => setHtmlCombinedWidth(Number(event.target.value))}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-gray-500">
                    출력 포맷
                    <select
                      className="w-full min-w-0 rounded-md border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-gray-400"
                      value={outputFormat}
                      onChange={event => {
                        setOutputFormat(event.target.value as OutputFormat);
                        resetOutputs();
                      }}
                    >
                      {outputFormatOptions.map(format => (
                        <option key={format.value} value={format.value}>{format.label}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white/90 shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <div className="grid gap-3 2xl:grid-cols-[minmax(320px,0.78fr)_minmax(560px,1.55fr)]">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 2xl:col-start-1">
                <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <ActiveIcon className="h-4 w-4 text-slate-900" />
                  <h3 className="text-base font-black tracking-tight text-slate-950">{activeTitle}</h3>
                </div>
                <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">{activeDescription}</p>
                </div>
              <button
                type="button"
                onClick={() => void runActiveMode()}
                disabled={processing || Boolean(validateBeforeRun())}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition',
                  processing || Boolean(validateBeforeRun())
                    ? 'cursor-not-allowed bg-slate-100 text-slate-300'
                    : 'bg-slate-950 text-white hover:bg-slate-800'
                )}
              >
                {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {processing
                  ? '처리 중'
                  : activeMode === 'resize'
                    ? '크기 변경 실행'
                    : activeMode === 'stitch'
                      ? '이어붙이기 실행'
                      : activeMode === 'split'
                        ? '자르기 실행'
                        : 'HTML 수집 실행'}
              </button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 p-5 2xl:grid-cols-[minmax(320px,0.78fr)_minmax(560px,1.55fr)] 2xl:items-start">
            {errorMessage && (
              <div className="flex items-center gap-2 rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 2xl:col-start-1 2xl:row-start-1">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1">{errorMessage}</span>
                <button type="button" onClick={() => setErrorMessage(null)} className="text-red-400 hover:text-red-700">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {statusMessage && (
              <div className="rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-600 2xl:col-start-1 2xl:row-start-1">
                {statusMessage}
              </div>
            )}

            {activeMode === 'html' ? (
              <section
                className={cn(
                  'grid gap-3 2xl:col-start-1 2xl:row-start-1',
                  errorMessage || statusMessage ? '2xl:mt-14' : ''
                )}
              >
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => htmlFileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                  >
                    <Upload className="h-4 w-4" />
                    HTML 파일 선택
                  </button>
                  <input
                    ref={htmlFileInputRef}
                    type="file"
                    accept=".html,.htm,text/html"
                    className="hidden"
                    onChange={event => updateHtmlFile(event.target.files?.[0] || null)}
                  />
                  {htmlFile && (
                    <button
                      type="button"
                      onClick={() => updateHtmlFile(null)}
                      className="rounded-md border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-500 transition hover:bg-gray-50 hover:text-red-500"
                    >
                      HTML 파일 제거
                    </button>
                  )}
                </div>
                {htmlFile && (
                  <div className="rounded-md border border-gray-100 bg-gray-50 px-4 py-3">
                    <p className="truncate text-sm font-semibold text-gray-800">{htmlFile.name}</p>
                    <p className="mt-0.5 text-xs font-mono text-gray-400">{formatSize(htmlFile.size)}</p>
                  </div>
                )}
                <textarea
                  value={htmlText}
                  onChange={event => {
                    setHtmlText(event.target.value);
                    resetOutputs();
                  }}
                  placeholder="<img src=&quot;https://example.com/image.jpg&quot;>"
                  className="min-h-32 max-h-44 resize-y rounded-md border border-gray-200 px-4 py-3 font-mono text-xs leading-6 text-gray-700 outline-none transition placeholder:text-gray-300 focus:border-gray-400"
                />
              </section>
            ) : (
              <div
                onDragOver={event => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={event => {
                  event.preventDefault();
                  setDragging(false);
                  void addFiles(event.dataTransfer.files);
                }}
                onClick={() => inputRef.current?.click()}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border py-5 text-center transition 2xl:col-start-1 2xl:row-start-1',
                  errorMessage || statusMessage ? '2xl:mt-14' : '',
                  dragging ? 'border-gray-400 bg-gray-50' : 'border-dashed border-gray-200 hover:border-gray-300 hover:bg-gray-50/60'
                )}
              >
                <ImageDown className="h-5 w-5 text-gray-300" />
                <p className="text-sm font-semibold text-gray-500">이미지 파일을 드래그하거나 클릭하여 추가</p>
                <p className="text-xs font-medium text-gray-300">PNG · JPG · JPEG · WebP</p>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={event => void addFiles(event.target.files)}
                />
              </div>
            )}

            <section className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-100/80 2xl:col-start-2 2xl:row-start-1 2xl:row-span-3 2xl:-mt-[150px] 2xl:h-[calc(100vh-66px)] 2xl:min-h-[850px]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Eye className="h-4 w-4 text-slate-500" />
                    <p className="text-xs font-black text-slate-900">결과 미리보기</p>
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">
                      {previewableOutputFiles.length}개
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs font-medium text-gray-400">
                    {previewStatusText}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => adjustPreviewZoom(-25)}
                    disabled={!hasPreviewOutput || previewZoom <= 25}
                    title="축소"
                    className={cn(
                      'rounded-md border border-gray-200 p-2 transition',
                      !hasPreviewOutput || previewZoom <= 25
                        ? 'cursor-not-allowed text-gray-200'
                        : 'bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                    )}
                  >
                    <ZoomOut className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewZoom(100)}
                    disabled={!hasPreviewOutput}
                    title="100%로 보기"
                    className={cn(
                      'inline-flex min-w-16 items-center justify-center gap-1 rounded-md border border-gray-200 px-2 py-2 text-xs font-bold transition',
                      !hasPreviewOutput
                        ? 'cursor-not-allowed text-gray-200'
                        : 'bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    )}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {previewZoom}%
                  </button>
                  <button
                    type="button"
                    onClick={() => adjustPreviewZoom(25)}
                    disabled={!hasPreviewOutput || previewZoom >= 300}
                    title="확대"
                    className={cn(
                      'rounded-md border border-gray-200 p-2 transition',
                      !hasPreviewOutput || previewZoom >= 300
                        ? 'cursor-not-allowed text-gray-200'
                        : 'bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                    )}
                  >
                    <ZoomIn className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div
                className="h-[660px] flex-1 overflow-auto bg-[#e8eaee] p-4 2xl:h-auto 2xl:min-h-0"
                style={{
                  backgroundImage:
                    'linear-gradient(rgba(148,163,184,.22) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.22) 1px, transparent 1px)',
                  backgroundSize: '24px 24px',
                }}
              >
                {hasPreviewOutput ? (
                  <div className="flex min-h-full min-w-full items-center justify-center">
                    <div
                      className={cn(
                        'inline-flex rounded-sm shadow-xl',
                        activeMode === 'split'
                          ? 'flex-col border border-gray-300 bg-gray-200/80 p-6'
                          : 'inline-block border border-gray-300 bg-white p-4'
                      )}
                      style={activeMode === 'split' ? { gap: `${splitPreviewGap}px` } : undefined}
                    >
                      {visiblePreviewOutputs.map((file, index) => (
                        <div
                          key={file.id}
                          className={cn(
                            'relative',
                            activeMode === 'split'
                              ? 'overflow-hidden rounded-sm border border-gray-300 bg-white shadow-md ring-1 ring-white/70'
                              : ''
                          )}
                        >
                          {activeMode === 'split' && splitShowSectionLabels && (
                            <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-md border border-gray-200 bg-white/95 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-gray-500 shadow-sm">
                              Section {String(index + 1).padStart(2, '0')}
                              {file.width && file.height ? ` · ${file.width} x ${file.height}` : ''}
                            </div>
                          )}
                          <PreviewImage
                            source={file.blob as Blob}
                            alt={file.displayName}
                            className="block h-auto max-h-none max-w-none object-contain"
                            style={{
                              width: `${Math.round((
                                activeMode === 'split'
                                  ? Math.min(Math.max(file.width || previewCanvasWidth, 220), 1200)
                                  : previewCanvasWidth
                              ) * previewZoom / 100)}px`,
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : showManualSourcePreview && manualPreviewFile ? (
                  <div className="flex min-h-full min-w-full items-center justify-center">
                    <div className="inline-flex flex-col overflow-hidden rounded-sm border border-gray-300 bg-white shadow-xl">
                      <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-black text-gray-800">수동 절단선 조정</p>
                          <p className="mt-0.5 truncate text-[11px] font-medium text-gray-400">
                            대지를 클릭하면 {splitAxis === 'vertical' ? '가로 절단선' : '세로 절단선'}이 추가됩니다.
                          </p>
                        </div>
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">
                          {parsedManualCuts.values.length}개
                        </span>
                      </div>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={event => addManualCutFromPreview(event, manualPreviewFile)}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
                        }}
                        className="relative cursor-crosshair bg-white"
                        style={{
                          width: `${Math.round(Math.min(Math.max(manualPreviewFile.width || previewCanvasWidth, 220), 1200) * previewZoom / 100)}px`,
                        }}
                        title="클릭해서 절단선 추가"
                      >
                        <PreviewImage
                          source={manualPreviewFile.file}
                          alt={manualPreviewFile.file.name}
                          className="block h-auto w-full max-w-none object-contain"
                        />
                        {parsedManualCuts.values
                          .filter(cut => {
                            const axisLength = splitAxis === 'vertical' ? manualPreviewFile.height || 0 : manualPreviewFile.width || 0;
                            return cut > 0 && cut < axisLength;
                          })
                          .map(cut => {
                            const axisLength = splitAxis === 'vertical' ? manualPreviewFile.height || 1 : manualPreviewFile.width || 1;
                            const percent = (cut / axisLength) * 100;
                            return (
                              <button
                                key={cut}
                                type="button"
                                onClick={event => {
                                  event.stopPropagation();
                                  removeManualCut(cut);
                                }}
                                className={cn(
                                  'absolute z-10 text-left text-[10px] font-black text-violet-700',
                                  splitAxis === 'vertical'
                                    ? 'left-0 right-0 -translate-y-1/2 border-t-2 border-violet-500'
                                    : 'top-0 bottom-0 -translate-x-1/2 border-l-2 border-violet-500'
                                )}
                                style={
                                  splitAxis === 'vertical'
                                    ? { top: `${percent}%` }
                                    : { left: `${percent}%` }
                                }
                                title={`${cut}px 절단선 제거`}
                              >
                                <span
                                  className={cn(
                                    'inline-block rounded border border-violet-200 bg-white px-1.5 py-0.5 shadow-sm',
                                    splitAxis === 'vertical' ? 'ml-2 -mt-3' : 'ml-1 mt-2'
                                  )}
                                >
                                  {cut}px 삭제
                                </span>
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <div className="flex min-h-[360px] w-[88%] max-w-4xl flex-col items-center justify-center rounded-sm border border-dashed border-gray-300 bg-white text-center shadow-sm">
                      <ImageDown className="h-8 w-8 text-gray-300" />
                      <p className="mt-3 text-sm font-bold text-gray-500">아직 표시할 결과가 없습니다.</p>
                      <p className="mt-1 text-xs font-medium text-gray-300">작업을 실행하면 이 대지에서 결과를 확대해서 볼 수 있습니다.</p>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section
              className={cn(
                'rounded-md border border-gray-100 2xl:col-start-1 2xl:row-start-1',
                errorMessage || statusMessage ? '2xl:mt-[210px]' : '2xl:mt-[150px]'
              )}
            >
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                <div>
                  <p className="text-sm font-black text-gray-900">업로드한 파일 목록</p>
                  <p className="mt-1 text-xs font-medium text-gray-400">
                    {activeMode === 'html'
                      ? 'HTML 입력을 분석해 이미지 링크를 수집합니다.'
                      : activeMode === 'stitch'
                        ? `${files.length}개 이미지 · 이 순서대로 위에서 아래로 이어붙입니다.`
                        : `${files.length}개 이미지`}
                  </p>
                </div>
                {files.length > 0 && activeMode !== 'html' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (activeUploadMode) {
                        setFilesByMode(current => ({
                          ...current,
                          [activeUploadMode]: [],
                        }));
                      }
                      resetOutputs();
                    }}
                    className="text-xs font-semibold text-gray-400 transition hover:text-red-500"
                  >
                    전체 제거
                  </button>
                )}
              </div>

              {activeMode === 'html' ? (
                <div className="px-4 py-6 text-sm font-medium text-gray-400">
                  HTML 파일 또는 붙여넣은 코드가 입력 파일 역할을 합니다.
                </div>
              ) : files.length > 0 ? (
                <ul className="max-h-[440px] divide-y divide-gray-100 overflow-y-auto">
                  {files.map((item, index) => (
                    <li key={item.id} className="grid grid-cols-[26px_52px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
                      <span className="text-xs font-mono text-gray-300">{index + 1}</span>
                      <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-md border border-gray-100 bg-gray-50 p-1">
                        <PreviewImage source={item.file} alt={item.file.name} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="w-fit rounded-md bg-gray-100 px-2 py-1 text-[10px] font-black uppercase text-gray-500">
                            {item.extension}
                          </span>
                          <p className="truncate text-sm font-semibold text-gray-800">{item.file.name}</p>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono text-gray-400">
                          <span>{formatSize(item.file.size)}</span>
                          <span className={item.metadataError ? 'text-red-400' : ''}>
                            원본 {item.metadataError ? '읽기 실패' : item.width && item.height ? `${item.width} x ${item.height}` : '-'}
                          </span>
                          <span>예상 {expectedSizeLabel(item)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {activeMode === 'stitch' && (
                          <>
                            <button
                              type="button"
                              onClick={() => moveFile(item.id, -1)}
                              disabled={index === 0}
                              title="위로 이동"
                              className={cn(
                                'rounded-md border border-gray-200 p-1.5 transition',
                                index === 0
                                  ? 'cursor-not-allowed text-gray-200'
                                  : 'text-gray-400 hover:bg-gray-50 hover:text-gray-900'
                              )}
                              aria-label={`${item.file.name} 위로 이동`}
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveFile(item.id, 1)}
                              disabled={index === files.length - 1}
                              title="아래로 이동"
                              className={cn(
                                'rounded-md border border-gray-200 p-1.5 transition',
                                index === files.length - 1
                                  ? 'cursor-not-allowed text-gray-200'
                                  : 'text-gray-400 hover:bg-gray-50 hover:text-gray-900'
                              )}
                              aria-label={`${item.file.name} 아래로 이동`}
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => removeFile(item.id)}
                          className="rounded-md p-1.5 text-gray-300 transition hover:bg-red-50 hover:text-red-500"
                          aria-label={`${item.file.name} 제거`}
                          title="삭제"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="px-4 py-6 text-sm font-medium text-gray-400">
                  추가된 이미지 파일이 없습니다.
                </div>
              )}
            </section>
          </div>
        </main>

          <aside className="min-h-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white/90 shadow-sm">
          <div className="border-b border-gray-100 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black text-slate-900">수정한 파일 목록</p>
                <p className="mt-1 text-xs font-medium text-gray-400">
                  결과를 확인한 뒤 필요한 파일만 다운로드합니다.
                </p>
              </div>
              {outputFiles.length > 0 && (
                <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
                  {outputFiles.length}개
                </span>
              )}
            </div>
          </div>

          <div className="grid gap-4 p-5">
            {outputLocation && (
              <div className="rounded-md border border-emerald-100 bg-emerald-50 px-3 py-3 text-xs font-semibold leading-5 text-emerald-700">
                {outputLocation}
              </div>
            )}

            {outputFiles.length > 0 ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setAllOutputsSelected(true)}
                    className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
                  >
                    전체 선택
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllOutputsSelected(false)}
                    className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
                  >
                    선택 해제
                  </button>
                </div>

                <ul className="divide-y divide-gray-100 rounded-md border border-gray-100">
                  {outputFiles.map(file => {
                    const canPreview = Boolean(file.blob && imageOutputPattern.test(file.fileName));
                    const previewing = activeMode === 'split' ? canPreview : selectedPreviewOutput?.id === file.id;
                    return (
                    <li
                      key={file.id}
                      className={cn(
                        'grid gap-3 px-3 py-3 transition',
                        activeMode !== 'split' && previewing ? 'bg-gray-50' : ''
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={file.selected}
                          onChange={() => toggleOutput(file.id)}
                          className="mt-1 h-4 w-4 rounded border-gray-300"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (canPreview) setPreviewOutputId(file.id);
                          }}
                          disabled={!canPreview}
                          className={cn(
                            'min-w-0 flex-1 rounded-md text-left transition',
                            canPreview ? 'cursor-pointer hover:text-gray-950' : 'cursor-default'
                          )}
                          title={canPreview ? '중앙 대지에서 미리보기' : undefined}
                        >
                          <p className="truncate text-sm font-semibold text-gray-800">{file.displayName}</p>
                          <p className="mt-1 truncate text-[11px] font-mono text-gray-400">{file.fileName}</p>
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-mono text-gray-500">
                            {file.width && file.height && <span>{file.width} x {file.height}</span>}
                            <span>{formatSize(file.size)}</span>
                            {file.format && <span>{file.format.toUpperCase()}</span>}
                            {canPreview && (
                              <span>
                                {activeMode === 'split' ? '대지 포함' : previewing ? '대지 표시 중' : '대지 보기'}
                              </span>
                            )}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadOne(file)}
                          className="rounded-md border border-gray-200 p-2 text-gray-500 transition hover:bg-gray-50 hover:text-gray-900"
                          aria-label={`${file.displayName} 다운로드`}
                        >
                          <Download className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                    );
                  })}
                </ul>

                <div className="grid gap-2">
                  <button
                    type="button"
                    onClick={() => void downloadSelected()}
                    disabled={selectedOutputs.length === 0}
                    className={cn(
                      'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition',
                      selectedOutputs.length === 0
                        ? 'cursor-not-allowed bg-slate-100 text-slate-300'
                        : 'bg-slate-950 text-white hover:bg-slate-800'
                    )}
                  >
                    <Download className="h-4 w-4" />
                    선택 다운로드
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadAll()}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-4 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                  >
                    <Download className="h-4 w-4" />
                    전체 한번에 다운로드
                  </button>
                </div>
              </>
            ) : (
              <div className="rounded-md border border-dashed border-gray-200 px-4 py-8 text-center">
                <Download className="mx-auto h-6 w-6 text-gray-300" />
                <p className="mt-3 text-sm font-semibold text-gray-500">아직 수정된 파일이 없습니다.</p>
                <p className="mt-1 text-xs font-medium text-gray-300">실행 후 결과가 이곳에 표시됩니다.</p>
              </div>
            )}

            <div className="flex justify-end border-t border-gray-100 pt-4">
              <button
                type="button"
                onClick={clearAll}
                className="rounded-md border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                초기화
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
