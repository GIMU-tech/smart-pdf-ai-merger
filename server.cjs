const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

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

function findWindowsGhostscript() {
  const roots = [
    process.env.GHOSTSCRIPT_ROOT,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'gs'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'gs'),
  ].filter(Boolean);

  const candidates = [];
  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      const stat = fs.statSync(root);
      if (stat.isFile()) {
        candidates.push(root);
        continue;
      }
      for (const dir of fs.readdirSync(root)) {
        candidates.push(path.join(root, dir, 'bin', 'gswin64c.exe'));
        candidates.push(path.join(root, dir, 'bin', 'gswin32c.exe'));
      }
    } catch (_) {}
  }

  return candidates
    .filter(candidate => candidate && fs.existsSync(candidate))
    .sort()
    .reverse()[0] || null;
}

// Resolve Ghostscript dynamically (embedded, env override, system install, then PATH).
function resolveGhostscript() {
  const embeddedPath = path.join(__dirname, 'bin', 'gs', 'bin', 'gswin64c.exe');
  const embeddedLibPath = path.join(__dirname, 'bin', 'gs', 'lib');
  const candidates = [
    process.env.GHOSTSCRIPT_PATH,
    embeddedPath,
    process.platform === 'win32' ? findWindowsGhostscript() : null,
    process.platform === 'win32' ? 'gswin64c.exe' : 'gs',
  ].filter(Boolean);

  const resolvedPath = candidates.find(candidate => !path.isAbsolute(candidate) || fs.existsSync(candidate));
  const resolvedLibPath = fs.existsSync(embeddedLibPath)
    ? embeddedLibPath
    : (resolvedPath && path.isAbsolute(resolvedPath)
        ? path.join(path.dirname(path.dirname(resolvedPath)), 'lib')
        : '');

  return {
    gsPath: resolvedPath,
    gsLibPath: resolvedLibPath && fs.existsSync(resolvedLibPath) ? resolvedLibPath : ''
  };
}

const { gsPath, gsLibPath } = resolveGhostscript();

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
  if (!gsPath || (path.isAbsolute(gsPath) && !fs.existsSync(gsPath))) {
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
