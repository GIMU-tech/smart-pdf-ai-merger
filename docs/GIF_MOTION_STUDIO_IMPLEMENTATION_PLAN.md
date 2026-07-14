# GIF Motion Studio 구현 기획서

## 1. 문서 목적

이 문서는 `smart-pdf-&-ai-merger` 프로젝트에 편집 가능한 디자인 파일을 불러오고, 사용자가 선택한 레이어·오브젝트·영역에 디자인 강조용 모션 프리셋을 적용한 뒤 GIF로 미리보고 내보내는 기능을 구현하기 위한 기준 문서다.

대상 입력 형식은 장기적으로 다음을 포함한다.

- SVG
- PSD
- PDF
- PDF 호환 AI
- 네이티브 AI/EPS
- HTML

단, 모든 형식을 같은 수준으로 편집할 수 있다고 가정하지 않는다. 파일 형식마다 선택 가능한 대상과 적용 가능한 프리셋을 구분한다.

## 2. 제품 정의

기능명은 임시로 `GIF Motion Studio`로 정의한다.

기본 사용자 흐름은 다음과 같다.

1. 디자인 파일 업로드
2. 페이지 또는 아트보드 선택
3. 레이어·오브젝트 또는 사각 영역 선택
4. 모션 프리셋 선택
5. 속도·방향·강도·색상·반복 설정
6. 실시간 GIF 미리보기
7. 스마트스토어용 860px GIF 내보내기
8. 첫 프레임 또는 완성 프레임 PNG 함께 저장

원본 PSD·AI·PDF·SVG·HTML은 직접 변경하거나 덮어쓰지 않는다. 원본은 읽기 전용으로 유지하고, 선택 정보와 모션 설정은 별도의 `GifProject` 상태로 관리한다.

## 3. 핵심 구현 원칙

### 3.1 미리보기와 내보내기는 같은 계산식을 사용한다

화면 미리보기용 CSS 애니메이션과 GIF 내보내기용 애니메이션을 따로 작성하지 않는다.

하나의 순수 함수 `evaluatePreset(timeMs)`가 특정 시점의 위치, 투명도, 크기, 회전, 클리핑과 오버레이 값을 계산한다. 미리보기와 프레임 내보내기는 이 함수를 공통으로 호출한다.

### 3.2 프레임 상태는 절대값으로 계산한다

다음과 같은 누적 방식은 금지한다.

```ts
object.left += 2;
```

반드시 원본 상태를 기준으로 절대값을 계산한다.

```ts
const frame = evaluatePreset(context);
object.left = base.left + (frame.translateX ?? 0);
```

이 원칙을 지키지 않으면 반복 재생할 때 객체가 계속 이동하거나 미리보기와 GIF 결과가 달라진다.

### 3.3 객체 선택형과 영역 선택형을 구분한다

- SVG·PSD·HTML: 실제 요소 또는 레이어 선택이 가능하다.
- PDF·AI: 1차 버전에서는 페이지를 래스터 배경으로 렌더링하고 사각 영역만 선택한다.

PDF·AI의 사각 영역에는 슬라이드 이동이나 순차 등장처럼 원본 요소를 제거해야 하는 프리셋을 적용하지 않는다. 원본 위에 복사본이 겹쳐 보일 수 있기 때문이다.

### 3.4 원본 형식으로 다시 저장하지 않는다

이 기능은 PSD·AI·PDF 편집기가 아니다. 원본에서 읽은 레이어 또는 영역을 GIF 제작에 사용하는 기능이다.

출력 대상은 다음으로 제한한다.

- GIF
- 첫 프레임 PNG
- 마지막 완성 프레임 PNG
- 향후 `gif-project.zip`

## 4. 현재 프로젝트에서 재사용할 구조

### 프런트엔드

- `src/App.tsx`
  - `AppTab`에 `gif-studio` 추가
  - 홈 기능 카드 추가
  - 좌측 메뉴 추가
  - `GifStudioTab` 마운트
- `src/features/illustrator/IllustratorViewerTab.tsx`
  - PSD 레이어 순회 로직 참고
  - PDF.js 페이지 렌더링 로직 참고
  - AI 파일의 PDF 헤더 검사 로직 참고
- `src/features/images/imageClient.ts`
  - 웹 API와 Electron IPC 분기 패턴 참고

### 백엔드와 Electron

- `server.cjs`
  - Multer 업로드 제한 패턴
  - 임시 디렉터리 생성·삭제 패턴
  - Worker Thread 실행 패턴
- `main.cjs`
  - Electron IPC Worker 실행 패턴
  - 저장 위치 선택 패턴
- `preload.cjs`
  - 안전한 Electron API 노출 패턴
- `workers/image.worker.cjs`
  - 작업별 Worker 진입 구조 참고
- `lib/imageProcessor.cjs`
  - Sharp 출력과 파일명 정리 구조 참고

기존 뷰어를 먼저 공통 모듈로 리팩터링하지 않는다. GIF 기능을 신규 모듈로 구현하고 안정화한 뒤 중복 코드를 공통 유틸리티로 옮긴다.

## 5. 라이브러리 구성

### 5.1 기존 라이브러리

| 라이브러리 | 용도 |
| --- | --- |
| `pdfjs-dist` | PDF 페이지를 Canvas로 렌더링 |
| `pdf-lib` | PDF 페이지·문서 구조 확인 |
| `ag-psd` | PSD 레이어·위치·이미지 데이터 읽기 |
| `sharp` | 애니메이션 GIF 인코딩·최적화 |
| `jszip` | 향후 프로젝트 파일 및 결과 묶음 |
| `motion` | 편집기 UI 전환 효과에만 사용 |
| `pixelmatch` | 시각 회귀 테스트 |
| `pngjs` | 테스트 프레임 생성·분석 |

### 5.2 새로 추가할 라이브러리

#### `fabric`

편집 캔버스의 핵심 라이브러리로 사용한다.

- 오브젝트 선택
- 다중 선택
- 사각 영역 선택
- 확대·이동·회전
- 객체 순서 관리
- SVG 파싱
- Canvas 내보내기
- 프로젝트 직렬화 보조

#### `dompurify`

SVG와 HTML에서 스크립트, 이벤트 속성, 위험한 URL을 제거한다.

#### `vitest`

다음 순수 로직의 단위 테스트에 사용한다.

- easing
- 프리셋 계산
- 좌표 변환
- 프레임 샘플링
- GIF 옵션 검증

### 5.3 1차 버전에서 추가하지 않을 라이브러리

- FFmpeg
- `gif.js`
- `gifenc`
- Lottie
- 영상 편집용 타임라인 라이브러리

최종 GIF 인코딩은 기존 Sharp를 사용한다.

## 6. 권장 코드 구조

```text
src/
  features/
    gif-studio/
      GifStudioTab.tsx

      components/
        GifFileDropzone.tsx
        GifEditorShell.tsx
        GifCanvasStage.tsx
        GifLayerPanel.tsx
        GifPresetPanel.tsx
        GifInspectorPanel.tsx
        GifTimelineStrip.tsx
        GifPlaybackControls.tsx
        GifExportDialog.tsx
        GifFormatWarning.tsx

      model/
        types.ts
        gifProjectReducer.ts
        initialProject.ts
        selectors.ts
        history.ts

      importers/
        importDesignFile.ts
        importSvgDocument.ts
        importPsdDocument.ts
        importPdfDocument.ts
        importAiDocument.ts
        importHtmlDocument.ts
        importerUtils.ts

      canvas/
        createEditorCanvas.ts
        createPreviewCanvas.ts
        createExportCanvas.ts
        fabricObjectFactory.ts
        selectionController.ts
        regionSelection.ts
        coordinateSystem.ts

      presets/
        presetTypes.ts
        presetRegistry.ts
        easing.ts
        evaluators/
          fadePulse.ts
          popZoom.ts
          slideReveal.ts
          staggerReveal.ts
          markerSweep.ts
          lightSweep.ts
          clickPulse.ts
          beforeAfterWipe.ts

      rendering/
        animationEvaluator.ts
        previewPlayer.ts
        frameRenderer.ts
        frameSampler.ts
        overlayRenderer.ts

      export/
        gifClient.ts
        electronGifClient.ts
        webGifClient.ts
        exportValidation.ts
        frameBlobEncoder.ts

      utils/
        fileType.ts
        dimensions.ts
        objectUrl.ts
        cleanup.ts

lib/
  gifEncoder.cjs

workers/
  gif.worker.cjs
```

## 7. 공통 데이터 모델

```ts
export type DesignSourceKind =
  | 'svg'
  | 'psd'
  | 'pdf'
  | 'ai'
  | 'html';

export type SelectionCapability =
  | 'object'
  | 'multi-object'
  | 'region'
  | 'text';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesignNode {
  id: string;
  name: string;
  type: 'group' | 'bitmap' | 'vector' | 'text' | 'background';
  bounds: Rect;
  visible: boolean;
  locked: boolean;
  selectable: boolean;
  parentId?: string;
  childIds?: string[];
  assetId?: string;
  sourceMetadata?: Record<string, unknown>;
}

export interface DesignPage {
  id: string;
  name: string;
  width: number;
  height: number;
  nodeIds: string[];
  backgroundAssetId?: string;
}

export interface DesignDocument {
  id: string;
  name: string;
  sourceKind: DesignSourceKind;
  pages: DesignPage[];
  nodes: Record<string, DesignNode>;
  capabilities: SelectionCapability[];
  warnings: string[];
}
```

애니메이션 프로젝트는 별도 모델로 관리한다.

```ts
export interface GifProject {
  version: 1;
  documentId: string;
  activePageId: string;
  selection: SelectionTarget | null;
  clips: AnimationClip[];
  playback: PlaybackSettings;
  export: GifExportSettings;
}

export type SelectionTarget =
  | { kind: 'objects'; nodeIds: string[] }
  | { kind: 'region'; rect: Rect };

export interface AnimationClip {
  id: string;
  presetId: GifPresetId;
  target: SelectionTarget;
  startMs: number;
  durationMs: number;
  delayMs: number;
  easing: EasingId;
  params: Record<string, number | string | boolean>;
}

export interface PlaybackSettings {
  durationMs: number;
  loop: boolean;
  fps: number;
}

export interface GifExportSettings {
  width: number;
  fps: number;
  loopCount: number;
  colors: 128 | 256;
  dither: number;
  effort: number;
  holdFirstMs: number;
  holdLastMs: number;
}
```

프로젝트 상태에는 함수, `HTMLCanvasElement`, Fabric 객체를 직접 저장하지 않는다. 저장 가능한 순수 값만 넣는다.

## 8. 프리셋 엔진

```ts
export interface FrameState {
  opacity?: number;
  translateX?: number;
  translateY?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  clipProgress?: number;
  overlay?: OverlayState;
}

export interface PresetEvaluatorContext {
  timeMs: number;
  durationMs: number;
  easing: EasingId;
  params: Record<string, unknown>;
  targetBounds: Rect;
  targetIndex: number;
  targetCount: number;
}

export type PresetEvaluator = (
  context: PresetEvaluatorContext
) => FrameState;
```

### 8.1 1차 프리셋

| 프리셋 | 객체/레이어 | PDF·AI 영역 |
| --- | ---: | ---: |
| 페이드 펄스 | 가능 | 가능 |
| 팝·줌 | 가능 | 제한적 |
| 슬라이드 등장 | 가능 | 불가 |
| 순차 등장 | 가능 | 불가 |
| 마커 스윕 | 가능 | 가능 |
| 라이트 스윕 | 가능 | 가능 |
| 테두리 펄스 | 가능 | 가능 |
| 클릭 포인터 | 가능 | 가능 |
| 가격 숫자 전환 | 2차 | 불가 |
| Before/After | 2차 | 2차 |

### 8.2 프리셋 정의

```ts
export interface PresetDefinition {
  id: GifPresetId;
  label: string;
  supportedTargets: Array<'objects' | 'region'>;
  requiredCapabilities: SelectionCapability[];
  defaultDurationMs: number;
  defaultParams: Record<string, unknown>;
}
```

지원하지 않는 프리셋은 숨기지 않고 비활성 상태로 보여주며, 적용할 수 없는 이유를 표시한다.

## 9. 형식별 가져오기

### 9.1 SVG

1. SVG 문자열 읽기
2. DOMPurify로 스크립트와 위험 속성 제거
3. Fabric `loadSVGFromString()` 실행
4. reviver에서 원본 요소 ID와 태그 정보를 Fabric 객체에 연결
5. 각 객체에 고유한 `gifNodeId` 부여
6. 원래 z-index와 그룹 구조 보존

SVG 필터·마스크·외부 폰트가 원본과 다를 수 있으므로 다음 모드를 함께 제공한다.

- 요소 편집 모드
- 원본 모양 우선 래스터 모드

### 9.2 PSD

1. `ag-psd`의 `readPsd()`로 읽기
2. 레이어 트리 순회
3. leaf layer의 canvas를 Fabric Image로 변환
4. left, top, opacity, hidden 적용
5. 그룹과 레이어 순서 보존
6. 합성 미리보기는 원본 비교용으로 별도 보관

제한사항:

- 조정 레이어
- 클리핑 마스크
- 일부 블렌딩
- 스마트 오브젝트
- 일부 최신 Photoshop 효과
- 완전한 텍스트 스타일 재현
- PSB 공식 보장 불가

레이어 합성이 원본과 크게 다르면 합성 이미지 기반 영역 선택 모드로 fallback한다.

### 9.3 PDF

1. PDF.js로 페이지 목록 읽기
2. 페이지 선택
3. 목표 출력 폭 기준으로 Canvas 렌더링
4. 렌더링 이미지를 잠긴 배경으로 추가
5. 사각 영역 선택만 허용

1차 버전에서는 PDF 내부의 개별 텍스트·이미지·패스를 객체로 분해하지 않는다.

### 9.4 AI/EPS

1. 파일의 PDF 헤더 확인
2. PDF 호환 AI이면 PDF importer 사용
3. 네이티브 AI/EPS이면 기존 `/preview-illustrator` 호출
4. Ghostscript 결과 PDF를 PDF importer로 전달
5. PDF와 동일하게 사각 영역 선택만 허용

### 9.5 HTML

HTML은 별도 최종 단계로 분리한다.

필요 요소:

- DOMPurify
- sandbox iframe
- DOM 요소별 안정적인 ID
- iframe과 편집기 사이의 좌표 동기화
- 외부 이미지·폰트 CORS 처리
- Headless Chromium 또는 Electron offscreen rendering
- 네트워크 접근 제한
- 프레임별 스크린샷

HTML을 SVG·PSD 단계와 같은 작업에서 구현하지 않는다.

## 10. 캔버스 분리

### Editor Canvas

- 사용자 선택
- 선택 핸들
- 확대·이동
- 영역 박스
- 레이어 편집

### Preview Canvas

- Editor 상태 복제
- 선택 핸들 제거
- `requestAnimationFrame`으로 미리보기
- 프리셋 계산 결과 표시

### Export Canvas

- 숨겨진 Fabric `StaticCanvas`
- 860px 또는 원본 출력 크기
- 고정 fps로 프레임 생성
- 화면 확대 배율과 독립

```ts
const frameCount = Math.ceil((durationMs / 1000) * fps);

for (let index = 0; index < frameCount; index += 1) {
  const timeMs = (index / fps) * 1000;
  applyAbsoluteFrameState(exportCanvas, project, timeMs);
  exportCanvas.renderAll();
  frames.push(await canvasToPngBlob(exportCanvas));
}
```

## 11. GIF 내보내기

브라우저가 PNG 프레임을 생성하고 서버는 GIF 인코딩만 담당한다.

장점:

- 미리보기와 결과가 같은 렌더러 사용
- 서버가 PSD·SVG·PDF를 다시 해석할 필요 없음
- 웹과 Electron에서 프리셋 계산식 공유

### 11.1 웹 API

```http
POST /gif-export
Content-Type: multipart/form-data

frames: frame-000.png
frames: frame-001.png
...
options: {
  "width": 860,
  "fps": 12,
  "loopCount": 0,
  "colors": 256,
  "dither": 0.75,
  "effort": 7,
  "delays": [83, 83, 83, 500]
}
```

권장 제한:

- 최대 90프레임
- 최대 출력 폭 1600px
- 프레임당 최대 8MB
- 전체 업로드 최대 80MB
- PNG만 허용
- 최대 길이 8초
- 임시 디렉터리는 `finally`에서 삭제

### 11.2 Sharp 인코더

```js
const sharp = require('sharp');

async function encodeAnimatedGif({
  framePaths,
  outputPath,
  delays,
  loop,
  colors,
  dither,
  effort,
}) {
  if (!Array.isArray(framePaths) || framePaths.length < 2) {
    throw new Error('GIF에는 2개 이상의 프레임이 필요합니다.');
  }

  await sharp(framePaths, {
    join: { animated: true },
  })
    .gif({
      delay: delays,
      loop,
      colours: colors,
      dither,
      effort,
      keepDuplicateFrames: true,
    })
    .toFile(outputPath);

  return outputPath;
}

module.exports = { encodeAnimatedGif };
```

인코딩은 `workers/gif.worker.cjs`에서 실행한다.

### 11.3 Electron

`preload.cjs`:

```js
gifExport: (payload) => ipcRenderer.invoke('gif-export', payload)
```

`main.cjs` 처리 순서:

1. `dialog.showSaveDialog()`로 저장 위치 선택
2. renderer에서 받은 PNG `Uint8Array`를 임시 파일로 기록
3. GIF Worker 실행
4. 선택 경로에 GIF 저장
5. 임시 파일 삭제

IPC로 원시 RGBA 프레임을 보내지 않는다. 압축 PNG만 전달한다.

## 12. 상태 관리

초기 버전은 `useReducer`를 사용한다.

```ts
interface GifStudioState {
  status: 'idle' | 'importing' | 'ready' | 'previewing' | 'exporting';
  document: DesignDocument | null;
  project: GifProject | null;
  selectedNodeIds: string[];
  selectedRegion: Rect | null;
  activePresetId: GifPresetId | null;
  currentTimeMs: number;
  importWarnings: string[];
  error: string | null;
}
```

Undo/redo는 첫 MVP 이후 reducer action history로 추가한다.

## 13. UI 구성

### 좌측 패널

- 페이지·아트보드 목록
- 레이어 트리
- 레이어 검색
- 표시·숨김
- 객체 선택과 영역 선택 전환

### 중앙 캔버스

- 디자인 표시
- 확대·축소
- Fit to screen
- 선택 테두리
- 안전 영역
- 재생 시 편집 핸들 숨김

### 우측 패널

- 프리셋 목록
- 프리셋 썸네일
- 속도
- 방향
- 강도
- 색상
- 반복
- 시작·종료 정지시간

### 하단 컨트롤

- 재생·정지
- 처음으로
- 현재 시간
- 총 길이
- 단일 scrubber
- 적용된 clip 표시

1차 버전에서는 복수 트랙 전문 타임라인을 구현하지 않는다.

## 14. 성능·품질 기준

- 기본 출력: 860px, 10fps
- 고품질 출력: 860px, 12fps
- 최대 길이: 8초
- 최대 프레임: 90
- 기본 색상: 256
- 첫·마지막 프레임 정지시간 지원
- Preview는 축소 해상도 사용 가능
- Export만 최종 해상도로 렌더링
- Object URL은 사용 종료 시 revoke
- PSD canvas와 프레임 Blob 정리
- base64 문자열 배열 사용 금지
- 진행률과 취소 기능 제공
- `AbortController`로 내보내기 취소

## 15. 테스트 계획

### 단위 테스트

- easing의 0, 0.5, 1 입력
- 프리셋 시작·중간·마지막 상태
- 영역 좌표 변환
- fps별 프레임 수
- 첫·마지막 hold delay
- 지원하지 않는 target/preset 조합
- 최대 프레임·크기 검증

### Importer 테스트

- 단순 SVG
- 2개 레이어 PSD
- 2페이지 PDF
- PDF 호환 AI
- 네이티브 AI 변환 실패

### GIF 인코더 테스트

1. 빨강·초록·파랑 PNG 3개 생성
2. Sharp GIF 생성
3. 애니메이션 metadata 읽기
4. `pages === 3` 확인
5. width, height, loop, delay 확인

### 시각 회귀 테스트

기존 `pixelmatch`와 `pngjs`로 각 프리셋의 시작·중간·마지막 프레임을 비교한다.

### 기본 검증 명령

```powershell
node .\node_modules\typescript\bin\tsc --noEmit
node .\node_modules\vite\bin\vite.js build
node --check server.cjs
node --check main.cjs
node --check workers/gif.worker.cjs
node --check lib/gifEncoder.cjs
```

## 16. 단계별 구현 계획

### 단계 1: GIF 인코더 기술 검증

구현:

- `lib/gifEncoder.cjs`
- `workers/gif.worker.cjs`
- 3개 PNG를 GIF로 생성하는 검증 스크립트

완료 조건:

- 3프레임 GIF 생성
- 프레임 수·delay·loop 검증
- Node 문법 검사 통과

### 단계 2: PNG 기반 편집기 뼈대

구현:

- Fabric Canvas
- PNG 업로드
- 사각 영역 선택
- 마커·라이트·테두리 프리셋
- 미리보기
- 웹 GIF 내보내기

완료 조건:

- 선택 영역이 정확히 표시됨
- 미리보기와 내보낸 GIF의 핵심 프레임 일치
- 860px 결과 생성

### 단계 3: SVG 객체 선택

구현:

- DOMPurify 처리
- SVG 객체 분리
- 레이어 선택
- 팝·슬라이드·순차 등장
- z-index 보존

완료 조건:

- 단순 SVG에서 객체 선택 가능
- 다중 선택 순차 등장 가능
- unsupported 요소 경고

### 단계 4: PSD 레이어 선택

구현:

- 레이어 트리
- PSD layer canvas → Fabric Image
- 표시·숨김
- 레이어 모션
- 합성 이미지 fallback

완료 조건:

- 테스트 PSD 레이어 순서 일치
- 원본 합성 미리보기 제공
- 지원 불완전 파일 경고

### 단계 5: PDF·AI

구현:

- PDF 페이지 선택
- PDF 호환 AI
- Ghostscript 변환 AI/EPS
- 영역형 프리셋 제한

완료 조건:

- PDF 페이지가 860px 기준으로 렌더링
- AI 변환 결과를 PDF importer가 처리
- 객체 이동형 프리셋 비활성화

### 단계 6: 앱·Electron 통합

구현:

- 홈 카드와 메뉴
- `/gif-export`
- Electron IPC
- 진행률·오류·취소
- 저장 대화상자

완료 조건:

- 웹과 Electron 양쪽에서 GIF 저장
- 임시 파일 정리
- TypeScript와 Vite 빌드 통과

### 단계 7: 고급 프리셋

- 가격 전환
- 숫자 카운트
- Before/After
- 복수 clip
- Undo/redo
- 프로젝트 저장·불러오기

### 단계 8: HTML 기술 검증·구현

HTML은 별도 작업으로 수행한다. 다른 형식 구현과 같은 단계에 포함하지 않는다.

## 17. GPT-5.6 Sol High 실행 권장안

GPT-5.6 Sol High에는 이 문서 전체를 참고자료로 제공하되, 한 번에 전체 구현을 지시하지 않는다.

### 권장 방식

- 단계 1부터 순서대로 진행
- 한 작업에서는 한 단계만 구현
- 단계가 끝날 때마다 지정된 검증 수행
- 결과와 남은 위험을 보고한 뒤 중단
- 다음 단계는 새 작업에서 시작
- 기존 파일의 관련 없는 변경 금지
- 기존 Viewer를 초기 단계에서 리팩터링하지 않음

### 한 번에 시키면 위험한 범위

- 모든 파일 형식 동시 지원
- HTML 보안과 Chromium 렌더링
- PDF·AI 내부 객체 자동 분리
- PSD 원본과 100% 동일한 레이어 합성
- 전문 타임라인
- 고급 프리셋과 프로젝트 저장
- 성능 최적화까지 동시 구현

### 모델에 전달할 핵심 지시문

> 전체 기능을 한 번에 구현하지 말 것. 현재 단계의 파일 범위 밖을 수정하지 말고, 해당 단계의 타입 검사·빌드·핵심 동작 검증이 통과한 뒤 중단하여 결과를 보고할 것. 미리보기와 내보내기는 반드시 동일한 순수 프리셋 평가 함수를 사용한다. PDF·AI의 사각 영역에는 객체 이동형 프리셋을 허용하지 않는다. 기존 뷰어와 이미지 도구의 동작을 깨뜨리지 않는다.

## 18. 최종 판단

GPT-5.6 Sol High는 이 기능을 구현할 모델로 충분히 적합한 선택이다. 다만 이 판단은 단계별 구현을 전제로 한다.

- 단계 1~2: Sol High로 충분
- 단계 3~4: Sol High로 가능, 시각 검증 필요
- 단계 5~6: Sol High로 가능, 웹·Electron 경로를 분리 검증해야 함
- 단계 7: 별도 작업 권장
- 단계 8 HTML: 별도 기술 설계와 강한 검증 필요

전체 범위를 한 번에 지시하는 방식은 모델 등급과 무관하게 권장하지 않는다.
