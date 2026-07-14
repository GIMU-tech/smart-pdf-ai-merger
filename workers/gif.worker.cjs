const { parentPort, workerData } = require('worker_threads');
const { encodeAnimatedGif } = require('../lib/gifEncoder.cjs');

async function run() {
  try {
    const outputPath = await encodeAnimatedGif(workerData);
    parentPort.postMessage({ success: true, outputPath });
  } catch (error) {
    parentPort.postMessage({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

run();
