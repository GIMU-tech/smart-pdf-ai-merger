const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const sharp = require('sharp');

const EXPECTED_DELAYS = [80, 120, 240];
const EXPECTED_LOOP = 2;
const EXPECTED_WIDTH = 860;

function encodeWithWorker(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      path.join(__dirname, '..', 'workers', 'gif.worker.cjs'),
      { workerData },
    );

    worker.once('message', (message) => {
      if (message.success) {
        resolve(message.outputPath);
      } else {
        reject(new Error(message.error));
      }
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`GIF worker가 종료 코드 ${code}로 종료되었습니다.`));
      }
    });
  });
}

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gif-encoder-check-'));

  try {
    const framePaths = [];
    const colors = [
      { r: 235, g: 87, b: 87, alpha: 1 },
      { r: 39, g: 174, b: 96, alpha: 1 },
      { r: 47, g: 128, b: 237, alpha: 1 },
    ];

    for (const [index, background] of colors.entries()) {
      const framePath = path.join(tempDir, `frame-${index}.png`);
      await sharp({
        create: { width: 1000, height: 500, channels: 4, background },
      }).png().toFile(framePath);
      framePaths.push(framePath);
    }

    const outputPath = path.join(tempDir, 'animated.gif');
    await encodeWithWorker({
      framePaths,
      outputPath,
      delays: EXPECTED_DELAYS,
      width: EXPECTED_WIDTH,
      loop: EXPECTED_LOOP,
      colors: 256,
      dither: 0.75,
      effort: 7,
    });

    const metadata = await sharp(outputPath, { animated: true }).metadata();
    assert.equal(metadata.format, 'gif');
    assert.equal(metadata.width, EXPECTED_WIDTH);
    assert.equal(metadata.pages, 3);
    assert.deepEqual(metadata.delay, EXPECTED_DELAYS);
    assert.equal(metadata.loop, EXPECTED_LOOP);

    console.log(JSON.stringify({
      format: metadata.format,
      width: metadata.width,
      height: metadata.pageHeight || metadata.height,
      frames: metadata.pages,
      delays: metadata.delay,
      loop: metadata.loop,
    }));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
