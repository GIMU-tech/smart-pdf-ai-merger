export const PDF_MAX_FILE_BYTES = 100 * 1024 * 1024;
export const PDF_MAX_PAGES = 200;
export const PDF_PREVIEW_MAX_SIDE = 2048;
export const PDF_OUTPUT_MAX_SIDE = 8192;
export const PDF_OUTPUT_MAX_PIXELS = 32_000_000;

export interface PdfRenderSize {
  width: number;
  height: number;
  scale: number;
}

function assertPositiveDimension(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`PDF ${label}가 올바른 양수가 아닙니다.`);
  }
}

export function validatePdfImportLimits(fileSize: number, pageCount: number) {
  if (!Number.isFinite(fileSize) || fileSize <= 0) throw new Error('빈 PDF 파일은 열 수 없습니다.');
  if (fileSize > PDF_MAX_FILE_BYTES) throw new Error('PDF는 100MB 이하만 불러올 수 있습니다.');
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('표시할 페이지가 없는 PDF입니다.');
  if (pageCount > PDF_MAX_PAGES) throw new Error('PDF는 최대 200페이지까지 불러올 수 있습니다.');
}

export function validatePdfOutputDimensions(width: number, height: number) {
  assertPositiveDimension(width, '출력 너비');
  assertPositiveDimension(height, '출력 높이');
  if (width > PDF_OUTPUT_MAX_SIDE || height > PDF_OUTPUT_MAX_SIDE) {
    throw new Error('PDF 렌더링 출력은 한 변이 8192px을 넘을 수 없습니다.');
  }
  if (width * height > PDF_OUTPUT_MAX_PIXELS) {
    throw new Error('PDF 렌더링 출력은 32MP를 넘을 수 없습니다.');
  }
}

export function calculatePdfRenderSize(
  pageWidth: number,
  pageHeight: number,
  targetMaxSide = PDF_PREVIEW_MAX_SIDE,
): PdfRenderSize {
  assertPositiveDimension(pageWidth, '페이지 너비');
  assertPositiveDimension(pageHeight, '페이지 높이');
  assertPositiveDimension(targetMaxSide, '렌더링 기준 크기');

  const constrainedMaxSide = Math.min(targetMaxSide, PDF_OUTPUT_MAX_SIDE);
  const sideScale = constrainedMaxSide / Math.max(pageWidth, pageHeight);
  const pixelScale = Math.sqrt(PDF_OUTPUT_MAX_PIXELS / (pageWidth * pageHeight));
  const initialScale = Math.min(sideScale, pixelScale);
  const width = Math.max(1, Math.floor(pageWidth * initialScale));
  const height = Math.max(1, Math.floor(pageHeight * initialScale));
  const scale = Math.min(width / pageWidth, height / pageHeight);

  validatePdfOutputDimensions(width, height);
  return { width, height, scale };
}
