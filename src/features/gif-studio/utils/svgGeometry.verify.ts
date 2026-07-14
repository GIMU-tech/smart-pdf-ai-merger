import { clientPointToSvg, relativeSvgMatrix, transformSvgRect } from './svgGeometry';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const matrix = { a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 };
const transformed = transformSvgRect({ x: 5, y: 7, width: 10, height: 4 }, matrix);
assert(JSON.stringify(transformed) === JSON.stringify({ x: 20, y: 41, width: 20, height: 12 }), 'SVG 객체 bounds 변환 실패');
const original = clientPointToSvg(40, 62, matrix);
assert(original?.x === 15 && original.y === 14, '화면 좌표를 SVG 원본 좌표로 복원하지 못함');
const relative = relativeSvgMatrix(
  { a: 4, b: 0, c: 0, d: 6, e: 50, f: 80 },
  { a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 },
);
assert(
  relative
    && Math.abs(relative.a - 2) < 1e-9
    && Math.abs(relative.d - 2) < 1e-9
    && Math.abs(relative.e - 20) < 1e-9
    && Math.abs(relative.f - 20) < 1e-9,
  '루트 viewBox 변환 제거 실패',
);

console.log('SVG original-coordinate transforms verified');
