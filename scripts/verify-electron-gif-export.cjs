const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createGifExportHandler } = require('../lib/electronGifExport.cjs');
const { validateGifExportPayload } = require('../lib/gifExportPayload.cjs');

const WIDTH = 860;
const HEIGHT = 430;
const DELAYS = [160, 200, 240];
const LOOP_COUNT = 3;

async function createFrame(background) {
  const buffer = await sharp({
    create: { width: WIDTH, height: HEIGHT, channels: 4, background },
  }).png().toBuffer();
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function withPngDimensions(frame, width, height) {
  const buffer = Buffer.from(frame.slice(0));
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function main() {
  const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'electron-gif-check-'));
  const outputPath = path.join(testDir, 'ipc-three-frames.gif');

  try {
    const frames = await Promise.all([
      createFrame({ r: 235, g: 87, b: 87, alpha: 1 }),
      createFrame({ r: 39, g: 174, b: 96, alpha: 1 }),
      createFrame({ r: 47, g: 128, b: 237, alpha: 1 }),
    ]);
    const payload = {
      frames,
      suggestedName: 'ipc-three-frames.gif',
      options: {
        width: WIDTH,
        durationMs: 600,
        loopCount: LOOP_COUNT,
        colors: 256,
        dither: 0.75,
        effort: 7,
        delays: DELAYS,
      },
    };

    const handler = createGifExportHandler({
      showSaveDialog: async () => ({ canceled: false, filePath: outputPath }),
      workerPath: path.join(__dirname, '..', 'workers', 'gif.worker.cjs'),
      tempRoot: testDir,
    });
    const result = await handler({}, payload);
    assert.equal(result.success, true);
    assert.equal(result.canceled, false);
    assert.equal(result.path, outputPath);

    const metadata = await sharp(outputPath, { animated: true }).metadata();
    assert.equal(metadata.format, 'gif');
    assert.equal(metadata.width, WIDTH);
    assert.equal(metadata.pageHeight || metadata.height, HEIGHT);
    assert.equal(metadata.pages, 3);
    assert.deepEqual(metadata.delay, DELAYS);
    assert.equal(metadata.loop, LOOP_COUNT);

    const remaining = await fs.readdir(testDir);
    assert.deepEqual(remaining, [path.basename(outputPath)]);

    const cancelHandler = createGifExportHandler({
      showSaveDialog: async () => ({ canceled: true }),
      workerPath: path.join(__dirname, '..', 'workers', 'gif.worker.cjs'),
      tempRoot: testDir,
    });
    assert.deepEqual(await cancelHandler({}, payload), { success: true, canceled: true, path: null });

    assert.throws(
      () => validateGifExportPayload({ ...payload, options: { ...payload.options, durationMs: 599 } }),
      /600ms/,
    );
    assert.throws(
      () => validateGifExportPayload({ ...payload, options: { ...payload.options, width: 861 } }),
      /860px/,
    );
    const tooTallFrames = frames.map(frame => withPngDimensions(frame, 860, 8193));
    assert.throws(
      () => validateGifExportPayload({ ...payload, frames: tooTallFrames }),
      /8192px/,
    );
    const tooManyPixelsFrames = frames.map(frame => withPngDimensions(frame, 4000, 8001));
    assert.throws(
      () => validateGifExportPayload({
        ...payload,
        frames: tooManyPixelsFrames,
        options: { ...payload.options, width: 4000 },
      }),
      /32,000,000/,
    );

    console.log(JSON.stringify({
      success: result.success,
      format: metadata.format,
      width: metadata.width,
      height: metadata.pageHeight || metadata.height,
      frames: metadata.pages,
      delays: metadata.delay,
      durationMs: DELAYS.reduce((sum, delay) => sum + delay, 0),
      loop: metadata.loop,
      tempCleaned: remaining.length === 1,
      cancelHandled: true,
    }));
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
