import type { PsdSource } from '../model/types';
import { buildPsdLayerTree, countPsdLayers, flattenPsdLayerTree, type PsdLayerLike } from './psdLayers';

export const PSD_MAX_FILE_BYTES = 100 * 1024 * 1024;
export const PSD_MAX_SIDE = 8192;
export const PSD_MAX_PIXELS = 32_000_000;
export const PSD_MAX_LAYERS = 2000;
const PSD_DECODE_MEMORY_LIMIT = 512 * 1024 * 1024;
let psdCanvasInitialized = false;

type InitializeCanvas = typeof import('ag-psd')['initializeCanvas'];

function initializePsdBrowserCanvas(initializeCanvas: InitializeCanvas) {
  if (psdCanvasInitialized) return;
  if (typeof document === 'undefined') throw new Error('PSD 미리보기는 브라우저 Canvas 환경에서만 사용할 수 있습니다.');

  initializeCanvas(
    (width, height) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    (width, height) => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('PSD 이미지 데이터용 Canvas를 초기화하지 못했습니다.');
      return context.createImageData(width, height);
    },
  );
  psdCanvasInitialized = true;
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob?.type === 'image/png') resolve(blob);
      else reject(new Error('PSD 합성 이미지를 안전한 PNG로 변환하지 못했습니다.'));
    }, 'image/png');
  });
}

export function parsePsdHeader(buffer: ArrayBuffer) {
  if (buffer.byteLength < 26) throw new Error('PSD 헤더가 손상되었거나 너무 짧습니다.');
  const view = new DataView(buffer);
  const signature = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (signature !== '8BPS' || view.getUint16(4) !== 1) throw new Error('PSD 형식만 지원합니다. PSB는 지원하지 않습니다.');
  return { height: view.getUint32(14), width: view.getUint32(18) };
}

export function validatePsdDimensions(width: number, height: number) {
  if (width < 1 || height < 1) throw new Error('PSD 캔버스 크기가 올바르지 않습니다.');
  if (width > PSD_MAX_SIDE || height > PSD_MAX_SIDE) throw new Error('PSD 한 변은 8192px 이하여야 합니다.');
  if (width * height > PSD_MAX_PIXELS) throw new Error('PSD 캔버스는 32MP 이하여야 합니다.');
}

export async function importPsdFile(file: File): Promise<{ source: PsdSource; previewBlob: Blob }> {
  if (!file.name.toLowerCase().endsWith('.psd')) throw new Error('확장자가 .psd인 파일만 가져올 수 있습니다.');
  if (file.size > PSD_MAX_FILE_BYTES) throw new Error('PSD 파일은 100MB 이하여야 합니다.');

  const header = parsePsdHeader(await file.slice(0, 26).arrayBuffer());
  validatePsdDimensions(header.width, header.height);

  const { getCompositeCanvas, initializeCanvas, readPsd } = await import('ag-psd');
  initializePsdBrowserCanvas(initializeCanvas);
  const psd = readPsd(await file.arrayBuffer(), {
    skipThumbnail: true,
    skipLinkedFilesData: true,
    totalMemoryLimit: PSD_DECODE_MEMORY_LIMIT,
    useRawData: true,
  });
  validatePsdDimensions(psd.width, psd.height);

  const layerCount = countPsdLayers(psd.children as PsdLayerLike[] | undefined);
  if (layerCount > PSD_MAX_LAYERS) throw new Error('PSD 레이어는 2000개 이하여야 합니다.');

  const layerTree = buildPsdLayerTree(psd.children as PsdLayerLike[] | undefined, psd.width, psd.height);
  const flattened = flattenPsdLayerTree(layerTree);
  const compositeCanvas = getCompositeCanvas(psd);
  if (!compositeCanvas) throw new Error('PSD에 표시 가능한 합성 이미지가 없습니다.');
  const previewBlob = await canvasToPngBlob(compositeCanvas);

  return {
    previewBlob,
    source: {
      id: crypto.randomUUID(),
      kind: 'psd',
      name: file.name,
      size: file.size,
      width: psd.width,
      height: psd.height,
      coordinateOrigin: { x: 0, y: 0 },
      layerTree,
      layerCount,
      selectableLayerCount: flattened.filter(layer => layer.selectable).length,
      warnings: ['조정 레이어, 효과, 스마트 오브젝트는 개별 재합성하지 않으며 원본 합성 이미지를 사용합니다.'],
    },
  };
}
