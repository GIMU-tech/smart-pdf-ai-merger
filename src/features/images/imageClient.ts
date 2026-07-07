import type { HtmlCollectorOptions, ResizeOptions, SplitOptions, StitchOptions } from './types';

export type ImageProcessOperation = 'resize' | 'stitch' | 'split' | 'html';

type ImageProcessOptions = ResizeOptions | StitchOptions | SplitOptions | HtmlCollectorOptions;

export type ImageProcessFile = {
  path: string;
  fileName: string;
  sourceName?: string;
  width?: number;
  height?: number;
  format?: string;
  size?: number;
  blob?: Blob;
};

export type ImageProcessResult = {
  success: boolean;
  files?: ImageProcessFile[];
  manifest?: {
    operation: string;
    count: number;
    options?: unknown;
  };
  error?: string;
  zipBlob?: Blob;
  downloadedFileName?: string;
};

type ElectronImageProcessRequest = {
  operation: ImageProcessOperation;
  inputPaths: string[];
  saveDirectory: string;
  options: ImageProcessOptions;
  htmlText?: string;
  htmlFilePath?: string;
  allowLocalUrls?: boolean;
  allowFileUrls?: boolean;
};

type HtmlInput = {
  htmlText?: string;
  htmlFile?: File | null;
};

type ElectronApi = {
  isElectron?: () => boolean;
  selectDirectory?: (args?: { title?: string; buttonLabel?: string }) => Promise<string | null>;
  imageProcess?: (args: ElectronImageProcessRequest) => Promise<ImageProcessResult>;
  getPathForFile?: (file: File) => string;
};

declare global {
  interface Window {
    electronAPI?: ElectronApi;
  }
}

export function isElectronImageProcessingAvailable() {
  return Boolean(
    window.electronAPI?.imageProcess &&
    window.electronAPI?.getPathForFile &&
    window.electronAPI?.selectDirectory
  );
}

function apiBaseUrl() {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://localhost:8080';
  }
  return window.location.origin;
}

function decodeHeaderFileName(value: string | null, fallback: string) {
  if (!value) return fallback;
  try {
    return decodeURIComponent(value);
  } catch (err) {
    return value || fallback;
  }
}

async function runElectronImageProcess(operation: ImageProcessOperation, files: File[], options: ImageProcessOptions, htmlInput: HtmlInput = {}) {
  const api = window.electronAPI;
  if (!api?.imageProcess || !api.getPathForFile || !api.selectDirectory) {
    return null;
  }

  if (operation !== 'html' && files.length === 0) {
    throw new Error('이미지 파일을 추가해주세요.');
  }

  if (operation === 'html' && !htmlInput.htmlText?.trim() && !htmlInput.htmlFile) {
    throw new Error('HTML 파일을 업로드하거나 HTML 코드를 입력해주세요.');
  }

  const saveDirectory = await api.selectDirectory({
    title: '이미지 결과 저장 폴더 선택',
    buttonLabel: '저장 폴더 선택',
  });

  if (!saveDirectory) {
    return null;
  }

  const inputPaths = files.map(file => api.getPathForFile?.(file) || '');
  if (inputPaths.some(filePath => !filePath)) {
    throw new Error('선택한 파일의 로컬 경로를 읽을 수 없습니다.');
  }

  const htmlFilePath = htmlInput.htmlFile ? api.getPathForFile(htmlInput.htmlFile) : '';
  if (operation === 'html' && htmlInput.htmlFile && !htmlFilePath) {
    throw new Error('선택한 HTML 파일의 로컬 경로를 읽을 수 없습니다.');
  }

  const result = await api.imageProcess({
    operation,
    inputPaths,
    saveDirectory,
    options,
    htmlText: htmlInput.htmlText || '',
    htmlFilePath,
    allowLocalUrls: operation === 'html',
    allowFileUrls: operation === 'html',
  });

  if (!result.success) {
    throw new Error(result.error || '이미지 처리 중 오류가 발생했습니다.');
  }

  return {
    mode: 'electron' as const,
    ...result,
    saveDirectory,
  };
}

async function runWebImageProcess(operation: ImageProcessOperation, files: File[], options: ImageProcessOptions, htmlInput: HtmlInput = {}) {
  if (operation !== 'html' && files.length === 0) {
    throw new Error('이미지 파일을 추가해주세요.');
  }

  if (operation === 'html' && !htmlInput.htmlText?.trim() && !htmlInput.htmlFile) {
    throw new Error('HTML 파일을 업로드하거나 HTML 코드를 입력해주세요.');
  }

  const formData = new FormData();
  formData.append('operation', operation);
  formData.append('options', JSON.stringify(options));
  files.forEach(file => formData.append('files', file));
  if (operation === 'html') {
    if (htmlInput.htmlText?.trim()) {
      formData.append('htmlText', htmlInput.htmlText);
    }
    if (htmlInput.htmlFile) {
      formData.append('htmlFile', htmlInput.htmlFile);
    }
  }

  const response = await fetch(`${apiBaseUrl()}/image-process`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({ error: '이미지 처리 서버 요청에 실패했습니다.' }));
    throw new Error(errorPayload.error || '이미지 처리 서버 요청에 실패했습니다.');
  }

  const blob = await response.blob();
  const fileName = decodeHeaderFileName(response.headers.get('X-File-Name'), 'image_results.zip');

  return {
    mode: 'web' as const,
    success: true,
    downloadedFileName: fileName,
    zipBlob: blob,
    files: [
      {
        path: fileName,
        fileName,
        size: blob.size,
        format: 'zip',
        blob,
      },
    ],
  };
}

export async function runImageProcess(operation: ImageProcessOperation, files: File[], options: ImageProcessOptions, htmlInput: HtmlInput = {}) {
  const electronResult = await runElectronImageProcess(operation, files, options, htmlInput);
  if (electronResult) {
    return electronResult;
  }

  return runWebImageProcess(operation, files, options, htmlInput);
}
