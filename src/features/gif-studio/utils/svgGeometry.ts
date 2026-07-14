import type { Rect } from '../model/types';

interface MatrixLike {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

function transformPoint(x: number, y: number, matrix: MatrixLike) {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

export function transformSvgRect(rect: Rect, matrix: MatrixLike): Rect {
  const points = [
    transformPoint(rect.x, rect.y, matrix),
    transformPoint(rect.x + rect.width, rect.y, matrix),
    transformPoint(rect.x, rect.y + rect.height, matrix),
    transformPoint(rect.x + rect.width, rect.y + rect.height, matrix),
  ];
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function clientPointToSvg(clientX: number, clientY: number, matrix: MatrixLike) {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < Number.EPSILON) return null;
  const x = clientX - matrix.e;
  const y = clientY - matrix.f;
  return {
    x: (matrix.d * x - matrix.c * y) / determinant,
    y: (-matrix.b * x + matrix.a * y) / determinant,
  };
}

export function relativeSvgMatrix(elementToScreen: MatrixLike, rootToScreen: MatrixLike): MatrixLike | null {
  const determinant = rootToScreen.a * rootToScreen.d - rootToScreen.b * rootToScreen.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < Number.EPSILON) return null;
  const inverse = {
    a: rootToScreen.d / determinant,
    b: -rootToScreen.b / determinant,
    c: -rootToScreen.c / determinant,
    d: rootToScreen.a / determinant,
    e: (rootToScreen.c * rootToScreen.f - rootToScreen.d * rootToScreen.e) / determinant,
    f: (rootToScreen.b * rootToScreen.e - rootToScreen.a * rootToScreen.f) / determinant,
  };
  return {
    a: inverse.a * elementToScreen.a + inverse.c * elementToScreen.b,
    b: inverse.b * elementToScreen.a + inverse.d * elementToScreen.b,
    c: inverse.a * elementToScreen.c + inverse.c * elementToScreen.d,
    d: inverse.b * elementToScreen.c + inverse.d * elementToScreen.d,
    e: inverse.a * elementToScreen.e + inverse.c * elementToScreen.f + inverse.e,
    f: inverse.b * elementToScreen.e + inverse.d * elementToScreen.f + inverse.f,
  };
}
