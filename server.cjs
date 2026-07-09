const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const JSZip = require('jszip');
const sharp = require('sharp');

function loadLocalEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadLocalEnvFile();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// In-memory task queue to bypass Render's 30-second timeout
const tasks = new Map();

// Periodic cleanup of expired tasks (older than 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [taskId, task] of tasks.entries()) {
    if (now - task.createdAt > 10 * 60 * 1000) {
      tasks.delete(taskId);
    }
  }
}, 60 * 1000);

// Configure Multer for secure temporary file uploads
const upload = multer({ dest: os.tmpdir() });

// Resolve Ghostscript and MuPDF path dynamically (embedded vs system-wide for Docker/Linux)
const isWindows = process.platform === 'win32';
const localGsPath = path.join(__dirname, 'bin', 'gs', 'bin', 'gswin64c.exe');
const localGsLibPath = path.join(__dirname, 'bin', 'gs', 'lib');

const gsPath = fs.existsSync(localGsPath) ? localGsPath : 'gs';
const gsLibPath = fs.existsSync(localGsLibPath) ? localGsLibPath : '';

console.log(`[API Server] Using Ghostscript path: ${gsPath}`);
if (gsLibPath) {
  console.log(`[API Server] Using Ghostscript library path: ${gsLibPath}`);
}

// Ensure temp upload directory exists
const tempDir = path.join(__dirname, 'temp_uploads');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}
const localUpload = multer({ dest: tempDir });
const imageUpload = multer({
  dest: tempDir,
  limits: {
    files: 100,
    fileSize: 50 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(originalName).replace('.', '').toLowerCase();
    if (file.fieldname === 'htmlFile' && ['html', 'htm'].includes(ext)) {
      cb(null, true);
      return;
    }
    if (file.fieldname === 'files' && ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error('지원하지 않는 파일 형식입니다.'));
  },
});

// Serve static assets from Vite's build directory (dist)
app.use(express.static(path.join(__dirname, 'dist')));

// Route 0: Serve React Web App at Root
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send(`
      <div style="font-family: sans-serif; text-align: center; margin-top: 100px;">
        <h2>PDF & AI Toolkit API Service Running</h2>
        <p>Frontend static files (dist/) not built yet. Please build with <b>npm run build</b>.</p>
        <span style="background: #e6fffa; color: #00875a; padding: 4px 12px; border-radius: 99px;">Active</span>
      </div>
    `);
  }
});

// Route 1: Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', platform: process.platform, arch: process.arch });
});

function runImageWorker(workerData) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'workers', 'image.worker.cjs');
    const worker = new Worker(workerPath, { workerData });
    let settled = false;

    worker.on('message', (message) => {
      settled = true;
      resolve(message);
    });

    worker.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    worker.on('exit', (code) => {
      if (code !== 0 && !settled) {
        reject(new Error(`이미지 워커가 비정상적으로 종료되었습니다 (code: ${code}).`));
      }
    });
  });
}

function sanitizeUploadName(name, fallback) {
  const parsed = path.parse(name || fallback || 'image');
  const safeBase = (parsed.name || 'image').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'image';
  const safeExt = (parsed.ext || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
  return `${safeBase}${safeExt}`;
}

function uniquePathInDir(dir, fileName, usedNames) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = fileName;
  let index = 2;

  while (usedNames.has(candidate.toLowerCase()) || fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base}_${index}${ext}`;
    index += 1;
  }

  usedNames.add(candidate.toLowerCase());
  return path.join(dir, candidate);
}

function collectUploadedImageFiles(req) {
  const files = req.files?.files || [];
  return Array.isArray(files) ? files : [];
}

function collectUploadedHtmlFile(req) {
  const files = req.files?.htmlFile || [];
  return Array.isArray(files) ? files[0] : null;
}

function isLocalRequest(req) {
  const remoteAddress = req.socket?.remoteAddress || req.ip || '';
  return [
    '::1',
    '127.0.0.1',
    '::ffff:127.0.0.1',
  ].includes(remoteAddress) || remoteAddress.endsWith(':127.0.0.1');
}

function imageUploadMiddleware(req, res, next) {
  imageUpload.fields([{ name: 'files', maxCount: 100 }, { name: 'htmlFile', maxCount: 1 }])(req, res, (err) => {
    if (!err) {
      next();
      return;
    }

    const errorMessage =
      err.code === 'LIMIT_FILE_SIZE'
        ? '단일 파일은 50MB 이하만 업로드할 수 있습니다.'
        : err.code === 'LIMIT_FILE_COUNT'
          ? '이미지는 최대 100개까지 업로드할 수 있습니다.'
          : err.message || '이미지 업로드 중 오류가 발생했습니다.';

    res.status(400).json({ success: false, error: errorMessage });
  });
}

function positiveInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function expectedCutPositions(totalPixels, options) {
  const maxPixels = positiveInteger(options.maxPixels, 3000);
  const minLastChunkPixels = Math.max(0, positiveInteger(options.minLastChunkPixels, 300));
  const cuts = [];
  let cursor = maxPixels;

  while (cursor < totalPixels - minLastChunkPixels) {
    cuts.push(cursor);
    cursor += maxPixels;
  }

  return cuts;
}

function parseGeminiJson(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

function normalizeGeminiCuts(rawCuts, totalPixels, options) {
  if (!Array.isArray(rawCuts)) return [];
  const minGap = Math.max(40, Math.min(positiveInteger(options.minLastChunkPixels, 300), positiveInteger(options.maxPixels, 3000) - 1));
  const cuts = Array.from(new Set(
    rawCuts
      .map(value => Number(value))
      .filter(value => Number.isFinite(value))
      .map(value => Math.round(value))
      .map(value => clamp(value, 1, totalPixels - 1))
  )).sort((a, b) => a - b);

  const filtered = [];
  let previous = 0;
  for (const cut of cuts) {
    if (cut - previous < minGap) continue;
    if (totalPixels - cut < minGap) continue;
    filtered.push(cut);
    previous = cut;
  }

  return filtered;
}

async function buildGeminiSplitPreview(inputPath, options) {
  const metadata = await sharp(inputPath, { animated: false }).rotate().metadata();
  const axis = options.axis === 'horizontal' ? 'horizontal' : 'vertical';
  const originalWidth = metadata.width || 1;
  const originalHeight = metadata.height || 1;

  const { data, info } = await sharp(inputPath, { animated: false })
    .rotate()
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const originalAxisPixels = axis === 'vertical' ? originalHeight : originalWidth;
  const previewAxisPixels = axis === 'vertical' ? info.height : info.width;

  return {
    data,
    mimeType: 'image/jpeg',
    axis,
    originalWidth,
    originalHeight,
    previewWidth: info.width,
    previewHeight: info.height,
    originalAxisPixels,
    previewAxisPixels,
    axisScale: previewAxisPixels / originalAxisPixels,
    isOriginalResolution: info.width === originalWidth && info.height === originalHeight,
  };
}

function sectionLengthsFromCuts(cuts, totalPixels) {
  const points = [0, ...cuts, totalPixels];
  const lengths = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    lengths.push(points[index + 1] - points[index]);
  }
  return lengths;
}

function findGeminiCutViolations(cuts, totalPixels, options) {
  const maxPixels = positiveInteger(options.maxPixels, 3000);
  const minLastChunkPixels = Math.max(0, positiveInteger(options.minLastChunkPixels, 300));
  const lengths = sectionLengthsFromCuts(cuts, totalPixels);
  return lengths
    .map((length, index) => ({ index: index + 1, length }))
    .filter(item => item.length > maxPixels || item.length < minLastChunkPixels);
}

async function requestGeminiJson({ apiKey, model, prompt, imageBuffer, mimeType }) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: imageBuffer.toString('base64'),
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (response.ok) {
      const payload = await response.json();
      const text = payload?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('\n') || '';
      return parseGeminiJson(text);
    }

    lastError = new Error(`Gemini API ?붿껌 ?ㅽ뙣: ${response.status} ${errorText.slice(0, 180)}`);
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
      throw lastError;
    }

    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }

  throw lastError || new Error('Gemini API ?붿껌 ?ㅽ뙣');
}

async function buildGeminiCrop(inputPath, crop, axis) {
  const extract =
    axis === 'vertical'
      ? { left: 0, top: crop.start, width: crop.width, height: crop.length }
      : { left: crop.start, top: 0, width: crop.length, height: crop.height };

  const { data, info } = await sharp(inputPath, { animated: false })
    .rotate()
    .extract(extract)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    mimeType: 'image/jpeg',
    width: info.width,
    height: info.height,
  };
}

async function requestGeminiWindowedSplitCuts(inputPath, options, failedWholeImageError) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_IMAGE_SPLIT_MODEL || 'gemini-2.5-flash';
  const metadata = await sharp(inputPath, { animated: false }).rotate().metadata();
  const axis = options.axis === 'horizontal' ? 'horizontal' : 'vertical';
  const originalWidth = metadata.width || 1;
  const originalHeight = metadata.height || 1;
  const totalPixels = axis === 'vertical' ? originalHeight : originalWidth;
  const maxPixels = positiveInteger(options.maxPixels, 3000);
  const minLastChunkPixels = Math.max(0, positiveInteger(options.minLastChunkPixels, 300));
  const lookAheadPixels = Math.min(maxPixels, Math.max(900, Math.round(maxPixels * 0.55)));
  const cuts = [];
  const reasons = [];
  let cursor = 0;

  while (totalPixels - cursor > maxPixels) {
    const remaining = totalPixels - cursor;
    const cropLength = Math.min(remaining, maxPixels + lookAheadPixels);
    const crop = axis === 'vertical'
      ? { start: cursor, length: cropLength, width: originalWidth, height: cropLength }
      : { start: cursor, length: cropLength, width: cropLength, height: originalHeight };
    const cropImage = await buildGeminiCrop(inputPath, crop, axis);
    const maxLocalCut = Math.min(maxPixels, remaining - minLastChunkPixels);
    const minLocalCut = Math.max(minLastChunkPixels, 1);

    const prompt = [
      'You are splitting a long commerce/detail-page image into natural sections.',
      'This attached image is an ORIGINAL-RESOLUTION crop from the page, not a resized overview.',
      'The current output section starts at the top/left edge of this crop.',
      'Choose exactly ONE next cut position inside this crop.',
      'The cut must be a local crop coordinate, not a global page coordinate.',
      'The cut must be at a real semantic boundary under the hard maximum length.',
      'Never cut through a product photo, image card, heading, subheading, table, spec block, notice block, Q&A block, color chart, or a heading/subheading and the content directly below it.',
      'If the cleanest section boundary is slightly before the maximum, choose that boundary.',
      'If a visual section is longer than the maximum, choose the least harmful internal whitespace before the maximum.',
      `Hard local cut range: ${minLocalCut}px <= cut <= ${maxLocalCut}px.`,
      `Original full page size: ${originalWidth}x${originalHeight}px.`,
      `Crop global ${axis === 'vertical' ? 'Y' : 'X'} range: ${cursor} to ${cursor + cropLength}px.`,
      `Crop image size: ${cropImage.width}x${cropImage.height}px.`,
      `Maximum final section length: ${maxPixels}px.`,
      `Minimum final section length: ${minLastChunkPixels}px.`,
      'Return JSON only. No markdown.',
      '{"coordinateBasis":"crop","cut":number,"reason":"short Korean explanation"}',
    ].join('\n');

    const parsed = await requestGeminiJson({
      apiKey,
      model,
      prompt,
      imageBuffer: cropImage.data,
      mimeType: cropImage.mimeType,
    });

    const localCut = Math.round(Number(parsed.cut));
    if (!Number.isFinite(localCut) || localCut < minLocalCut || localCut > maxLocalCut) {
      throw new Error(`Gemini가 유효하지 않은 crop cut을 반환했습니다: ${parsed.cut}. 허용 범위 ${minLocalCut}-${maxLocalCut}px.`);
    }

    const globalCut = cursor + localCut;
    if (globalCut <= cursor || globalCut >= totalPixels) {
      throw new Error(`Gemini crop cut 변환이 유효하지 않습니다: ${globalCut}px.`);
    }

    cuts.push(globalCut);
    reasons.push(`${globalCut}px: ${parsed.reason || ''}`.trim());
    cursor = globalCut;
  }

  const violations = findGeminiCutViolations(cuts, totalPixels, options);
  if (violations.length > 0) {
    const summary = violations.map(item => `${item.index}번 섹션 ${item.length}px`).join(', ');
    throw new Error(`Gemini windowed split이 설정한 분할 기준을 지키지 못했습니다: ${summary}.`);
  }

  return {
    cuts,
    model,
    preview: {
      axis,
      originalWidth,
      originalHeight,
      previewWidth: originalWidth,
      previewHeight: originalHeight,
      originalAxisPixels: totalPixels,
      previewAxisPixels: totalPixels,
      axisScale: 1,
      isOriginalResolution: true,
    },
    reason: `전체 원본 이미지는 API가 거절하여 원본 해상도 crop 방식으로 판단했습니다. ${reasons.join(' / ')}`,
    coordinateBasis: 'original-windowed',
    rawOriginalCuts: cuts,
    wholeImageError: failedWholeImageError?.message || '',
  };
}

async function requestGeminiSplitCuts(inputPath, options) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY가 설정되어 있지 않습니다.');
  }

  const model = process.env.GEMINI_IMAGE_SPLIT_MODEL || 'gemini-2.5-flash';
  const preview = await buildGeminiSplitPreview(inputPath, options);
  const totalPixels = preview.originalAxisPixels;
  const approximateOriginalCuts = expectedCutPositions(totalPixels, options);
  const maxPixels = positiveInteger(options.maxPixels, 3000);
  const searchWindow = positiveInteger(options.searchWindow, 300);
  const minLastChunkPixels = Math.max(0, positiveInteger(options.minLastChunkPixels, 300));
  const originalSearchWindow = Math.max(80, searchWindow);

  if (totalPixels <= maxPixels) {
    return { cuts: [], model, preview };
  }

  const prompt = [
    'You are helping split a long commerce/detail-page image into natural sections.',
    'The attached image preserves the ORIGINAL pixel dimensions. Read the page structure directly from this image.',
    'Your job is to return every cut position needed to split the page into natural sections.',
    'A section means a meaningful visual group: heading/subheading, body text, related product images, callouts, tables, warnings, Q&A blocks, specs, and footer blocks that belong together.',
    'Choose cut positions that preserve visual meaning while always respecting the maximum section length.',
    'Never cut through product photos, image cards, important text, tables, specification tables, color charts, product-card groups, section headings, or a heading/subheading and the content directly below it.',
    'A section heading and its following body are atomic. Do not cut immediately after or underneath headings such as product names, feature titles, table titles, Q&A titles, notice titles, spec titles, PEN INFO, or PEN COLOR.',
    'If a meaningful section is longer than the maximum length, split it at the cleanest internal whitespace between sub-blocks, not through an image or heading.',
    'Prefer real section boundaries, whitespace between cards, gutters between image blocks, repeated point markers, or quiet background bands.',
    `Hard limit: every final section MUST be ${maxPixels}px or shorter in the ORIGINAL image. Do not return cuts that would create a section taller/longer than ${maxPixels}px.`,
    `Within that hard limit, choose the most natural content boundaries. If a meaningful group is longer than ${maxPixels}px, split it at the cleanest internal whitespace or quiet band before reaching ${maxPixels}px.`,
    `Do not create ANY section shorter than ${minLastChunkPixels}px in the ORIGINAL image.`,
    'Prefer fewer, larger, meaningful sections only when every section still respects the hard maximum length.',
    'If you are unsure whether a boundary splits a section, choose the cleanest boundary before the hard maximum length instead of exceeding it.',
    'If a color chart, specification table, product image group, or ending brand/footer block would become a tiny fragment, keep it attached to the previous or next meaningful section.',
    'Before returning, mentally verify every resulting section length between consecutive cuts is within the hard limit and that no image card or heading group is sliced.',
    'Return JSON only. No markdown.',
    '',
    `Axis: ${preview.axis}.`,
    `Original image size: ${preview.originalWidth}x${preview.originalHeight}px.`,
    `Attached image size: ${preview.previewWidth}x${preview.previewHeight}px.`,
    `Attached image resolution basis: ${preview.isOriginalResolution ? 'original-resolution' : 'scaled'}.`,
    `Return cut positions in ORIGINAL pixels along the ${preview.axis === 'vertical' ? 'Y axis from top to bottom' : 'X axis from left to right'}.`,
    `Approximate ORIGINAL cut positions for rough planning only. Add, move, or remove cuts as needed, but every final section must be ${maxPixels}px or shorter: ${approximateOriginalCuts.join(', ') || 'none'}.`,
    `Do not optimize for staying within ${originalSearchWindow}px of the rough positions. Optimize for valid section boundaries under the hard maximum length.`,
    '',
    'JSON schema:',
    '{"coordinateBasis":"original","cuts":[number],"reason":"short Korean explanation"}',
  ].join('\n');

  const parsed = await requestGeminiJson({
    apiKey,
    model,
    prompt,
    imageBuffer: preview.data,
    mimeType: preview.mimeType,
  });

  const coordinateBasis = String(parsed.coordinateBasis || 'original').toLowerCase();
  const rawCuts = Array.isArray(parsed.cuts) && coordinateBasis.includes('preview')
    ? parsed.cuts.map(value => Number(value) / preview.axisScale)
    : parsed.cuts;
  const cuts = normalizeGeminiCuts(rawCuts, totalPixels, options);
  const violations = findGeminiCutViolations(cuts, totalPixels, options);

  if (violations.length > 0) {
    const summary = violations.map(item => `${item.index}번 섹션 ${item.length}px`).join(', ');
    throw new Error(`Gemini가 설정한 분할 기준을 지키지 못했습니다: ${summary}. 최대 ${maxPixels}px 이하로 다시 시도해 주세요.`);
  }

  return {
    cuts,
    model,
    preview,
    reason: parsed.reason || '',
    coordinateBasis: coordinateBasis.includes('preview') ? 'preview-converted-to-original' : 'original',
    rawOriginalCuts: rawCuts || [],
  };
}

async function applyGeminiSplitOptions(inputPaths, options) {
  if (options.strategy !== 'ai-flow') return options;

  const manualCutsByFile = {};
  const aiResults = [];

  for (const inputPath of inputPaths) {
    let result;
    try {
      result = await requestGeminiSplitCuts(inputPath, options);
    } catch (err) {
      if (!String(err?.message || '').includes('Unable to process input image')) {
        throw err;
      }
      result = await requestGeminiWindowedSplitCuts(inputPath, options, err);
    }
    manualCutsByFile[path.basename(inputPath)] = result.cuts;
    aiResults.push({
      fileName: path.basename(inputPath),
      cuts: result.cuts,
      reason: result.reason,
      model: result.model,
      coordinateBasis: result.coordinateBasis,
      wholeImageError: result.wholeImageError,
    });
  }

  return {
    ...options,
    strategy: 'ai-flow',
    manualCutsByFile,
    aiFlow: {
      provider: 'gemini',
      model: aiResults[0]?.model || process.env.GEMINI_IMAGE_SPLIT_MODEL || 'gemini-2.5-flash',
      results: aiResults,
    },
  };
}

// Route 1.5: Image toolkit operations for web browser uploads
app.post('/image-process', imageUploadMiddleware, async (req, res) => {
  const uploadedFiles = collectUploadedImageFiles(req);
  const uploadedHtmlFile = collectUploadedHtmlFile(req);
  const operation = req.body.operation;
  const workDir = path.join(tempDir, `image_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);
  const inputDir = path.join(workDir, 'input');
  const outputDir = path.join(workDir, 'output');

  try {
    if (!['resize', 'stitch', 'split', 'html'].includes(operation)) {
      return res.status(400).json({ success: false, error: '지원하지 않는 이미지 작업입니다.' });
    }

    if (operation !== 'html' && uploadedFiles.length === 0) {
      return res.status(400).json({ success: false, error: '이미지 파일을 추가해주세요.' });
    }

    if (operation === 'html' && !uploadedHtmlFile && !String(req.body.htmlText || '').trim()) {
      return res.status(400).json({ success: false, error: 'HTML 파일을 업로드하거나 HTML 코드를 입력해주세요.' });
    }

    let options = {};
    try {
      options = req.body.options ? JSON.parse(req.body.options) : {};
    } catch (err) {
      return res.status(400).json({ success: false, error: '이미지 처리 옵션을 읽을 수 없습니다.' });
    }

    fs.mkdirSync(inputDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    const usedNames = new Set();
    const inputPaths = [];
    for (const uploaded of uploadedFiles) {
      const originalName = Buffer.from(uploaded.originalname, 'latin1').toString('utf8');
      const safeName = sanitizeUploadName(originalName, uploaded.filename);
      const targetPath = uniquePathInDir(inputDir, safeName, usedNames);
      fs.renameSync(uploaded.path, targetPath);
      inputPaths.push(targetPath);
    }

    let htmlFilePath = '';
    if (uploadedHtmlFile) {
      const originalName = Buffer.from(uploadedHtmlFile.originalname, 'latin1').toString('utf8');
      const safeName = sanitizeUploadName(originalName, uploadedHtmlFile.filename);
      htmlFilePath = uniquePathInDir(inputDir, safeName, usedNames);
      fs.renameSync(uploadedHtmlFile.path, htmlFilePath);
    }

    const allowLocalSource = process.env.ALLOW_LOCAL_IMAGE_URLS === 'true' || isLocalRequest(req);

    let processedOptions = options;
    if (operation === 'split' && options.strategy === 'ai-flow') {
      try {
        processedOptions = await applyGeminiSplitOptions(inputPaths, options);
      } catch (err) {
        return res.status(400).json({
          success: false,
          error: err.message || 'Gemini AI split failed.',
        });
      }
    }

    const result = await runImageWorker({
      operation,
      inputPaths,
      htmlText: req.body.htmlText || '',
      htmlFilePath,
      outputDir,
      options: processedOptions,
      allowLocalUrls: allowLocalSource,
      allowFileUrls: allowLocalSource,
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error || '이미지 처리 중 오류가 발생했습니다.' });
    }

    const zip = new JSZip();
    let hasManifestFile = false;
    for (const file of result.files || []) {
      if (!file.path || !fs.existsSync(file.path)) continue;
      const zipPath = file.relativePath || file.fileName || path.basename(file.path);
      if (zipPath === 'manifest.json') hasManifestFile = true;
      zip.file(zipPath, fs.readFileSync(file.path));
    }
    if (!hasManifestFile) {
      zip.file('manifest.json', JSON.stringify(result.manifest || { operation, count: result.files?.length || 0 }, null, 2));
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const zipName =
      operation === 'resize'
        ? 'image_resize_results.zip'
        : operation === 'stitch'
          ? 'image_stitch_results.zip'
          : operation === 'split'
            ? 'image_split_results.zip'
            : 'image_results.zip';

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('X-File-Name', encodeURIComponent(zipName));
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.send(zipBuffer);
  } catch (err) {
    console.error('[API Server] Image process failed:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message || '이미지 처리 중 오류가 발생했습니다.' });
    }
  } finally {
    for (const uploaded of uploadedFiles) {
      try {
        if (uploaded.path && fs.existsSync(uploaded.path)) fs.unlinkSync(uploaded.path);
      } catch (_) {}
    }
    if (uploadedHtmlFile) {
      try {
        if (uploadedHtmlFile.path && fs.existsSync(uploadedHtmlFile.path)) fs.unlinkSync(uploadedHtmlFile.path);
      } catch (_) {}
    }
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (_) {}
  }
});

// Route 2: Outline PDF/AI files
app.post('/process-outline', localUpload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '업로드된 파일이 없습니다.' });
  }

  const file = req.file;
  const filePath = file.path;
  // Fix multer's latin1 encoding issue for Korean filenames
  const originalNameUtf8 = Buffer.from(file.originalname, 'latin1').toString('utf8');
  const cleanName = path.parse(originalNameUtf8).name || 'document';
  
  // Create output paths in temporary folder
  const printPdfPath = path.join(tempDir, `(인쇄용)${cleanName}_${Date.now()}.pdf`);

  // Check if Ghostscript exists (either local or system-wide)
  if (gsPath !== 'gs' && !fs.existsSync(gsPath)) {
    try { fs.unlinkSync(filePath); } catch (_) {}
    return res.status(500).json({ success: false, error: '변환 엔진(Ghostscript)이 준비되지 않았습니다.' });
  }

  // Execute Ghostscript outliner
  const args = [
    '-dNOPAUSE',
    '-dBATCH',
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.6',
    '-dPDFSETTINGS=/prepress',
    '-dNoOutputFonts=true',
    '-dUseCropBox',
    '-o', printPdfPath,
  ];

  if (gsLibPath) {
    args.unshift(`-I${gsLibPath}`);
  }

  args.push(filePath);

  execFile(gsPath, args, (err, stdout, stderr) => {
    // Delete raw uploaded file
    try { fs.unlinkSync(filePath); } catch (_) {}

    if (err) {
      console.error('[API Server] Outline failed:', err, stderr);
      return res.status(500).json({ success: false, error: `아웃라인 처리 실패: ${stderr || err.message}` });
    }

    // Read the outlined PDF as base64 and return
    try {
      const fileBuffer = fs.readFileSync(printPdfPath);
      const base64Data = fileBuffer.toString('base64');
      
      // Clean up output file
      try { fs.unlinkSync(printPdfPath); } catch (_) {}

      res.json({
        success: true,
        fileName: `(인쇄용)${cleanName}.pdf`,
        originalName: cleanName,
        fileData: base64Data
      });
    } catch (readErr) {
      console.error('[API Server] File read error:', readErr);
      res.status(500).json({ success: false, error: '출력 파일 리딩에 실패했습니다.' });
    }
  });
});

// Route 2.25: Preview Illustrator/PDF/SVG/EPS files
app.post('/preview-illustrator', localUpload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '업로드된 파일이 없습니다.' });
  }

  const uploadedPath = req.file.path;
  const originalNameUtf8 = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const ext = path.extname(originalNameUtf8).replace('.', '').toLowerCase();
  const baseName = path.parse(originalNameUtf8).name || 'preview';
  const allowed = new Set(['ai', 'eps', 'pdf', 'svg']);

  if (!allowed.has(ext)) {
    try { fs.unlinkSync(uploadedPath); } catch (_) {}
    return res.status(400).json({ success: false, error: 'AI, EPS, SVG, PDF 파일만 미리보기할 수 있습니다.' });
  }

  if (ext === 'svg') {
    try {
      const svgData = fs.readFileSync(uploadedPath).toString('base64');
      try { fs.unlinkSync(uploadedPath); } catch (_) {}
      return res.json({
        success: true,
        mode: 'image',
        fileName: baseName + '.svg',
        mimeType: 'image/svg+xml',
        fileData: svgData
      });
    } catch (err) {
      try { fs.unlinkSync(uploadedPath); } catch (_) {}
      return res.status(500).json({ success: false, error: 'SVG 파일을 읽지 못했습니다.' });
    }
  }

  const outputPath = path.join(tempDir, 'illustrator_preview_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.pdf');
  const args = [
    '-dSAFER',
    '-dBATCH',
    '-dNOPAUSE',
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.6',
    '-dPDFSETTINGS=/prepress',
    '-sOutputFile=' + outputPath,
  ];
  if (gsLibPath) args.unshift('-I' + gsLibPath);
  args.push(uploadedPath);

  execFile(gsPath, args, (err, stdout, stderr) => {
    try { fs.unlinkSync(uploadedPath); } catch (_) {}

    if (err) {
      console.error('[API Server] Illustrator preview failed:', err, stderr);
      try { fs.unlinkSync(outputPath); } catch (_) {}
      return res.status(500).json({
        success: false,
        error: 'PDF 호환 저장된 AI 파일이 아니거나 EPS 변환에 실패했습니다.'
      });
    }

    try {
      const fileData = fs.readFileSync(outputPath).toString('base64');
      try { fs.unlinkSync(outputPath); } catch (_) {}
      return res.json({
        success: true,
        mode: 'pdf',
        fileName: baseName + '.pdf',
        mimeType: 'application/pdf',
        fileData
      });
    } catch (readErr) {
      console.error('[API Server] Illustrator preview read failed:', readErr);
      try { fs.unlinkSync(outputPath); } catch (_) {}
      return res.status(500).json({ success: false, error: '변환된 미리보기 파일을 읽지 못했습니다.' });
    }
  });
});

// Route 2.5: Fast Render PDF for Instant Visual Compare (No AI analysis)
app.post('/quick-render', localUpload.fields([{ name: 'fileA', maxCount: 1 }, { name: 'fileB', maxCount: 1 }]), async (req, res) => {
  if (!req.files || !req.files['fileA'] || !req.files['fileB']) {
    return res.status(400).json({ success: false, error: '렌더링할 파일 2개가 모두 필요합니다.' });
  }

  const fileAPath = req.files['fileA'][0].path;
  const fileBPath = req.files['fileB'][0].path;

  const tempSubDir = path.join(tempDir, `quick_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);
  try {
    fs.mkdirSync(tempSubDir, { recursive: true });
  } catch (err) {
    try { fs.unlinkSync(fileAPath); } catch (_) {}
    try { fs.unlinkSync(fileBPath); } catch (_) {}
    return res.status(500).json({ success: false, error: '임시 디렉토리 생성에 실패했습니다.' });
  }

  const renderPDF = (filePath, outPattern) => {
    return new Promise((resolve, reject) => {
      const args = [
        '-dSAFER', '-dBATCH', '-dNOPAUSE',
        '-sDEVICE=png16m', `-r150`,
        '-dUseCropBox',
        `-sOutputFile=${outPattern}`,
      ];
      if (gsLibPath) {
        args.unshift(`-I${gsLibPath}`);
      }
      args.push(filePath);

      execFile(gsPath, args, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve();
      });
    });
  };

  try {
    // Render A and B in parallel using Ghostscript
    await Promise.all([
      renderPDF(fileAPath, path.join(tempSubDir, 'a%d.png')),
      renderPDF(fileBPath, path.join(tempSubDir, 'b%d.png'))
    ]);

    // Read the directory to find rendered images
    const files = fs.readdirSync(tempSubDir);
    const pagesA = [];
    const pagesB = [];

    // Filter and sort pages
    const aImages = files.filter(f => f.startsWith('a') && f.endsWith('.png'))
                         .sort((x, y) => parseInt(x.slice(1)) - parseInt(y.slice(1)));
    const bImages = files.filter(f => f.startsWith('b') && f.endsWith('.png'))
                         .sort((x, y) => parseInt(x.slice(1)) - parseInt(y.slice(1)));

    for (const f of aImages) {
      const pageNum = parseInt(f.slice(1, -4), 10);
      const imgPath = path.join(tempSubDir, f);
      const base64 = fs.readFileSync(imgPath).toString('base64');
      pagesA.push({ page: pageNum, img: `data:image/png;base64,${base64}` });
    }

    for (const f of bImages) {
      const pageNum = parseInt(f.slice(1, -4), 10);
      const imgPath = path.join(tempSubDir, f);
      const base64 = fs.readFileSync(imgPath).toString('base64');
      pagesB.push({ page: pageNum, img: `data:image/png;base64,${base64}` });
    }

    res.json({
      success: true,
      pagesA,
      pagesB
    });

  } catch (err) {
    console.error('[API Server] Quick render failed:', err);
    res.status(500).json({ success: false, error: `초고속 렌더링 실패: ${err.message}` });
  } finally {
    // Cleanup temporary files
    try { fs.unlinkSync(fileAPath); } catch (_) {}
    try { fs.unlinkSync(fileBPath); } catch (_) {}
    try {
      fs.rmSync(tempSubDir, { recursive: true, force: true });
    } catch (_) {}
  }
});

// Route 3: Initiate PDF Comparison (Asynchronous Task)
app.post('/compare-pdfs', localUpload.fields([{ name: 'fileA', maxCount: 1 }, { name: 'fileB', maxCount: 1 }]), (req, res) => {
  if (!req.files || !req.files['fileA'] || !req.files['fileB']) {
    return res.status(400).json({ success: false, error: '비교할 파일 2개가 모두 필요합니다.' });
  }

  const fileAPath = req.files['fileA'][0].path;
  const fileBPath = req.files['fileB'][0].path;
  const sensitivity = req.body.sensitivity || 'standard';

  const taskId = Date.now().toString() + '_' + Math.random().toString(36).substring(2, 11);
  console.log(`[API Server] Created comparison task: ${taskId}`);

  tasks.set(taskId, {
    status: 'running',
    result: null,
    error: null,
    createdAt: Date.now()
  });

  // Respond immediately with the taskId so the browser doesn't block
  res.json({ success: true, taskId });

  const workerPath = path.join(__dirname, 'workers', 'compare.worker.cjs');

  const worker = new Worker(workerPath, {
    workerData: {
      fileA: fileAPath,
      fileB: fileBPath,
      gsPath,
      gsLibPath,
      sensitivity
    }
  });

  worker.on('message', (message) => {
    try { fs.unlinkSync(fileAPath); } catch (_) {}
    try { fs.unlinkSync(fileBPath); } catch (_) {}

    const task = tasks.get(taskId);
    if (task) {
      if (message.success) {
        task.status = 'completed';
        task.result = message;
      } else {
        task.status = 'failed';
        task.error = message.error || '비교 연산 중 내부 에러가 발생했습니다.';
      }
      tasks.set(taskId, task);
    }
  });

  worker.on('error', (err) => {
    try { fs.unlinkSync(fileAPath); } catch (_) {}
    try { fs.unlinkSync(fileBPath); } catch (_) {}
    console.error(`[API Server] Worker error for task ${taskId}:`, err);
    
    const task = tasks.get(taskId);
    if (task) {
      task.status = 'failed';
      task.error = `비교 엔진 워커 에러: ${err.message}`;
      tasks.set(taskId, task);
    }
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      console.warn(`[API Server] Worker for task ${taskId} exited with code ${code}`);
      const task = tasks.get(taskId);
      if (task && task.status === 'running') {
        task.status = 'failed';
        task.error = `비교 엔진 워커가 비정상적으로 종료되었습니다 (code: ${code}).`;
        tasks.set(taskId, task);
      }
    }
  });
});

// Route 4: Poll Task Status
app.get('/compare-status/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = tasks.get(taskId);

  if (!task) {
    return res.status(404).json({ success: false, error: '존재하지 않거나 만료된 작업입니다.' });
  }

  res.json({
    success: true,
    status: task.status,
    result: task.result,
    error: task.error
  });

  // Automatically garbage collect completed/failed task data after it has been retrieved
  if (task.status === 'completed' || task.status === 'failed') {
    tasks.delete(taskId);
  }
});

// Start listening
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[API Server] 24/7 web API server running on port ${PORT}`);
});
