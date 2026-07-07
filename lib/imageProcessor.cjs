const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const sharp = require('sharp');

const MAX_INPUT_PIXELS = 268000000;
const FLOW_SAMPLE_CROSS_AXIS = 180;
const FLOW_SAMPLE_MAX_AXIS = 18000;
const FLOW_SEARCH_WINDOW = 300;
const OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp', 'avif', 'gif', 'tiff']);

function normalizeOutputFormat(format) {
  const normalized = String(format || 'png').toLowerCase();
  if (normalized === 'jpg') return 'jpeg';
  if (!OUTPUT_FORMATS.has(normalized)) {
    throw new Error('지원하지 않는 출력 포맷입니다.');
  }
  return normalized;
}

function outputExtension(format) {
  return normalizeOutputFormat(format) === 'jpeg' ? 'jpg' : normalizeOutputFormat(format);
}

function positiveInteger(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.round(number);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sanitizeBaseName(name) {
  const parsed = path.parse(name).name || 'image';
  return parsed.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'image';
}

function sanitizeOutputBaseName(name) {
  return String(name || 'image').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'image';
}

function ensureUniquePath(outputDir, fileName, usedNames) {
  const extension = path.extname(fileName);
  const base = path.basename(fileName, extension);
  let candidate = fileName;
  let counter = 2;

  while (usedNames.has(candidate.toLowerCase()) || fs.existsSync(path.join(outputDir, candidate))) {
    candidate = `${base}_${counter}${extension}`;
    counter += 1;
  }

  usedNames.add(candidate.toLowerCase());
  return path.join(outputDir, candidate);
}

function formatPipeline(pipeline, options) {
  const format = normalizeOutputFormat(options.outputFormat);
  const quality = positiveInteger(options.quality, 92) || 92;

  if (format === 'png') return pipeline.png();
  if (format === 'jpeg') return pipeline.jpeg({ quality });
  if (format === 'webp') return pipeline.webp({ quality });
  if (format === 'avif') return pipeline.avif({ quality });
  if (format === 'gif') return pipeline.gif();
  return pipeline.tiff({ quality });
}

async function ensureOutputDir(outputDir) {
  if (!outputDir) throw new Error('출력 폴더가 지정되지 않았습니다.');
  const resolved = path.resolve(outputDir);
  await fsp.mkdir(resolved, { recursive: true });
  return resolved;
}

async function metadataFromOutput(outputPath, sourceName) {
  const meta = await sharp(outputPath, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  const stat = await fsp.stat(outputPath);
  return {
    path: outputPath,
    fileName: path.basename(outputPath),
    sourceName,
    width: meta.width,
    height: meta.height,
    format: meta.format,
    size: stat.size,
  };
}

async function readImageMetadata(inputPath) {
  if (!inputPath) throw new Error('이미지 경로가 비어 있습니다.');

  const resolved = path.resolve(inputPath);
  const stat = await fsp.stat(resolved);
  const meta = await sharp(resolved, {
    animated: false,
    limitInputPixels: MAX_INPUT_PIXELS,
  })
    .rotate()
    .metadata();

  if (!meta.width || !meta.height) {
    throw new Error('이미지 크기를 읽을 수 없습니다.');
  }

  if (meta.width * meta.height > MAX_INPUT_PIXELS) {
    throw new Error('이미지가 너무 큽니다. 더 작은 이미지로 나누어 처리해주세요.');
  }

  return {
    path: resolved,
    fileName: path.basename(resolved),
    width: meta.width,
    height: meta.height,
    format: meta.format,
    size: stat.size,
  };
}

function resizeSuffix(options) {
  if (options.mode === 'height') return `_resized_h${options.targetHeight}`;
  if (options.mode === 'force' || options.mode === 'contain') {
    return `_resized_${options.targetWidth}x${options.targetHeight}`;
  }
  return `_resized_w${options.targetWidth}`;
}

function normalizeResizeOptions(options = {}) {
  const mode = options.mode || 'width';
  const normalized = {
    ...options,
    mode,
    outputFormat: normalizeOutputFormat(options.outputFormat),
    quality: positiveInteger(options.quality, 92) || 92,
    preventUpscale: options.preventUpscale === true,
  };

  if (mode === 'width') {
    normalized.targetWidth = positiveInteger(options.targetWidth, 860);
    if (!normalized.targetWidth) throw new Error('가로 값을 입력해주세요.');
  } else if (mode === 'height') {
    normalized.targetHeight = positiveInteger(options.targetHeight);
    if (!normalized.targetHeight) throw new Error('세로 값을 입력해주세요.');
  } else if (mode === 'force' || mode === 'contain') {
    normalized.targetWidth = positiveInteger(options.targetWidth, 860);
    normalized.targetHeight = positiveInteger(options.targetHeight);
    if (!normalized.targetWidth || !normalized.targetHeight) {
      throw new Error('가로와 세로 값을 입력해주세요.');
    }
  } else {
    throw new Error('지원하지 않는 크기 변경 모드입니다.');
  }

  return normalized;
}

async function resizeImages({ inputPaths = [], outputDir, options = {} }) {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
    throw new Error('이미지 파일을 추가해주세요.');
  }

  const normalizedOptions = normalizeResizeOptions(options);
  const resolvedOutputDir = await ensureOutputDir(outputDir);
  const usedNames = new Set();
  const files = [];

  for (const inputPath of inputPaths) {
    await readImageMetadata(inputPath);

    let pipeline = sharp(inputPath, {
      animated: false,
      limitInputPixels: MAX_INPUT_PIXELS,
    }).rotate();

    if (normalizedOptions.mode === 'width') {
      pipeline = pipeline.resize({
        width: normalizedOptions.targetWidth,
        withoutEnlargement: normalizedOptions.preventUpscale,
      });
    } else if (normalizedOptions.mode === 'height') {
      pipeline = pipeline.resize({
        height: normalizedOptions.targetHeight,
        withoutEnlargement: normalizedOptions.preventUpscale,
      });
    } else if (normalizedOptions.mode === 'force') {
      pipeline = pipeline.resize({
        width: normalizedOptions.targetWidth,
        height: normalizedOptions.targetHeight,
        fit: 'fill',
      });
    } else {
      pipeline = pipeline.resize({
        width: normalizedOptions.targetWidth,
        height: normalizedOptions.targetHeight,
        fit: 'contain',
        background: normalizedOptions.background || '#ffffff',
        position: normalizedOptions.position || 'center',
        withoutEnlargement: normalizedOptions.preventUpscale,
      });
    }

    const baseName = sanitizeBaseName(path.basename(inputPath));
    const fileName = `${baseName}${resizeSuffix(normalizedOptions)}.${outputExtension(normalizedOptions.outputFormat)}`;
    const outputPath = ensureUniquePath(resolvedOutputDir, fileName, usedNames);

    await formatPipeline(pipeline, normalizedOptions).toFile(outputPath);
    files.push(await metadataFromOutput(outputPath, path.basename(inputPath)));
  }

  return {
    files,
    manifest: {
      operation: 'resize',
      count: files.length,
      options: normalizedOptions,
    },
  };
}

function normalizeStitchOptions(options = {}) {
  const direction = options.direction || 'vertical';
  const matchPolicy = options.matchPolicy || 'resize-to-target';
  const normalized = {
    ...options,
    direction,
    matchPolicy,
    gap: Math.max(0, positiveInteger(options.gap, 0) || 0),
    background: options.background || '#ffffff',
    outputFormat: normalizeOutputFormat(options.outputFormat),
    quality: positiveInteger(options.quality, 92) || 92,
    tolerancePx: Math.max(0, positiveInteger(options.tolerancePx, 0) || 0),
    groupByDimension: options.groupByDimension === true,
  };

  if (!['vertical', 'horizontal'].includes(direction)) {
    throw new Error('지원하지 않는 합치기 방향입니다.');
  }

  if (!['strict', 'resize-to-first', 'resize-to-target'].includes(matchPolicy)) {
    throw new Error('지원하지 않는 합치기 정책입니다.');
  }

  if (direction === 'vertical') {
    normalized.targetWidth = positiveInteger(options.targetWidth, 860);
    if (matchPolicy === 'resize-to-target' && !normalized.targetWidth) {
      throw new Error('가로 값을 입력해주세요.');
    }
  } else {
    normalized.targetHeight = positiveInteger(options.targetHeight);
    if (matchPolicy === 'resize-to-target' && !normalized.targetHeight) {
      throw new Error('가로 합치기에는 세로 값을 입력해주세요.');
    }
  }

  return normalized;
}

function withinTolerance(a, b, tolerancePx) {
  return Math.abs(a - b) <= tolerancePx;
}

async function prepareStitchItem(inputPath, options, firstMeta) {
  let pipeline = sharp(inputPath, {
    animated: false,
    limitInputPixels: MAX_INPUT_PIXELS,
  }).rotate();

  if (options.matchPolicy === 'resize-to-first') {
    if (options.direction === 'vertical') {
      pipeline = pipeline.resize({ width: firstMeta.width });
    } else {
      pipeline = pipeline.resize({ height: firstMeta.height });
    }
  } else if (options.matchPolicy === 'resize-to-target') {
    if (options.direction === 'vertical') {
      pipeline = pipeline.resize({ width: options.targetWidth });
    } else {
      pipeline = pipeline.resize({ height: options.targetHeight });
    }
  }

  const buffer = await pipeline.toBuffer();
  const meta = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  return {
    inputPath,
    buffer,
    width: meta.width,
    height: meta.height,
  };
}

async function stitchOneGroup(inputPaths, outputDir, options, outputName) {
  if (inputPaths.length < 2) {
    throw new Error('이미지를 합치려면 최소 2개 이상의 이미지가 필요합니다.');
  }

  const originalMeta = [];
  for (const inputPath of inputPaths) {
    originalMeta.push(await readImageMetadata(inputPath));
  }

  if (options.matchPolicy === 'strict') {
    const expected = options.direction === 'vertical' ? originalMeta[0].width : originalMeta[0].height;
    const mismatch = originalMeta.find(meta => {
      const value = options.direction === 'vertical' ? meta.width : meta.height;
      return !withinTolerance(value, expected, options.tolerancePx);
    });

    if (mismatch) {
      throw new Error(
        options.direction === 'vertical'
          ? '세로 합치기는 폭이 같은 이미지끼리만 처리할 수 있습니다.'
          : '가로 합치기는 높이가 같은 이미지끼리만 처리할 수 있습니다.'
      );
    }
  }

  const firstMeta = originalMeta[0];
  const prepared = [];
  for (const inputPath of inputPaths) {
    prepared.push(await prepareStitchItem(inputPath, options, firstMeta));
  }

  const gap = options.gap;
  const canvas =
    options.direction === 'vertical'
      ? {
          width: Math.max(...prepared.map(item => item.width)),
          height: prepared.reduce((sum, item) => sum + item.height, 0) + gap * (prepared.length - 1),
        }
      : {
          width: prepared.reduce((sum, item) => sum + item.width, 0) + gap * (prepared.length - 1),
          height: Math.max(...prepared.map(item => item.height)),
        };

  let offset = 0;
  const composites = prepared.map(item => {
    const composite =
      options.direction === 'vertical'
        ? { input: item.buffer, left: 0, top: offset }
        : { input: item.buffer, left: offset, top: 0 };
    offset += (options.direction === 'vertical' ? item.height : item.width) + gap;
    return composite;
  });

  const outputPath = path.join(outputDir, outputName);
  const pipeline = sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 4,
      background: options.background,
    },
  }).composite(composites);

  await formatPipeline(pipeline, options).toFile(outputPath);
  return metadataFromOutput(outputPath, outputName);
}

function groupInputPathsByDimension(metas, options) {
  const groups = new Map();

  metas.forEach(meta => {
    const dimension = options.direction === 'vertical' ? meta.width : meta.height;
    const key = String(dimension);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(meta.path);
  });

  return [...groups.entries()]
    .filter(([, inputPaths]) => inputPaths.length >= 2)
    .map(([dimension, inputPaths]) => ({ dimension: Number(dimension), inputPaths }));
}

async function stitchImages({ inputPaths = [], outputDir, options = {} }) {
  if (!Array.isArray(inputPaths) || inputPaths.length < 2) {
    throw new Error('이미지를 합치려면 최소 2개 이상의 이미지가 필요합니다.');
  }

  const normalizedOptions = normalizeStitchOptions(options);
  const resolvedOutputDir = await ensureOutputDir(outputDir);
  const formatExt = outputExtension(normalizedOptions.outputFormat);
  const files = [];
  const usedNames = new Set();

  if (normalizedOptions.groupByDimension && normalizedOptions.matchPolicy === 'strict') {
    const metas = [];
    for (const inputPath of inputPaths) {
      metas.push(await readImageMetadata(inputPath));
    }

    const groups = groupInputPathsByDimension(metas, normalizedOptions);
    if (groups.length === 0) {
      throw new Error('같은 크기의 이미지 그룹을 찾지 못했습니다.');
    }

    for (const group of groups) {
      const dimensionLabel = normalizedOptions.direction === 'vertical' ? `w${group.dimension}` : `h${group.dimension}`;
      const fileName = ensureUniquePath(
        resolvedOutputDir,
        `stitched_${normalizedOptions.direction}_group_${dimensionLabel}.${formatExt}`,
        usedNames
      );
      files.push(await stitchOneGroup(group.inputPaths, resolvedOutputDir, normalizedOptions, path.basename(fileName)));
    }
  } else {
    const firstMeta = await readImageMetadata(inputPaths[0]);
    const dimension =
      normalizedOptions.direction === 'vertical'
        ? normalizedOptions.matchPolicy === 'resize-to-target'
          ? normalizedOptions.targetWidth
          : firstMeta.width
        : normalizedOptions.matchPolicy === 'resize-to-target'
          ? normalizedOptions.targetHeight
          : firstMeta.height;
    const dimensionLabel = normalizedOptions.direction === 'vertical' ? `w${dimension}` : `h${dimension}`;
    const fileName = ensureUniquePath(
      resolvedOutputDir,
      `stitched_${normalizedOptions.direction}_${dimensionLabel}.${formatExt}`,
      usedNames
    );
    files.push(await stitchOneGroup(inputPaths, resolvedOutputDir, normalizedOptions, path.basename(fileName)));
  }

  return {
    files,
    manifest: {
      operation: 'stitch',
      count: files.length,
      options: normalizedOptions,
    },
  };
}

function normalizeSplitOptions(options = {}) {
  const axis = options.axis || 'vertical';
  if (!['vertical', 'horizontal'].includes(axis)) {
    throw new Error('지원하지 않는 자르기 방향입니다.');
  }

  const strategy = options.strategy === 'fixed' || options.strategy === 'manual' ? options.strategy : 'flow';
  const maxPixels = positiveInteger(options.maxPixels, 3000);
  if (!maxPixels || maxPixels < 100) {
    throw new Error('자르기 기준 픽셀은 100 이상이어야 합니다.');
  }

  const manualCuts = Array.isArray(options.manualCuts)
    ? Array.from(new Set(
        options.manualCuts
          .map(value => positiveInteger(value))
          .filter(value => value && value > 0)
      )).sort((a, b) => a - b)
    : [];

  if (strategy === 'manual' && manualCuts.length === 0) {
    throw new Error('수동 절단선 값을 입력해주세요.');
  }

  const overlap = Math.max(0, positiveInteger(options.overlap, 0) || 0);
  if (overlap >= maxPixels) {
    throw new Error('겹침 픽셀은 자르기 기준 픽셀보다 작아야 합니다.');
  }

  return {
    ...options,
    axis,
    strategy,
    maxPixels,
    overlap: strategy === 'manual' ? 0 : overlap,
    minLastChunkPixels: Math.max(0, positiveInteger(options.minLastChunkPixels, 300) || 300),
    searchWindow: Math.max(80, positiveInteger(options.searchWindow, FLOW_SEARCH_WINDOW) || FLOW_SEARCH_WINDOW),
    manualCuts,
    fileNameTemplate: String(options.fileNameTemplate || '{name}_part_{index}').trim() || '{name}_part_{index}',
    fileNameStartIndex: Math.max(1, positiveInteger(options.fileNameStartIndex, 1) || 1),
    fileNamePadding: clamp(positiveInteger(options.fileNamePadding, 3) || 3, 1, 8),
    outputFormat: normalizeOutputFormat(options.outputFormat),
    quality: positiveInteger(options.quality, 92) || 92,
  };
}

function splitRangesByManual(totalPixels, manualCuts) {
  const cuts = manualCuts.filter(cut => cut > 0 && cut < totalPixels);
  if (cuts.length === 0) return [];

  const points = [0, ...cuts, totalPixels];
  const ranges = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (end > start) ranges.push({ start, length: end - start });
  }
  return ranges;
}

function splitRanges(totalPixels, options) {
  const ranges = [];
  let start = 0;

  while (start < totalPixels) {
    let length = Math.min(options.maxPixels, totalPixels - start);
    const remainingAfter = totalPixels - start - length;

    if (
      options.overlap === 0 &&
      remainingAfter > 0 &&
      remainingAfter < options.minLastChunkPixels &&
      length - (options.minLastChunkPixels - remainingAfter) >= options.minLastChunkPixels
    ) {
      length -= options.minLastChunkPixels - remainingAfter;
    }

    ranges.push({ start, length });
    if (start + length >= totalPixels) break;
    start += length - options.overlap;
  }

  return ranges;
}

function renderSplitOutputName(baseName, index, total, range, meta, options, formatExt) {
  const sequence = options.fileNameStartIndex + index;
  const paddedIndex = String(sequence).padStart(options.fileNamePadding, '0');
  const width = options.axis === 'vertical' ? meta.width : range.length;
  const height = options.axis === 'vertical' ? range.length : meta.height;
  const replacements = {
    name: baseName,
    index: paddedIndex,
    number: paddedIndex,
    n: String(sequence),
    total: String(total),
    width: String(width),
    height: String(height),
    start: String(range.start),
    end: String(range.start + range.length),
    axis: options.axis,
  };

  const rendered = options.fileNameTemplate.replace(/\{([a-zA-Z]+)\}/g, (match, token) => {
    return Object.prototype.hasOwnProperty.call(replacements, token) ? replacements[token] : match;
  });

  return `${sanitizeOutputBaseName(rendered)}.${formatExt}`;
}

async function buildSplitAnalysis(inputPath, meta, options) {
  const axisPixels = options.axis === 'vertical' ? meta.height : meta.width;
  const resizeOptions =
    options.axis === 'vertical'
      ? {
          width: Math.min(meta.width, FLOW_SAMPLE_CROSS_AXIS),
          height: Math.min(meta.height, FLOW_SAMPLE_MAX_AXIS),
          fit: 'inside',
          withoutEnlargement: true,
        }
      : {
          width: Math.min(meta.width, FLOW_SAMPLE_MAX_AXIS),
          height: Math.min(meta.height, FLOW_SAMPLE_CROSS_AXIS),
          fit: 'inside',
          withoutEnlargement: true,
        };

  const { data, info } = await sharp(inputPath, {
    animated: false,
    limitInputPixels: MAX_INPUT_PIXELS,
  })
    .rotate()
    .resize(resizeOptions)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const sampledAxisPixels = options.axis === 'vertical' ? info.height : info.width;
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
    axisScale: sampledAxisPixels / axisPixels,
  };
}

function sampledPixelOffset(analysis, x, y) {
  return (y * analysis.width + x) * analysis.channels;
}

function sampledPixelDifference(analysis, firstOffset, secondOffset) {
  return (
    Math.abs(analysis.data[firstOffset] - analysis.data[secondOffset]) +
    Math.abs(analysis.data[firstOffset + 1] - analysis.data[secondOffset + 1]) +
    Math.abs(analysis.data[firstOffset + 2] - analysis.data[secondOffset + 2])
  ) / 3;
}

function lineScore(analysis, axis, coordinate) {
  const maxCoordinate = axis === 'vertical' ? analysis.height - 2 : analysis.width - 2;
  const cut = clamp(coordinate, 1, maxCoordinate);
  const crossPixels = axis === 'vertical' ? analysis.width : analysis.height;
  let whitePixels = 0;
  let edgeSum = 0;
  let axisChangeSum = 0;
  let edgeCount = 0;

  for (let cross = 0; cross < crossPixels; cross += 1) {
    const x = axis === 'vertical' ? cross : cut;
    const y = axis === 'vertical' ? cut : cross;
    const current = sampledPixelOffset(analysis, x, y);
    const alpha = analysis.data[current + 3];
    const isWhite =
      alpha < 12 ||
      (analysis.data[current] > 245 &&
        analysis.data[current + 1] > 245 &&
        analysis.data[current + 2] > 245);

    if (isWhite) whitePixels += 1;

    if (cross > 0) {
      const prevCross =
        axis === 'vertical'
          ? sampledPixelOffset(analysis, cross - 1, cut)
          : sampledPixelOffset(analysis, cut, cross - 1);
      edgeSum += sampledPixelDifference(analysis, current, prevCross);
      edgeCount += 1;
    }

    const prevAxis =
      axis === 'vertical'
        ? sampledPixelOffset(analysis, x, cut - 1)
        : sampledPixelOffset(analysis, cut - 1, y);
    const nextAxis =
      axis === 'vertical'
        ? sampledPixelOffset(analysis, x, cut + 1)
        : sampledPixelOffset(analysis, cut + 1, y);

    axisChangeSum +=
      (sampledPixelDifference(analysis, current, prevAxis) +
        sampledPixelDifference(analysis, current, nextAxis)) /
      2;
  }

  const whiteRatio = whitePixels / Math.max(1, crossPixels);
  const edgeAverage = edgeSum / Math.max(1, edgeCount);
  const axisChangeAverage = axisChangeSum / Math.max(1, crossPixels);

  return edgeAverage * 0.9 + axisChangeAverage * 1.1 + (1 - whiteRatio) * 24 - whiteRatio * 18;
}

function bandScore(analysis, axis, coordinate) {
  let score = 0;
  let count = 0;

  for (let offset = -2; offset <= 2; offset += 1) {
    score += lineScore(analysis, axis, coordinate + offset);
    count += 1;
  }

  return score / count;
}

function findFlowCutEnd(analysis, start, desiredEnd, totalPixels, options) {
  const minEnd = Math.max(
    start + options.minLastChunkPixels,
    desiredEnd - Math.min(options.searchWindow, options.maxPixels - options.minLastChunkPixels)
  );
  const maxEnd = Math.min(desiredEnd, totalPixels - options.minLastChunkPixels);

  if (maxEnd <= minEnd || analysis.axisScale <= 0) return desiredEnd;

  const sampleMin = Math.max(3, Math.floor(minEnd * analysis.axisScale));
  const sampleMax = Math.min(
    options.axis === 'vertical' ? analysis.height - 4 : analysis.width - 4,
    Math.ceil(maxEnd * analysis.axisScale)
  );

  if (sampleMax <= sampleMin) return desiredEnd;

  const step = Math.max(1, Math.floor((sampleMax - sampleMin) / 160));
  let bestSample = sampleMax;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let sample = sampleMin; sample <= sampleMax; sample += step) {
    const originalEnd = clamp(Math.round(sample / analysis.axisScale), minEnd, maxEnd);
    const distancePenalty = ((desiredEnd - originalEnd) / Math.max(1, desiredEnd - minEnd)) * 7;
    const score = bandScore(analysis, options.axis, sample) + distancePenalty;

    if (score < bestScore) {
      bestScore = score;
      bestSample = sample;
    }
  }

  return clamp(Math.round(bestSample / analysis.axisScale), minEnd, maxEnd);
}

async function splitRangesByFlow(inputPath, meta, totalPixels, options) {
  const analysis = await buildSplitAnalysis(inputPath, meta, options);
  const ranges = [];
  let start = 0;

  while (start < totalPixels) {
    let length = Math.min(options.maxPixels, totalPixels - start);
    const remainingAfter = totalPixels - start - length;

    if (
      options.overlap === 0 &&
      remainingAfter > 0 &&
      remainingAfter < options.minLastChunkPixels &&
      length - (options.minLastChunkPixels - remainingAfter) >= options.minLastChunkPixels
    ) {
      length -= options.minLastChunkPixels - remainingAfter;
    }

    let end = start + length;
    if (end < totalPixels) {
      end = findFlowCutEnd(analysis, start, end, totalPixels, options);
      length = end - start;
    }

    ranges.push({ start, length });
    if (start + length >= totalPixels) break;

    const nextStart = start + length - options.overlap;
    start = nextStart > start ? nextStart : start + length;
  }

  return ranges;
}

async function splitImages({ inputPaths = [], outputDir, options = {} }) {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
    throw new Error('이미지 파일을 추가해주세요.');
  }

  const normalizedOptions = normalizeSplitOptions(options);
  const resolvedOutputDir = await ensureOutputDir(outputDir);
  const usedNames = new Set();
  const files = [];
  const formatExt = outputExtension(normalizedOptions.outputFormat);

  for (const inputPath of inputPaths) {
    const meta = await readImageMetadata(inputPath);
    const totalPixels = normalizedOptions.axis === 'vertical' ? meta.height : meta.width;
    const ranges =
      normalizedOptions.strategy === 'manual'
        ? splitRangesByManual(totalPixels, normalizedOptions.manualCuts)
        : normalizedOptions.strategy === 'flow'
        ? await splitRangesByFlow(inputPath, meta, totalPixels, normalizedOptions)
        : splitRanges(totalPixels, normalizedOptions);
    const baseName = sanitizeBaseName(path.basename(inputPath));

    if (normalizedOptions.strategy === 'manual' && ranges.length === 0) {
      throw new Error(`${path.basename(inputPath)} 범위 안에 들어오는 수동 절단선이 없습니다.`);
    }

    for (let index = 0; index < ranges.length; index += 1) {
      const range = ranges[index];
      const outputName = renderSplitOutputName(baseName, index, ranges.length, range, meta, normalizedOptions, formatExt);
      const outputPath = ensureUniquePath(resolvedOutputDir, outputName, usedNames);
      const extract =
        normalizedOptions.axis === 'vertical'
          ? { left: 0, top: range.start, width: meta.width, height: range.length }
          : { left: range.start, top: 0, width: range.length, height: meta.height };

      const pipeline = sharp(inputPath, {
        animated: false,
        limitInputPixels: MAX_INPUT_PIXELS,
      })
        .rotate()
        .extract(extract);

      await formatPipeline(pipeline, normalizedOptions).toFile(outputPath);
      files.push(await metadataFromOutput(outputPath, path.basename(inputPath)));
    }
  }

  return {
    files,
    manifest: {
      operation: 'split',
      count: files.length,
      options: normalizedOptions,
    },
  };
}

module.exports = {
  readImageMetadata,
  resizeImages,
  stitchImages,
  splitImages,
};
