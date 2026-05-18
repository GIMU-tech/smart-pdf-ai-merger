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

  const filePath = req.file.path;
  const originalName = req.file.originalname;
  const cleanName = path.parse(originalName).name || 'document';
  
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
    '-dNoOutputFonts=true',
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
        fileData: base64Data
      });
    } catch (readErr) {
      console.error('[API Server] File read error:', readErr);
      res.status(500).json({ success: false, error: '출력 파일 리딩에 실패했습니다.' });
    }
  });
});

// Route 3: Compare PDFs
app.post('/compare-pdfs', localUpload.fields([{ name: 'fileA', maxCount: 1 }, { name: 'fileB', maxCount: 1 }]), (req, res) => {
  if (!req.files || !req.files['fileA'] || !req.files['fileB']) {
    return res.status(400).json({ success: false, error: '비교할 파일 2개가 모두 필요합니다.' });
  }

  const fileAPath = req.files['fileA'][0].path;
  const fileBPath = req.files['fileB'][0].path;
  const sensitivity = req.body.sensitivity || 'standard';

  console.log(`[API Server] Starting PDF compare (sensitivity: ${sensitivity})`);

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
    // Clean up uploaded temporary files
    try { fs.unlinkSync(fileAPath); } catch (_) {}
    try { fs.unlinkSync(fileBPath); } catch (_) {}

    if (message.success) {
      res.json(message);
    } else {
      res.status(500).json({ success: false, error: message.error || '비교 연산 중 내부 에러가 발생했습니다.' });
    }
  });

  worker.on('error', (err) => {
    try { fs.unlinkSync(fileAPath); } catch (_) {}
    try { fs.unlinkSync(fileBPath); } catch (_) {}
    console.error('[API Server] Worker error:', err);
    res.status(500).json({ success: false, error: `비교 엔진 워커 에러: ${err.message}` });
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      console.warn(`[API Server] Worker exited with code ${code}`);
    }
  });
});

// Start listening
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[API Server] 24/7 web API server running on port ${PORT}`);
});
