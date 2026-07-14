import {
  containsUnsafeHtmlCss,
  hasHtmlForeignObjectSvgSignature,
  HTML_SRCDOC_CSP,
  isAllowedHtmlImageSource,
  shouldRemoveHtmlAttribute,
  validateHtmlCanvasGeometry,
} from './htmlImporter';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function rejects(action: () => unknown, message: string) {
  let rejected = false;
  try {
    action();
  } catch {
    rejected = true;
  }
  assert(rejected, message);
}

for (const css of [
  '@import "https://example.com/a.css"',
  'background:url(https://example.com/a.png)',
  'width:expression(alert(1))',
  'behavior:url(test.htc)',
  '-moz-binding:url(test.xml#xss)',
  'background:u/**/rl(https://example.com/a.png)',
  'background:u\\72l(https://example.com/a.png)',
]) assert(containsUnsafeHtmlCss(css), `위험 CSS를 감지해야 합니다: ${css}`);
assert(!containsUnsafeHtmlCss('color:#123;display:grid;gap:12px'), '일반 정적 CSS를 허용해야 합니다.');

assert(isAllowedHtmlImageSource('data:image/png;base64,iVBORw0KGgo='), 'PNG data URL을 허용해야 합니다.');
assert(isAllowedHtmlImageSource('data:image/jpeg;base64,/9j/4AAQ='), 'JPEG data URL을 허용해야 합니다.');
assert(isAllowedHtmlImageSource('data:image/gif;base64,R0lGODlhAQABAAAAACw='), 'GIF data URL을 허용해야 합니다.');
assert(isAllowedHtmlImageSource('data:image/webp;base64,UklGRg=='), 'WebP data URL을 허용해야 합니다.');
assert(!isAllowedHtmlImageSource('data:image/svg+xml;base64,PHN2Zz4='), 'data SVG를 거부해야 합니다.');
assert(!isAllowedHtmlImageSource('https://example.com/a.png'), '외부 이미지를 거부해야 합니다.');

assert(shouldRemoveHtmlAttribute('div', 'onclick', 'alert(1)'), 'on* 속성을 제거해야 합니다.');
assert(shouldRemoveHtmlAttribute('a', 'href', 'https://example.com'), '외부 href를 제거해야 합니다.');
assert(!shouldRemoveHtmlAttribute('a', 'href', '#section'), '문서 내부 fragment href는 허용해야 합니다.');
assert(shouldRemoveHtmlAttribute('img', 'srcset', 'a.png 1x'), 'srcset을 제거해야 합니다.');
assert(shouldRemoveHtmlAttribute('img', 'src', 'data:image/svg+xml;base64,PHN2Zz4='), 'img data SVG를 제거해야 합니다.');
assert(!shouldRemoveHtmlAttribute('img', 'src', 'data:image/webp;base64,UklGRg=='), '허용된 data 이미지는 유지해야 합니다.');

const geometry = validateHtmlCanvasGeometry(860, 8192);
assert(geometry.width === 860 && geometry.height === 8192, 'HTML 캔버스 경계값을 허용해야 합니다.');
rejects(() => validateHtmlCanvasGeometry(860, 8193), '8192px 초과 높이를 거부해야 합니다.');
rejects(() => validateHtmlCanvasGeometry(8192, 4097), '32MP 초과 캔버스를 거부해야 합니다.');

const signature = '<svg xmlns="http://www.w3.org/2000/svg" width="860" height="10"><foreignObject><html xmlns="http://www.w3.org/1999/xhtml"><body /></html></foreignObject></svg>';
assert(hasHtmlForeignObjectSvgSignature(signature), 'HTML foreignObject SVG signature를 인식해야 합니다.');
assert(!hasHtmlForeignObjectSvgSignature('<svg xmlns="http://www.w3.org/2000/svg"><image /></svg>'), 'foreignObject가 없는 SVG를 거부해야 합니다.');

for (const directive of ["default-src 'none'", "script-src 'none'", 'img-src data:', "font-src 'none'", "connect-src 'none'", "form-action 'none'"]) {
  assert(HTML_SRCDOC_CSP.includes(directive), `CSP에 ${directive}가 필요합니다.`);
}

console.log('HTML sanitizer risks, URL policy, geometry caps, CSP, and foreignObject SVG signature verified');
