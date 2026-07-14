import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { decodeIllustratorPdfPayload, hasPdfSignature } from './aiEpsImporter';

const pdfBytes = new TextEncoder().encode('%PDF-1.7\n%%EOF');
const payload = {
  success: true,
  mode: 'pdf',
  mimeType: 'application/pdf',
  fileData: Buffer.from(pdfBytes).toString('base64'),
};

assert.equal(hasPdfSignature(pdfBytes), true);
assert.deepEqual(decodeIllustratorPdfPayload(payload, 'application/json; charset=utf-8'), pdfBytes);
assert.throws(
  () => decodeIllustratorPdfPayload({ ...payload, mimeType: 'image/png' }, 'application/json'),
  /PDF 응답/,
);
assert.throws(
  () => decodeIllustratorPdfPayload({ ...payload, fileData: Buffer.from('not a pdf').toString('base64') }, 'application/json'),
  /PDF 서명/,
);
assert.throws(
  () => decodeIllustratorPdfPayload(payload, 'text/html'),
  /JSON 응답/,
);

console.log('AI/EPS importer response verification passed.');
