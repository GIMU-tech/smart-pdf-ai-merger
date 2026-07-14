import DOMPurify from 'dompurify';
import type { SvgSource } from '../model/types';
import { hasSvgExtension } from './fileType';

export const MAX_SVG_BYTES = 5 * 1024 * 1024;
export const MAX_SVG_ELEMENTS = 5_000;
const MAX_SVG_SIDE = 8_192;
const MAX_SVG_PIXELS = 32 * 1024 * 1024;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const VISUAL_ELEMENTS = new Set([
  'circle', 'ellipse', 'g', 'image', 'line', 'path', 'polygon', 'polyline', 'rect', 'text', 'use',
]);
const URL_ATTRIBUTES = new Set([
  'clip-path', 'cursor', 'fill', 'filter', 'href', 'marker', 'marker-end', 'marker-mid', 'marker-start',
  'mask', 'src', 'stroke', 'xlink:href',
]);

export interface SanitizedSvgImport {
  file: File;
  source: SvgSource;
}

function svgError(message: string) {
  return new Error(`SVG를 불러올 수 없습니다. ${message}`);
}

function parseSvgDocument(markup: string) {
  const document = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (document.querySelector('parsererror')) throw svgError('XML 문법이 올바르지 않습니다.');
  if (document.documentElement.localName.toLowerCase() !== 'svg' || document.documentElement.namespaceURI !== SVG_NAMESPACE) {
    throw svgError('파일 내용의 최상위 요소가 SVG가 아닙니다.');
  }
  return document;
}

function parseViewBox(value: string | null) {
  if (!value) return null;
  const numbers = value.trim().split(/[\s,]+/).map(Number);
  if (numbers.length !== 4 || numbers.some(number => !Number.isFinite(number))) {
    throw svgError('viewBox 값이 올바르지 않습니다.');
  }
  const [x, y, width, height] = numbers;
  if (width <= 0 || height <= 0) throw svgError('viewBox의 너비와 높이는 0보다 커야 합니다.');
  return { x, y, width, height };
}

function parseAbsoluteLength(value: string | null, name: string) {
  if (!value) throw svgError(`viewBox 또는 ${name} 값이 필요합니다.`);
  const match = value.trim().match(/^([+]?(?:\d+\.?\d*|\.\d+))(px|pt|pc|in|cm|mm|q)?$/i);
  if (!match) throw svgError(`${name}는 백분율이 아닌 절대 길이여야 합니다.`);
  const unitScale: Record<string, number> = {
    '': 1, px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6,
  };
  return Number(match[1]) * unitScale[(match[2] ?? '').toLowerCase()];
}

export function getSvgCanvasGeometry(root: SVGSVGElement) {
  const viewBox = parseViewBox(root.getAttribute('viewBox'));
  const geometry = viewBox ?? {
    x: 0,
    y: 0,
    width: parseAbsoluteLength(root.getAttribute('width'), 'width'),
    height: parseAbsoluteLength(root.getAttribute('height'), 'height'),
  };
  if (!Number.isFinite(geometry.width) || !Number.isFinite(geometry.height) || geometry.width <= 0 || geometry.height <= 0) {
    throw svgError('캔버스 크기가 올바르지 않습니다.');
  }
  if (geometry.width > MAX_SVG_SIDE || geometry.height > MAX_SVG_SIDE || geometry.width * geometry.height > MAX_SVG_PIXELS) {
    throw svgError('캔버스는 한 변 8192px, 전체 32MP 이하여야 합니다.');
  }
  return geometry;
}

function isExternalReference(name: string, value: string) {
  const normalizedName = name.toLowerCase();
  const normalizedValue = value.trim();
  if (normalizedName === 'href' || normalizedName === 'xlink:href' || normalizedName === 'src') {
    return normalizedValue.length > 0 && !normalizedValue.startsWith('#');
  }
  const urls = [...normalizedValue.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)];
  return urls.some(match => !match[2].trim().startsWith('#'));
}

function countRisks(document: Document) {
  let eventHandlers = 0;
  let externalUrls = 0;
  document.querySelectorAll('*').forEach(element => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) eventHandlers += 1;
      if ((URL_ATTRIBUTES.has(name) && isExternalReference(name, attribute.value))
        || (name === 'style' && /(?:url\s*\(|@import|expression\s*\()/i.test(attribute.value))) {
        externalUrls += 1;
      }
    }
  });
  return {
    scripts: document.querySelectorAll('script').length,
    foreignObjects: document.querySelectorAll('foreignObject').length,
    eventHandlers,
    externalUrls,
  };
}

function scrubAttributes(document: Document) {
  document.querySelectorAll('*').forEach(element => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const unsafeStyle = name === 'style' && /(?:url\s*\(|@import|expression\s*\()/i.test(attribute.value);
      if (name.startsWith('on') || unsafeStyle || (URL_ATTRIBUTES.has(name) && isExternalReference(name, attribute.value))) {
        element.removeAttribute(attribute.name);
      }
    }
  });
}

function annotateVisualElements(document: Document) {
  let objectCount = 0;
  document.querySelectorAll('*').forEach(element => {
    const type = element.localName.toLowerCase();
    if (!VISUAL_ELEMENTS.has(type) || element.closest('defs, clipPath, mask, marker, pattern, symbol')) return;
    objectCount += 1;
    const title = [...element.children].find(child => child.localName.toLowerCase() === 'title')?.textContent?.trim();
    const label = element.getAttribute('aria-label')?.trim()
      || element.getAttribute('data-name')?.trim()
      || element.id
      || title
      || `${type} ${objectCount}`;
    element.setAttribute('data-gif-node-id', `svg-node-${objectCount}`);
    element.setAttribute('data-gif-node-type', type);
    element.setAttribute('data-gif-node-label', label.slice(0, 160));
  });
  return objectCount;
}

function assertSanitized(document: Document) {
  if (document.querySelector('script, foreignObject')) throw svgError('위험 요소를 완전히 제거하지 못했습니다.');
  document.querySelectorAll('*').forEach(element => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || (URL_ATTRIBUTES.has(name) && isExternalReference(name, attribute.value))) {
        throw svgError('위험 속성을 완전히 제거하지 못했습니다.');
      }
    }
  });
}

export async function sanitizeSvgFile(file: File): Promise<SanitizedSvgImport> {
  if (!hasSvgExtension(file)) throw svgError('파일 확장자가 .svg가 아닙니다.');
  if (file.size <= 0 || file.size > MAX_SVG_BYTES) throw svgError('파일은 0B보다 크고 5MB 이하여야 합니다.');

  const originalMarkup = await file.text();
  const originalDocument = parseSvgDocument(originalMarkup);
  const originalElements = originalDocument.querySelectorAll('*').length;
  if (originalElements > MAX_SVG_ELEMENTS) throw svgError(`요소 수는 ${MAX_SVG_ELEMENTS.toLocaleString()}개 이하여야 합니다.`);
  const risks = countRisks(originalDocument);

  const purified = DOMPurify.sanitize(originalMarkup, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed', 'style'],
  });
  const sanitizedDocument = parseSvgDocument(purified);
  scrubAttributes(sanitizedDocument);
  assertSanitized(sanitizedDocument);

  const root = sanitizedDocument.documentElement as unknown as SVGSVGElement;
  const geometry = getSvgCanvasGeometry(root);
  root.setAttribute('viewBox', `${geometry.x} ${geometry.y} ${geometry.width} ${geometry.height}`);
  root.setAttribute('width', String(geometry.width));
  root.setAttribute('height', String(geometry.height));
  root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const objectCount = annotateVisualElements(sanitizedDocument);
  if (objectCount === 0) throw svgError('선택할 수 있는 시각 요소가 없습니다.');

  const sanitizedMarkup = new XMLSerializer().serializeToString(root);
  const securityReport = [
    risks.scripts > 0 ? `script ${risks.scripts}개 제거` : null,
    risks.foreignObjects > 0 ? `foreignObject ${risks.foreignObjects}개 제거` : null,
    risks.eventHandlers > 0 ? `이벤트 속성 ${risks.eventHandlers}개 제거` : null,
    risks.externalUrls > 0 ? `외부 URL ${risks.externalUrls}개 제거` : null,
  ].filter((item): item is string => Boolean(item));

  const sanitizedFile = new File([sanitizedMarkup], file.name, { type: 'image/svg+xml', lastModified: file.lastModified });
  return {
    file: sanitizedFile,
    source: {
      id: crypto.randomUUID(),
      kind: 'svg',
      name: file.name,
      size: file.size,
      width: geometry.width,
      height: geometry.height,
      coordinateOrigin: { x: geometry.x, y: geometry.y },
      sanitizedMarkup,
      objectCount,
      securityReport,
    },
  };
}
