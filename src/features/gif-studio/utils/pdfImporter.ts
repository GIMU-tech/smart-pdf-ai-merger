import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfSource } from '../model/types';
import { calculatePdfRenderSize, validatePdfImportLimits } from './pdfGeometry';

const PDF_HEADER_BYTES = 1024;
let pdfJsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function loadPdfJs() {
  pdfJsPromise ??= import('pdfjs-dist').then(pdfjs => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();
    return pdfjs;
  });
  return pdfJsPromise;
}

export interface OpenedPdf {
  document: PDFDocumentProxy;
  pageCount: number;
}

export interface RenderedPdfPage {
  blob: Blob;
  source: PdfSource;
}

function pdfErrorMessage(error: unknown, passwordResponses: typeof import('pdfjs-dist')['PasswordResponses']) {
  const detail = error as { name?: string; code?: number; message?: string };
  if (
    detail.name === 'PasswordException'
    || detail.code === passwordResponses.NEED_PASSWORD
    || detail.code === passwordResponses.INCORRECT_PASSWORD
  ) {
    return '암호로 보호된 PDF는 현재 GIF Studio에서 열 수 없습니다. 암호 보호를 해제한 복사본을 선택해 주세요.';
  }
  if (detail.name === 'InvalidPDFException' || detail.name === 'FormatError') {
    return '손상되었거나 지원하지 않는 구조의 PDF입니다. 다른 PDF 뷰어에서 파일이 열리는지 확인해 주세요.';
  }
  return '이 PDF를 열 수 없습니다. 파일이 손상되지 않았는지 확인해 주세요.';
}

async function hasPdfHeader(file: File) {
  const header = new Uint8Array(await file.slice(0, PDF_HEADER_BYTES).arrayBuffer());
  const marker = [0x25, 0x50, 0x44, 0x46, 0x2d];
  return header.some((_, start) => (
    start <= header.length - marker.length
    && marker.every((value, offset) => header[start + offset] === value)
  ));
}

export function hasPdfExtension(file: File) {
  return file.name.toLowerCase().endsWith('.pdf');
}

export async function openPdfFile(file: File): Promise<OpenedPdf> {
  validatePdfImportLimits(file.size, 1);
  if (!hasPdfExtension(file) || !(await hasPdfHeader(file))) {
    throw new Error('확장자와 파일 내용이 일치하는 PDF만 불러올 수 있습니다.');
  }

  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let document: PDFDocumentProxy;
  try {
    document = await loadingTask.promise;
  } catch (error) {
    throw new Error(pdfErrorMessage(error, pdfjs.PasswordResponses));
  }

  try {
    validatePdfImportLimits(file.size, document.numPages);
    return { document, pageCount: document.numPages };
  } catch (error) {
    await document.destroy();
    throw error;
  }
}

function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob?.type === 'image/png') resolve(blob);
      else reject(new Error('PDF 페이지를 PNG 미리보기로 만들지 못했습니다.'));
    }, 'image/png');
  });
}

export async function renderPdfPage(
  pdfDocument: PDFDocumentProxy,
  file: File,
  pageNumber: number,
): Promise<RenderedPdfPage> {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdfDocument.numPages) {
    throw new Error('요청한 PDF 페이지를 찾을 수 없습니다.');
  }

  try {
    const page = await pdfDocument.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const renderSize = calculatePdfRenderSize(baseViewport.width, baseViewport.height);
    const viewport = page.getViewport({ scale: renderSize.scale });
    const canvas = document.createElement('canvas');
    canvas.width = renderSize.width;
    canvas.height = renderSize.height;

    await page.render({
      canvas,
      viewport,
      background: 'rgb(255, 255, 255)',
    }).promise;

    return {
      blob: await canvasToPng(canvas),
      source: {
        id: crypto.randomUUID(),
        kind: 'pdf',
        name: file.name,
        size: file.size,
        width: renderSize.width,
        height: renderSize.height,
        coordinateOrigin: { x: 0, y: 0 },
        pageCount: pdfDocument.numPages,
        currentPage: pageNumber,
        pageWidth: baseViewport.width,
        pageHeight: baseViewport.height,
        renderScale: renderSize.scale,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('요청한 PDF')) throw error;
    throw new Error(`PDF ${pageNumber}페이지를 렌더링하지 못했습니다. 페이지 데이터가 손상되었을 수 있습니다.`);
  }
}
