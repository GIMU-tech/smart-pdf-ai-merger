---
title: AI PDF Toolkit
emoji: 📄
colorFrom: blue
colorTo: purple
sdk: docker
pinned: false
app_port: 7860
---

# 디자인 통합 작업 허브

PDF, AI, PSD, 이미지 파일을 한 곳에서 정리하고 검수하는 디자인/인쇄 작업용 데스크톱 및 웹 툴킷입니다.  
메인 화면은 작업 허브 형태로 구성되어 있으며, PDF 병합, 인쇄용 변환, PDF 비교, 파일 뷰어, 이미지 작업 기능으로 바로 진입할 수 있습니다.

## 주요 기능

- **PDF 병합**: PDF, PDF 호환 AI, 이미지, SVG 파일을 순서대로 하나의 PDF로 병합합니다.
- **인쇄용 변환**: Ghostscript 기반으로 PDF/AI 파일을 인쇄 전달용 PDF 패키지로 변환합니다.
- **PDF 비교**: 원본과 수정본 PDF를 대조해 텍스트, 숫자, 도면, 레이아웃 변경 후보를 검수합니다.
- **뷰어**: AI, EPS, SVG, PDF, PSD 파일을 열어 확대 검수합니다.
- **PSD 검사**: PSD 레이어와 텍스트를 탐색하고, 선택한 레이어 위치를 미리보기 위에 표시합니다.
- **이미지 툴킷**: 이미지 크기 변경, 이어붙이기, 긴 이미지 자르기, HTML 이미지 링크 수집을 처리합니다.

## 화면 구성

- **홈**: 디자인 통합 작업 허브. 모든 기능을 카테고리별로 바로 실행합니다.
- **PDF 병합**: 파일 드래그 앤 드롭, 병합 순서 관리, 결과 PDF 저장.
- **인쇄용 변환**: 원본/인쇄용 산출물 패키지 생성.
- **PDF 비교**: 정밀 대조 모드와 빠른 육안 검수 모드 제공.
- **뷰어**: PDF 원본/이미지 렌더 모드, PSD 레이어 검색 및 선택 해제.
- **이미지 툴킷**: 작업 옵션, 업로드 목록, 대형 미리보기 대지, 결과 목록으로 구성.

## 기술 스택

- React 19
- Vite
- TypeScript
- Electron
- Express
- pdf-lib
- pdfjs-dist
- Ghostscript
- MuPDF
- Tesseract.js
- OpenCV.js
- sharp
- ag-psd
- JSZip

## 로컬 실행

### 1. 의존성 설치

```bash
npm install
```

### 2. 웹 개발 서버 실행

```bash
npm run dev
```

기본 개발 서버는 `http://localhost:3000`에서 실행됩니다.

### 3. API 서버 실행

```bash
npm run server
```

기본 API 서버는 `http://localhost:8080`에서 실행됩니다.

### 4. Electron 실행

```bash
npm run electron:start
```

## 빌드

```bash
npm run build
```

Electron 패키징은 아래 명령을 사용합니다.

```bash
npm run electron:build
```

## 검증 명령

```bash
npm run lint
npm run build
node --check server.cjs
node --check main.cjs
node --check workers/compare.worker.cjs
node --check workers/image.worker.cjs
```

## 주요 폴더

```text
smart-pdf-&-ai-merger/
├─ src/
│  ├─ App.tsx
│  └─ features/
│     ├─ compare/
│     │  └─ CompareTab.tsx
│     ├─ illustrator/
│     │  └─ IllustratorViewerTab.tsx
│     └─ images/
│        ├─ ImageToolkitTab.tsx
│        ├─ imageClient.ts
│        └─ types.ts
├─ workers/
│  ├─ compare.worker.cjs
│  └─ image.worker.cjs
├─ lib/
│  ├─ imageProcessor.cjs
│  └─ htmlImageCollector.cjs
├─ main.cjs
├─ preload.cjs
├─ server.cjs
└─ package.json
```

## 배포 메모

이 프로젝트는 Hugging Face Spaces Docker 환경을 고려한 README front matter를 유지합니다.  
`README.md` 상단의 YAML 설정은 배포 설정에 사용될 수 있으므로 삭제하지 마세요.

GitHub에 `main` 브랜치가 푸시되면 연결된 배포 워크플로가 있는 경우 자동 배포가 이어질 수 있습니다.

## 주의 사항

- `node_modules/`, `dist/`, `release/`, 로그 파일, `temp_uploads/`는 Git에 포함하지 않습니다.
- `kor.traineddata`, `eng.traineddata`는 OCR 기능에 필요합니다.
- Windows 경로에 `&`가 포함되어 있으므로 npm 스크립트가 불안정할 때는 `node .\node_modules\...\bin` 형태의 직접 실행이 더 안정적입니다.
