const path = require('path');
const os = require('os');
const { parentPort, workerData } = require('worker_threads');
const {
  resizeImages,
  stitchImages,
  splitImages,
} = require('../lib/imageProcessor.cjs');
const {
  processHtmlImages,
} = require('../lib/htmlImageCollector.cjs');

async function runImageOperation(data) {
  const operation = data?.operation;
  const inputPaths = data?.inputPaths || [];
  const outputDir =
    data?.outputDir ||
    data?.saveDirectory ||
    path.join(os.tmpdir(), `image-toolkit-${Date.now()}`);
  const options = data?.options || {};

  if (operation === 'resize') {
    return resizeImages({ inputPaths, outputDir, options });
  }

  if (operation === 'stitch') {
    return stitchImages({ inputPaths, outputDir, options });
  }

  if (operation === 'split') {
    return splitImages({ inputPaths, outputDir, options });
  }

  if (operation === 'html') {
    return processHtmlImages({
      htmlText: data?.htmlText,
      htmlFilePath: data?.htmlFilePath,
      outputDir,
      options,
      allowLocalUrls: data?.allowLocalUrls === true,
      allowFileUrls: data?.allowFileUrls === true,
    });
  }

  throw new Error('지원하지 않는 이미지 작업입니다.');
}

async function main() {
  try {
    const result = await runImageOperation(workerData);
    parentPort.postMessage({
      success: true,
      ...result,
    });
  } catch (error) {
    parentPort.postMessage({
      success: false,
      error: error instanceof Error ? error.message : '이미지 처리 중 오류가 발생했습니다.',
    });
  }
}

main();
