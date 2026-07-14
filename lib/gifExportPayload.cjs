const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const MAX_FRAMES = 60;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;
const MAX_WIDTH = 860;
const MAX_PNG_DIMENSION = 8192;
const MAX_PNG_PIXELS = 32_000_000;
const MIN_DURATION_MS = 600;
const MAX_DURATION_MS = 4000;

function toBuffer(value) {
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error('GIF 프레임은 PNG ArrayBuffer여야 합니다.');
}

function readPngDimensions(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('GIF 프레임에 올바른 PNG 서명이 없습니다.');
  }
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('GIF 프레임의 PNG 헤더가 올바르지 않습니다.');
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 1 || height < 1) {
    throw new Error('GIF 프레임 크기가 올바르지 않습니다.');
  }
  if (width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION) {
    throw new Error(`GIF PNG 프레임의 한 변은 ${MAX_PNG_DIMENSION}px 이하여야 합니다.`);
  }
  if (width * height > MAX_PNG_PIXELS) {
    throw new Error('GIF PNG 프레임은 전체 32,000,000 pixels 이하여야 합니다.');
  }
  return { width, height };
}

function requireInteger(value, message) {
  if (!Number.isInteger(value)) throw new Error(message);
  return value;
}

function validateGifExportPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('GIF 내보내기 요청이 올바르지 않습니다.');
  }
  if (!Array.isArray(payload.frames) || payload.frames.length < 2 || payload.frames.length > MAX_FRAMES) {
    throw new Error(`GIF 프레임 수는 2개 이상 ${MAX_FRAMES}개 이하여야 합니다.`);
  }

  let totalBytes = 0;
  let dimensions;
  const frames = payload.frames.map((frame, index) => {
    const buffer = toBuffer(frame);
    if (buffer.length === 0 || buffer.length > MAX_FRAME_BYTES) {
      throw new Error(`GIF ${index + 1}번 프레임이 8MB 제한을 초과했습니다.`);
    }
    totalBytes += buffer.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('GIF 프레임 전체가 80MB 제한을 초과했습니다.');
    }

    const current = readPngDimensions(buffer);
    if (!dimensions) dimensions = current;
    if (current.width !== dimensions.width || current.height !== dimensions.height) {
      throw new Error('모든 GIF PNG 프레임의 크기가 같아야 합니다.');
    }
    return Buffer.from(buffer);
  });

  const options = payload.options;
  if (!options || typeof options !== 'object') {
    throw new Error('GIF 내보내기 옵션이 올바르지 않습니다.');
  }
  const width = requireInteger(options.width, 'GIF 출력 폭이 올바르지 않습니다.');
  if (width < 1 || width > MAX_WIDTH || width !== dimensions.width) {
    throw new Error(`GIF 출력 폭은 PNG 폭과 같고 ${MAX_WIDTH}px 이하여야 합니다.`);
  }

  const durationMs = requireInteger(options.durationMs, 'GIF 재생 시간이 올바르지 않습니다.');
  if (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    throw new Error(`GIF 재생 시간은 ${MIN_DURATION_MS}ms 이상 ${MAX_DURATION_MS}ms 이하여야 합니다.`);
  }

  if (!Array.isArray(options.delays) || options.delays.length !== frames.length) {
    throw new Error('GIF delay 수는 프레임 수와 같아야 합니다.');
  }
  const delays = options.delays.map(delay => requireInteger(delay, 'GIF delay는 정수여야 합니다.'));
  if (delays.some(delay => delay < 1) || delays.reduce((sum, delay) => sum + delay, 0) !== durationMs) {
    throw new Error('GIF delay 합은 재생 시간과 같아야 합니다.');
  }

  const loop = requireInteger(options.loopCount, 'GIF 반복 횟수가 올바르지 않습니다.');
  if (loop < 0 || loop > 65535) throw new Error('GIF 반복 횟수가 범위를 벗어났습니다.');
  const colors = requireInteger(options.colors, 'GIF 색상 수가 올바르지 않습니다.');
  if (colors < 2 || colors > 256) throw new Error('GIF 색상 수는 2 이상 256 이하여야 합니다.');
  if (typeof options.dither !== 'number' || !Number.isFinite(options.dither) || options.dither < 0 || options.dither > 1) {
    throw new Error('GIF 디더링 값은 0 이상 1 이하여야 합니다.');
  }
  const effort = requireInteger(options.effort, 'GIF 인코딩 effort가 올바르지 않습니다.');
  if (effort < 1 || effort > 10) throw new Error('GIF 인코딩 effort는 1 이상 10 이하여야 합니다.');

  const suggestedName = typeof payload.suggestedName === 'string'
    ? payload.suggestedName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 120)
    : '';

  return {
    frames,
    options: { width, durationMs, delays, loop, colors, dither: options.dither, effort },
    dimensions,
    totalBytes,
    suggestedName: suggestedName || 'motion.gif',
  };
}

module.exports = {
  MAX_FRAME_BYTES,
  MAX_FRAMES,
  MAX_TOTAL_BYTES,
  MAX_WIDTH,
  validateGifExportPayload,
};
