const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const JSZip = require('jszip');

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

    const result = await runImageWorker({
      operation,
      inputPaths,
      htmlText: req.body.htmlText || '',
      htmlFilePath,
      outputDir,
      options,
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
