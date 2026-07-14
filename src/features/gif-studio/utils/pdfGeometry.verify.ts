import {
  PDF_MAX_FILE_BYTES,
  PDF_MAX_PAGES,
  calculatePdfRenderSize,
  validatePdfImportLimits,
  validatePdfOutputDimensions,
} from './pdfGeometry';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const portrait = calculatePdfRenderSize(612, 792);
assert(portrait.height === 2048, 'PDF 미리보기 긴 변 제한 검증 실패');
assert(Math.abs((portrait.width / portrait.height) - (612 / 792)) < 0.001, 'PDF 페이지 비율 유지 검증 실패');

validatePdfImportLimits(PDF_MAX_FILE_BYTES, PDF_MAX_PAGES);
validatePdfOutputDimensions(8192, 3906);

for (const verifyFailure of [
  () => validatePdfImportLimits(PDF_MAX_FILE_BYTES + 1, 1),
  () => validatePdfImportLimits(1, PDF_MAX_PAGES + 1),
  () => validatePdfOutputDimensions(8192, 8192),
]) {
  let rejected = false;
  try {
    verifyFailure();
  } catch {
    rejected = true;
  }
  assert(rejected, 'PDF 안전 제한 검증 실패');
}

console.log('PDF page ratio, render scale, and safety limits verified');
