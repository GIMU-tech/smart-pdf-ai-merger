const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const crypto = require('crypto');
const { validateGifExportPayload } = require('./gifExportPayload.cjs');

function encodeWithGifWorker(workerPath, workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };

    worker.once('message', (message) => {
      if (message && message.success) finish(resolve, message.outputPath);
      else finish(reject, new Error(message?.error || 'GIF Worker 인코딩에 실패했습니다.'));
    });
    worker.once('error', error => finish(reject, error));
    worker.once('exit', (code) => {
      if (code !== 0) finish(reject, new Error(`GIF Worker가 종료 코드 ${code}로 종료되었습니다.`));
    });
  });
}

function createGifExportHandler({ showSaveDialog, workerPath, tempRoot = os.tmpdir() }) {
  if (typeof showSaveDialog !== 'function' || !workerPath) {
    throw new Error('Electron GIF 내보내기 의존성이 올바르지 않습니다.');
  }

  return async (_event, payload) => {
    let tempDir;
    try {
      const validated = validateGifExportPayload(payload);
      const dialogResult = await showSaveDialog({
        title: 'GIF 저장',
        defaultPath: validated.suggestedName.toLowerCase().endsWith('.gif')
          ? validated.suggestedName
          : `${validated.suggestedName}.gif`,
        buttonLabel: 'GIF 저장',
        filters: [{ name: 'GIF 이미지', extensions: ['gif'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });

      if (dialogResult.canceled || !dialogResult.filePath) {
        return { success: true, canceled: true, path: null };
      }

      const savePath = dialogResult.filePath.toLowerCase().endsWith('.gif')
        ? dialogResult.filePath
        : `${dialogResult.filePath}.gif`;
      tempDir = await fs.mkdtemp(path.join(tempRoot, 'pdf-toolkit-gif-'));
      const framePaths = await Promise.all(validated.frames.map(async (frame, index) => {
        const framePath = path.join(tempDir, `frame-${String(index).padStart(3, '0')}.png`);
        await fs.writeFile(framePath, frame);
        return framePath;
      }));
      const tempOutputPath = path.join(tempDir, `output-${crypto.randomUUID()}.gif`);
      await encodeWithGifWorker(workerPath, {
        framePaths,
        outputPath: tempOutputPath,
        delays: validated.options.delays,
        width: validated.options.width,
        loop: validated.options.loop,
        colors: validated.options.colors,
        dither: validated.options.dither,
        effort: validated.options.effort,
      });
      const output = await fs.readFile(tempOutputPath);
      const signature = output.subarray(0, 6).toString('ascii');
      if (output.length === 0 || (signature !== 'GIF87a' && signature !== 'GIF89a')) {
        throw new Error('GIF Worker 출력이 올바른 GIF 파일이 아닙니다.');
      }
      await fs.copyFile(tempOutputPath, savePath);

      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;

      return {
        success: true,
        canceled: false,
        path: savePath,
        bytes: output.length,
        width: validated.dimensions.width,
        height: validated.dimensions.height,
        frameCount: validated.frames.length,
        durationMs: validated.options.durationMs,
      };
    } catch (error) {
      let cleanupError;
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
          tempDir = undefined;
        } catch (caughtCleanupError) {
          cleanupError = caughtCleanupError;
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        canceled: false,
        path: null,
        error: cleanupError
          ? `${message} 임시 파일 정리에도 실패했습니다: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
          : message,
      };
    }
  };
}

module.exports = { createGifExportHandler, encodeWithGifWorker };
