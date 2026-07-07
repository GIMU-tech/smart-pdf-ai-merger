const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { Worker } = require('worker_threads');

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

// IPC Handler: Select directory for saving output files
ipcMain.handle('select-directory', async (event, options = {}) => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: options.title || '아웃라인 완료 파일 저장 폴더 선택',
    buttonLabel: options.buttonLabel || '폴더 선택',
  });
  
  if (result.canceled) {
    return null;
  }
  return result.filePaths[0];
});

// IPC Handler: Process image toolkit operations using Worker Thread
ipcMain.handle('image-process', async (event, payload) => {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'workers', 'image.worker.cjs');
    const worker = new Worker(workerPath, {
      workerData: payload,
    });

    let settled = false;

    worker.on('message', (message) => {
      settled = true;
      resolve(message);
    });

    worker.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(new Error(`이미지 워커 에러: ${err.message}`));
      }
    });

    worker.on('exit', (code) => {
      if (code !== 0 && !settled) {
        reject(new Error(`이미지 워커 종료 에러 (code ${code})`));
      }
    });
  });
});

// IPC Handler: Process PDF/AI outlining using embedded Ghostscript (gswin64c.exe)
ipcMain.handle('process-outline', async (event, { filePath, saveDirectory, baseName }) => {
  const cleanName = baseName.trim() || '문서';

  // Resolve embedded Ghostscript paths (packaged vs dev mode)
  const gsPath = app.isPackaged 
    ? path.join(__dirname, 'bin', 'gs', 'bin', 'gswin64c.exe')
    : path.join(__dirname, 'bin', 'gs', 'bin', 'gswin64c.exe');

  const gsLibPath = app.isPackaged 
    ? path.join(__dirname, 'bin', 'gs', 'lib')
    : path.join(__dirname, 'bin', 'gs', 'lib');

  // Define target output paths
  const originalExt = path.extname(filePath).toLowerCase() || '.pdf';
  const origPath = path.join(saveDirectory, `(원본)${cleanName}${originalExt}`);
  const origPdfPath = path.join(saveDirectory, `(원본)${cleanName}.pdf`);
  const printPdfPath = path.join(saveDirectory, `(인쇄용)${cleanName}.pdf`);
  const printAiPath = path.join(saveDirectory, `(인쇄용)${cleanName}.ai`);

  try {
    // Check if Ghostscript exists
    if (!fs.existsSync(gsPath)) {
      throw new Error(`변환 엔진(Ghostscript)을 찾을 수 없습니다. 경로: ${gsPath}`);
    }

    // 1. Save the original file exactly as uploaded, plus a PDF-compatible copy for print workflows.
    fs.copyFileSync(filePath, origPath);
    if (originalExt !== '.pdf') {
      fs.copyFileSync(filePath, origPdfPath);
    }

    // 2. Save an outlined print PDF while preserving page boxes so Illustrator can treat pages as artboards.
    await new Promise((resolve, reject) => {
      execFile(gsPath, [
        '-I' + gsLibPath,
        '-o', printPdfPath,
        '-dNOPAUSE',
        '-dBATCH',
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.6',
        '-dPDFSETTINGS=/prepress',
        '-dNoOutputFonts=true',
        '-dUseCropBox',
        filePath
      ], (err, stdout, stderr) => {
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

    const gsPath = app.isPackaged 
      ? path.join(__dirname, 'bin', 'gs', 'bin', 'gswin64c.exe')
      : path.join(__dirname, 'bin', 'gs', 'bin', 'gswin64c.exe');

    const gsLibPath = app.isPackaged 
      ? path.join(__dirname, 'bin', 'gs', 'lib')
      : path.join(__dirname, 'bin', 'gs', 'lib');

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
