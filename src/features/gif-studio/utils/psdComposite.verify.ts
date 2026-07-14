import { getCompositeCanvas, initializeCanvas, readPsd, writePsdUint8Array } from 'ag-psd';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class MemoryCanvas {
  width: number;
  height: number;
  imageData: ImageData | null = null;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext() {
    return {
      putImageData: (imageData: ImageData) => { this.imageData = imageData; },
    };
  }
}

initializeCanvas(
  (width, height) => new MemoryCanvas(width, height) as unknown as HTMLCanvasElement,
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as ImageData,
);

const pixels = new Uint8ClampedArray([
  255, 0, 0, 255,
  0, 255, 0, 255,
]);
const encoded = writePsdUint8Array({
  width: 2,
  height: 1,
  imageData: { width: 2, height: 1, data: pixels },
}, { generateThumbnail: false });
const decoded = readPsd(encoded, { skipThumbnail: true, useRawData: true });
const composite = getCompositeCanvas(decoded) as unknown as MemoryCanvas | undefined;

assert(composite?.width === 2 && composite.height === 1, 'PSD 합성 Canvas 크기 검증 실패');
assert(composite.imageData?.data[0] === 255 && composite.imageData.data[7] === 255, 'PSD 합성 픽셀 검증 실패');
console.log('ag-psd in-memory write, read, and composite canvas verified');
