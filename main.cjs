const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { Worker } = require('worker_threads');

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

function resolveGhostscript() {
  const embeddedPath = path.join(__dirname, 'bin', 'gs', 'bin', 'gswin64c.exe');
  const embeddedLibPath = path.join(__dirname, 'bin', 'gs', 'lib');
  const envPath = process.env.GHOSTSCRIPT_PATH;
  const candidates = [
    envPath,
    embeddedPath,
    process.platform === 'win32' ? findWindowsGhostscript() : null,
    process.platform === 'win32' ? 'gswin64c.exe' : 'gs',
  ].filter(Boolean);

  const gsPath = candidates.find(candidate => !path.isAbsolute(candidate) || fs.existsSync(candidate));
  const gsLibPath = fs.existsSync(embeddedLibPath)
    ? embeddedLibPath
    : (gsPath && path.isAbsolute(gsPath)
        ? path.join(path.dirname(path.dirname(gsPath)), 'lib')
        : '');

  return {
    gsPath,
    gsLibPath: gsLibPath && fs.existsSync(gsLibPath) ? gsLibPath : ''
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    autoHideMenuBar: true,
    title: "PDF & AI 툴킷",
  });

  // If in development mode, load from the Vite dev server.
  // If packaged, load the built dist/index.html file.
  if (!app.isPackaged) {
    win.loadURL('http://localhost:3000');
    // Open Developer Tools in development mode by default
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handler: Select directory for saving outlined files
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: '아웃라인 완료 파일 저장 폴더 선택',
    buttonLabel: '폴더 선택',
  });
  
  if (result.canceled) {
    return null;
  }
  return result.filePaths[0];
});

// IPC Handler: Process PDF/AI outlining using embedded Ghostscript (gswin64c.exe)
ipcMain.handle('process-outline', async (event, { filePath, saveDirectory, baseName }) => {
  const cleanName = baseName.trim() || '문서';

  const { gsPath, gsLibPath } = resolveGhostscript();

  // Define target output paths
  const originalExt = path.extname(filePath).toLowerCase() || '.pdf';
  const origPath = path.join(saveDirectory, `(원본)${cleanName}${originalExt}`);
  const origPdfPath = path.join(saveDirectory, `(원본)${cleanName}.pdf`);
  const printPdfPath = path.join(saveDirectory, `(인쇄용)${cleanName}.pdf`);
  const printAiPath = path.join(saveDirectory, `(인쇄용)${cleanName}.ai`);

  try {
    // Check if Ghostscript exists
    if (!gsPath || (path.isAbsolute(gsPath) && !fs.existsSync(gsPath))) {
      throw new Error(`변환 엔진(Ghostscript)을 찾을 수 없습니다. 경로: ${gsPath}`);
    }

    // 1. Save the original file exactly as uploaded, plus a PDF-compatible copy for print workflows.
    fs.copyFileSync(filePath, origPath);
    if (originalExt !== '.pdf') {
      fs.copyFileSync(filePath, origPdfPath);
    }

    // 2. Save an outlined print PDF while preserving page boxes so Illustrator can treat pages as artboards.
    await new Promise((resolve, reject) => {
      const args = [
        gsLibPath ? '-I' + gsLibPath : null,
        '-o', printPdfPath,
        '-dNOPAUSE',
        '-dBATCH',
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.6',
        '-dPDFSETTINGS=/prepress',
        '-dNoOutputFonts=true',
        '-dUseCropBox',
        filePath
      ].filter(Boolean);
      execFile(gsPath, args, (err, stdout, stderr) => {
        if (err) {
          console.error('Ghostscript failed:', err, stderr);
          reject(new Error(`아웃라인 처리 실패: ${stderr || err.message}`));
        } else {
          resolve();
        }
      });
    });

    // 3. Provide an Illustrator-friendly .ai filename using the same PDF-based bytes.
    fs.copyFileSync(printPdfPath, printAiPath);

    return {
      success: true,
      files: [
        path.basename(origPath),
        ...(originalExt !== '.pdf' ? [path.basename(origPdfPath)] : []),
        path.basename(printPdfPath),
        path.basename(printAiPath),
      ],
      warning: '인쇄용 AI는 Illustrator 대지 인식을 돕기 위한 PDF 기반 호환 파일입니다. 파일별 Illustrator 해석 차이가 있을 수 있습니다.',
    };
  } catch (error) {
    console.error('Processing failed:', error);
    return { success: false, error: error.message };
  }
});

// IPC Handler: Compare PDFs using Worker Thread
ipcMain.handle('compare-pdfs', async (event, { fileA, fileB, sensitivity }) => {
  return new Promise((resolve, reject) => {
    const workerPath = app.isPackaged
      ? path.join(__dirname, 'workers', 'compare.worker.cjs')
      : path.join(__dirname, 'workers', 'compare.worker.cjs');

    const { gsPath, gsLibPath } = resolveGhostscript();

    const worker = new Worker(workerPath, {
      workerData: { fileA, fileB, gsPath, gsLibPath, sensitivity }
    });

    worker.on('message', (message) => {
      if (message.success) {
        resolve(message);
      } else {
        reject(new Error(message.error || '비교 연산 실패'));
      }
    });

    worker.on('error', (err) => {
      reject(new Error(`Worker 에러: ${err.message}`));
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker 종료 에러 (code ${code})`));
      }
    });
  });
});
