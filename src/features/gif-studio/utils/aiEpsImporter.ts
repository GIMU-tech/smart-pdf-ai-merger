import { PDF_MAX_FILE_BYTES } from './pdfGeometry';

const PDF_MARKER = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PDF_HEADER_BYTES = 1024;

interface IllustratorPreviewPayload {
  success?: unknown;
  mode?: unknown;
  mimeType?: unknown;
  fileData?: unknown;
  error?: unknown;
}

export interface ImportedAiEps {
  pdfFile: File;
  converted: boolean;
}

function hasMarker(bytes: Uint8Array, marker: number[]) {
  return bytes.some((_, start) => (
    start <= bytes.length - marker.length
    && marker.every((value, offset) => bytes[start + offset] === value)
  ));
}

export function hasPdfSignature(bytes: Uint8Array) {
  return hasMarker(bytes.subarray(0, PDF_HEADER_BYTES), PDF_MARKER);
}

export function validateAiEpsFile(file: File) {
  if (!/\.(?:ai|eps)$/i.test(file.name)) {
    throw new Error('AI 또는 EPS 파일만 Illustrator 가져오기로 열 수 있습니다.');
  }
  if (file.size <= 0) throw new Error('빈 AI/EPS 파일은 열 수 없습니다.');
  if (file.size > PDF_MAX_FILE_BYTES) throw new Error('AI/EPS 파일은 100MB 이하만 불러올 수 있습니다.');
}

function apiBaseUrl() {
  if (typeof window === 'undefined') return '';
  return ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'http://localhost:8080'
    : (window.location.hostname.includes('vercel.app')
      ? 'https://smart-pdf-ai-merger.onrender.com'
      : window.location.origin);
}

function decodedBase64Size(value: string) {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export function decodeIllustratorPdfPayload(payload: unknown, responseContentType: string | null) {
  if (!responseContentType?.toLowerCase().startsWith('application/json')) {
    throw new Error('Illustrator 변환 서버가 JSON 응답을 반환하지 않았습니다.');
  }

  const data = payload as IllustratorPreviewPayload | null;
  if (!data || data.success !== true || data.mode !== 'pdf' || data.mimeType !== 'application/pdf') {
    throw new Error('Illustrator 변환 서버가 올바른 PDF 응답을 반환하지 않았습니다.');
  }
  if (typeof data.fileData !== 'string' || data.fileData.length === 0) {
    throw new Error('Illustrator 변환 서버의 PDF 데이터가 비어 있습니다.');
  }
  if (data.fileData.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data.fileData)) {
    throw new Error('Illustrator 변환 서버의 PDF 데이터 형식이 올바르지 않습니다.');
  }
  if (decodedBase64Size(data.fileData) > PDF_MAX_FILE_BYTES) {
    throw new Error('변환된 AI/EPS PDF가 100MB 제한을 초과했습니다.');
  }

  let binary: string;
  try {
    binary = atob(data.fileData);
  } catch (_) {
    throw new Error('Illustrator 변환 서버의 PDF 데이터를 해석할 수 없습니다.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (!hasPdfSignature(bytes)) {
    throw new Error('Illustrator 변환 결과의 PDF 서명을 확인할 수 없습니다.');
  }
  return bytes;
}

function asPdfFile(bytes: BlobPart, originalFile: File) {
  const baseName = originalFile.name.replace(/\.(?:ai|eps)$/i, '') || 'illustrator';
  return new File([bytes], `${baseName}.pdf`, {
    type: 'application/pdf',
    lastModified: originalFile.lastModified,
  });
}

export async function importAiEpsFile(file: File): Promise<ImportedAiEps> {
  validateAiEpsFile(file);
  const extension = file.name.split('.').pop()?.toLowerCase();
  const header = new Uint8Array(await file.slice(0, PDF_HEADER_BYTES).arrayBuffer());

  if (extension === 'ai' && hasPdfSignature(header)) {
    return { pdfFile: asPdfFile(file, file), converted: false };
  }

  const formData = new FormData();
  formData.append('file', file);

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}/preview-illustrator`, {
      method: 'POST',
      body: formData,
    });
  } catch (_) {
    throw new Error('Illustrator 변환 서버에 연결할 수 없습니다. 서버와 Ghostscript 실행 상태를 확인해 주세요.');
  }

  const contentType = response.headers.get('content-type');
  const payload = contentType?.toLowerCase().startsWith('application/json')
    ? await response.json().catch(() => null) as IllustratorPreviewPayload | null
    : null;
  if (!response.ok) {
    const serverMessage = typeof payload?.error === 'string' ? payload.error : null;
    throw new Error(serverMessage || 'AI/EPS 변환에 실패했습니다. Ghostscript가 설치되어 있고 파일이 호환되는지 확인해 주세요.');
  }

  const bytes = decodeIllustratorPdfPayload(payload, contentType);
  return { pdfFile: asPdfFile(bytes, file), converted: true };
}
