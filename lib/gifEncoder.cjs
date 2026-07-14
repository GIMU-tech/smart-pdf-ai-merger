const sharp = require('sharp');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

async function encodeAnimatedGif({
  framePaths,
  outputPath,
  delays,
  width,
  loop = 0,
  colors = 256,
  dither = 0.75,
  effort = 7,
}) {
  if (!Array.isArray(framePaths) || framePaths.length < 2) {
    throw new Error('GIF에는 2개 이상의 프레임이 필요합니다.');
  }

  if (!outputPath) {
    throw new Error('GIF 출력 경로가 필요합니다.');
  }

  if (!Array.isArray(delays) || delays.length !== framePaths.length) {
    throw new Error('delay 수는 프레임 수와 같아야 합니다.');
  }

  if (width !== undefined && (!Number.isInteger(width) || width < 1 || width > 1600)) {
    throw new Error('GIF 출력 폭은 1px 이상 1600px 이하여야 합니다.');
  }

  const resizedPaths = [];
  try {
    let inputPaths = framePaths;
    if (width) {
      inputPaths = await Promise.all(framePaths.map(async (framePath, index) => {
        const resizedPath = path.join(
          path.dirname(outputPath),
          `.gif-frame-${crypto.randomUUID()}-${index}.png`,
        );
        resizedPaths.push(resizedPath);
        await sharp(framePath)
          .resize({ width, withoutEnlargement: true })
          .png()
          .toFile(resizedPath);
        return resizedPath;
      }));
    }

    await sharp(inputPaths, {
      join: { animated: true },
    })
      .gif({
        delay: delays,
        loop,
        colours: colors,
        dither,
        effort,
        keepDuplicateFrames: true,
      })
      .toFile(outputPath);
  } finally {
    await Promise.allSettled(resizedPaths.map(resizedPath => fs.unlink(resizedPath)));
  }

  return outputPath;
}

module.exports = { encodeAnimatedGif };
