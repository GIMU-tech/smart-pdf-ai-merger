import DOMPurify from 'dompurify';
import type { HtmlSource } from '../model/types';
import { hasHtmlExtension } from './fileType';

export const MAX_HTML_BYTES = 2 * 1024 * 1024;
export const MAX_HTML_ELEMENTS = 3_000;
export const DEFAULT_HTML_CANVAS_WIDTH = 860;
export const MAX_HTML_CANVAS_HEIGHT = 8_192;
export const MAX_HTML_CANVAS_PIXELS = 32 * 1024 * 1024;

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const FORBIDDEN_TAGS = [
  'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select',
  'video', 'audio', 'canvas', 'link', 'meta', 'base',
] as const;
const VISUAL_TAGS = new Set([
  'a', 'article', 'aside', 'blockquote', 'code', 'dd', 'div', 'dl', 'dt', 'figcaption',
  'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'img', 'li', 'main',
  'nav', 'ol', 'p', 'pre', 'section', 'small', 'span', 'strong', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'ul',
]);
export const HTML_SRCDOC_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  "font-src 'none'",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const CANVAS_GUARD_CSS = `
html,body{box-sizing:border-box!important;margin:0!important;width:860px!important;min-width:860px!important;max-width:860px!important;overflow-x:hidden!important}
body{min-height:1px!important}
*,*::before,*::after{box-sizing:border-box}
`;

export interface SanitizedHtmlImport {
  renderBlob: Blob;
  source: HtmlSource;
}

function htmlError(message: string) {
  return new Error(`HTML을 불러올 수 없습니다. ${message}`);
}

export function containsUnsafeHtmlCss(value: string) {
  const normalized = value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\([0-9a-f]{1,6}\s?|.)/gi, (_match, escaped: string) => {
      const hex = escaped.trim();
      if (/^[0-9a-f]{1,6}$/i.test(hex)) return String.fromCodePoint(Number.parseInt(hex, 16));
      return escaped;
    });
  return /@import\b|url\s*\(|expression\s*\(|(?:^|[;{\s])behavior\s*:|-moz-binding\s*:/i.test(normalized);
}

export function isAllowedHtmlImageSource(value: string) {
  return /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value.trim());
}

export function shouldRemoveHtmlAttribute(tagName: string, attributeName: string, value: string) {
  const tag = tagName.toLowerCase();
  const name = attributeName.toLowerCase();
  const normalized = value.trim();
  if (name.startsWith('on') || name === 'srcset') return true;
  if (name === 'style') return containsUnsafeHtmlCss(value);
  if (name === 'src') return tag !== 'img' || !isAllowedHtmlImageSource(normalized);
  if (name === 'href' || name === 'xlink:href') return normalized.length === 0 || !normalized.startsWith('#');
  if (['background', 'cite', 'action', 'formaction', 'poster'].includes(name)) return normalized.length > 0;
  return false;
}

export function validateHtmlCanvasGeometry(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw htmlError('캔버스 크기가 올바르지 않습니다.');
  }
  const measuredWidth = Math.ceil(width);
  const measuredHeight = Math.ceil(height);
  if (measuredHeight > MAX_HTML_CANVAS_HEIGHT || measuredWidth * measuredHeight > MAX_HTML_CANVAS_PIXELS) {
    throw htmlError('캔버스 높이는 8192px, 전체 크기는 32MP 이하여야 합니다.');
  }
  return { width: measuredWidth, height: measuredHeight };
}

export function hasHtmlForeignObjectSvgSignature(markup: string) {
  const normalized = markup.trim();
  return /^<svg\b[^>]*xmlns=["']http:\/\/www\.w3\.org\/2000\/svg["'][^>]*>/i.test(normalized)
    && /<foreignObject\b[^>]*>/i.test(normalized)
    && /xmlns=["']http:\/\/www\.w3\.org\/1999\/xhtml["']/i.test(normalized)
    && /<\/foreignObject>\s*<\/svg>$/i.test(normalized);
}

function parseHtmlDocument(markup: string) {
  return new DOMParser().parseFromString(markup, 'text/html');
}

function countRisks(document: Document) {
  let eventHandlers = 0;
  let externalUrls = 0;
  let unsafeCss = 0;
  document.querySelectorAll('*').forEach(element => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) eventHandlers += 1;
      if (['href', 'src', 'srcset', 'xlink:href'].includes(name)
        && shouldRemoveHtmlAttribute(element.localName, name, attribute.value)) externalUrls += 1;
      if (name === 'style' && containsUnsafeHtmlCss(attribute.value)) unsafeCss += 1;
    }
  });
  unsafeCss += [...document.querySelectorAll('style')].filter(style => containsUnsafeHtmlCss(style.textContent ?? '')).length;
  return {
    forbiddenTags: document.querySelectorAll(FORBIDDEN_TAGS.join(',')).length,
    eventHandlers,
    externalUrls,
    unsafeCss,
  };
}

function scrubDocument(document: Document) {
  let removedAttributes = 0;
  document.querySelectorAll('*').forEach(element => {
    for (const attribute of [...element.attributes]) {
      if (shouldRemoveHtmlAttribute(element.localName, attribute.name, attribute.value)) {
        element.removeAttribute(attribute.name);
        removedAttributes += 1;
      }
    }
  });
  document.querySelectorAll('style').forEach(style => {
    if (containsUnsafeHtmlCss(style.textContent ?? '')) style.remove();
  });
  return removedAttributes;
}

function assertSanitized(document: Document) {
  if (document.querySelector(FORBIDDEN_TAGS.join(','))) throw htmlError('위험 요소를 완전히 제거하지 못했습니다.');
  document.querySelectorAll('*').forEach(element => {
    for (const attribute of [...element.attributes]) {
      if (shouldRemoveHtmlAttribute(element.localName, attribute.name, attribute.value)) {
        throw htmlError('위험 속성 또는 외부 URL을 완전히 제거하지 못했습니다.');
      }
    }
  });
  if ([...document.querySelectorAll('style')].some(style => containsUnsafeHtmlCss(style.textContent ?? ''))) {
    throw htmlError('위험한 CSS를 완전히 제거하지 못했습니다.');
  }
}

function annotateVisualElements(document: Document) {
  let objectCount = 0;
  document.body.querySelectorAll('*').forEach(element => {
    const type = element.localName.toLowerCase();
    if (!VISUAL_TAGS.has(type)) return;
    objectCount += 1;
    const text = element.textContent?.replace(/\s+/g, ' ').trim();
    const label = element.getAttribute('aria-label')?.trim()
      || element.getAttribute('alt')?.trim()
      || element.getAttribute('title')?.trim()
      || element.id
      || text
      || `${type} ${objectCount}`;
    element.setAttribute('data-gif-node-id', `html-node-${objectCount}`);
    element.setAttribute('data-gif-node-type', type);
    element.setAttribute('data-gif-node-label', label.slice(0, 160));
  });
  return objectCount;
}

function extractSafeCss(document: Document) {
  const css = [...document.querySelectorAll('style')].map(style => style.textContent ?? '').join('\n');
  document.querySelectorAll('style').forEach(style => style.remove());
  return css;
}

function buildSrcdoc(document: Document, safeCss: string) {
  document.head.replaceChildren();
  const csp = document.createElement('meta');
  csp.setAttribute('http-equiv', 'Content-Security-Policy');
  csp.setAttribute('content', HTML_SRCDOC_CSP);
  const style = document.createElement('style');
  style.textContent = `${safeCss}\n${CANVAS_GUARD_CSS}`;
  document.head.append(csp, style);
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

async function measureSrcdoc(srcdoc: string) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = `position:fixed;left:-100000px;top:0;width:${DEFAULT_HTML_CANVAS_WIDTH}px;height:1px;border:0;visibility:hidden;pointer-events:none`;
  const loaded = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(htmlError('정제된 문서의 크기를 측정하는 데 시간이 너무 오래 걸렸습니다.')), 5_000);
    iframe.addEventListener('load', () => {
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
  iframe.srcdoc = srcdoc;
  document.body.append(iframe);
  try {
    await loaded;
    const frameDocument = iframe.contentDocument;
    if (!frameDocument) throw htmlError('sandbox iframe에 정제된 문서를 표시할 수 없습니다.');
    const height = Math.max(
      frameDocument.documentElement.scrollHeight,
      frameDocument.body?.scrollHeight ?? 0,
      frameDocument.documentElement.offsetHeight,
      frameDocument.body?.offsetHeight ?? 0,
      1,
    );
    return validateHtmlCanvasGeometry(DEFAULT_HTML_CANVAS_WIDTH, height);
  } finally {
    iframe.remove();
  }
}

function copyAttributes(source: Element, target: Element) {
  for (const attribute of [...source.attributes]) target.setAttribute(attribute.name, attribute.value);
}

function createForeignObjectSvg(document: Document, safeCss: string, width: number, height: number) {
  const xhtmlDocument = document.implementation.createDocument(HTML_NAMESPACE, 'html');
  const html = xhtmlDocument.documentElement;
  copyAttributes(document.documentElement, html);
  html.setAttribute('xmlns', HTML_NAMESPACE);
  const head = xhtmlDocument.createElementNS(HTML_NAMESPACE, 'head');
  const style = xhtmlDocument.createElementNS(HTML_NAMESPACE, 'style');
  style.textContent = `${safeCss}\n${CANVAS_GUARD_CSS}`;
  head.append(style);
  const body = xhtmlDocument.createElementNS(HTML_NAMESPACE, 'body');
  copyAttributes(document.body, body);
  for (const child of [...document.body.childNodes]) body.append(xhtmlDocument.importNode(child, true));
  html.append(head, body);
  const xhtml = new XMLSerializer().serializeToString(html);
  const markup = `<svg xmlns="${SVG_NAMESPACE}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="${width}" height="${height}">${xhtml}</foreignObject></svg>`;
  if (!hasHtmlForeignObjectSvgSignature(markup)) throw htmlError('foreignObject 렌더 소스를 생성하지 못했습니다.');
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (parsed.querySelector('parsererror') || parsed.documentElement.namespaceURI !== SVG_NAMESPACE) {
    throw htmlError('foreignObject 렌더 소스가 올바른 SVG가 아닙니다.');
  }
  return markup;
}

async function verifyForeignObjectRender(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('canvas unavailable');
          context.drawImage(image, 0, 0, 1, 1);
          context.getImageData(0, 0, 1, 1);
          resolve();
        } catch {
          reject(htmlError('이 환경에서 HTML foreignObject 이미지를 안전하게 렌더링할 수 없습니다. 단순한 정적 HTML/CSS로 다시 시도해 주세요.'));
        }
      };
      image.onerror = () => reject(htmlError('HTML foreignObject 이미지 로드에 실패했습니다. 이 HTML/CSS 또는 현재 브라우저가 지원하지 않는 렌더링입니다.'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function sanitizeHtmlFile(file: File): Promise<SanitizedHtmlImport> {
  if (!hasHtmlExtension(file)) throw htmlError('파일 확장자가 .html 또는 .htm이 아닙니다.');
  if (file.size <= 0 || file.size > MAX_HTML_BYTES) throw htmlError('파일은 0B보다 크고 2MB 이하여야 합니다.');

  const originalMarkup = await file.text();
  const originalDocument = parseHtmlDocument(originalMarkup);
  const originalElements = originalDocument.querySelectorAll('*').length;
  if (originalElements > MAX_HTML_ELEMENTS) throw htmlError(`요소 수는 ${MAX_HTML_ELEMENTS.toLocaleString()}개 이하여야 합니다.`);
  const risks = countRisks(originalDocument);

  const purified = DOMPurify.sanitize(originalMarkup, {
    USE_PROFILES: { html: true },
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: [...FORBIDDEN_TAGS],
    FORBID_ATTR: ['srcset'],
  });
  const sanitizedDocument = parseHtmlDocument(String(purified));
  const removedAttributes = scrubDocument(sanitizedDocument);
  assertSanitized(sanitizedDocument);
  const objectCount = annotateVisualElements(sanitizedDocument);
  if (objectCount === 0) throw htmlError('선택할 수 있는 정적 시각 요소가 없습니다.');
  const safeCss = extractSafeCss(sanitizedDocument);
  const renderDocument = sanitizedDocument.cloneNode(true) as Document;
  const srcdoc = buildSrcdoc(sanitizedDocument, safeCss);
  const geometry = await measureSrcdoc(srcdoc);
  const svgMarkup = createForeignObjectSvg(renderDocument, safeCss, geometry.width, geometry.height);
  const renderBlob = new Blob([svgMarkup], { type: 'image/svg+xml' });
  await verifyForeignObjectRender(renderBlob);

  const securityReport = [
    risks.forbiddenTags > 0 ? `실행·입력 요소 ${risks.forbiddenTags}개 제거` : null,
    risks.eventHandlers > 0 ? `이벤트 속성 ${risks.eventHandlers}개 제거` : null,
    risks.externalUrls > 0 ? `외부 URL ${risks.externalUrls}개 제거` : null,
    risks.unsafeCss > 0 ? `외부·위험 CSS ${risks.unsafeCss}개 제거` : null,
    removedAttributes > 0 ? `위험 속성 ${removedAttributes}개 정리` : null,
  ].filter((item): item is string => Boolean(item));

  return {
    renderBlob,
    source: {
      id: crypto.randomUUID(),
      kind: 'html',
      name: file.name,
      size: file.size,
      width: geometry.width,
      height: geometry.height,
      coordinateOrigin: { x: 0, y: 0 },
      sanitizedSrcdoc: srcdoc,
      objectCount,
      securityReport,
    },
  };
}
