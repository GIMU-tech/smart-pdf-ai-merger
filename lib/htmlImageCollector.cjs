const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const { fileURLToPath } = require('url');
const cheerio = require('cheerio');
const sharp = require('sharp');

const DEFAULT_LIMITS = {
  maxImages: 100,
  maxImageBytes: 25 * 1024 * 1024,
  maxTotalBytes: 300 * 1024 * 1024,
  timeoutMs: 15000,
};

const MAX_INPUT_PIXELS = 268000000;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
const MIME_EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
};

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function sanitizeFileName(name, fallback) {
  const parsed = path.parse(name || fallback || 'image');
  const safeBase = (parsed.name || 'image').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'image';
  const safeExt = (parsed.ext || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
  return `${safeBase}${safeExt}`;
}

function uniqueOutputPath(outputDir, fileName, usedNames) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = fileName;
  let index = 2;

  while (usedNames.has(candidate.toLowerCase()) || fs.existsSync(path.join(outputDir, candidate))) {
    candidate = `${base}_${index}${ext}`;
    index += 1;
  }

  usedNames.add(candidate.toLowerCase());
  return path.join(outputDir, candidate);
}

function extensionFromMime(contentType) {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  return MIME_EXTENSIONS[mime] || '';
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]';
}

function isPrivateOrLoopbackIp(address) {
  if (!address) return false;
  if (address === '::1') return true;
  if (address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:')) return true;

  if (net.isIP(address) !== 4) return false;
  const parts = address.split('.').map(Number);
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 0) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

function extractImageUrlsFromHtml(html, baseUrl) {
  const $ = cheerio.load(html || '');
  const urls = [];
  const seen = new Set();

  $('img').each((_, el) => {
    const raw =
      $(el).attr('src') ||
      $(el).attr('data-src') ||
      $(el).attr('data-original');

    if (!raw) return;

    try {
      const absolute = baseUrl ? new URL(raw, baseUrl).toString() : new URL(raw).toString();
      if (!seen.has(absolute)) {
        seen.add(absolute);
        urls.push(absolute);
      }
    } catch (_) {
      // Relative URLs without baseUrl are intentionally skipped.
    }
  });

  return urls;
}

function sanitizeRemoteImageUrl(url, options = {}) {
  const allowLocalUrls = options.allowLocalUrls === true;
  const allowFileUrls = options.allowFileUrls === true;
  const parsed = new URL(url);

  if (parsed.protocol === 'file:') {
    if (!allowFileUrls) {
      throw new Error('보안상 허용되지 않는 URL입니다.');
    }
    return parsed.toString();
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('보안상 허용되지 않는 URL입니다.');
  }

  if (isLoopbackHostname(parsed.hostname) && !allowLocalUrls) {
    throw new Error('보안상 허용되지 않는 URL입니다.');
  }

  return parsed.toString();
}

async function assertRemoteHostAllowed(parsed, options = {}) {
  const allowLocalUrls = options.allowLocalUrls === true;
  const hostname = parsed.hostname;

  if (isLoopbackHostname(hostname)) {
    if (allowLocalUrls) return;
    throw new Error('보안상 허용되지 않는 URL입니다.');
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrLoopbackIp(hostname)) {
      throw new Error('보안상 허용되지 않는 URL입니다.');
    }
    return;
  }

  const addresses = await dns.lookup(hostname, { all: true }).catch(() => []);
  if (addresses.some(entry => isPrivateOrLoopbackIp(entry.address))) {
    throw new Error('보안상 허용되지 않는 URL입니다.');
  }
}

async function writeImageBuffer({ buffer, outputDir, sourceName, sourceUrl, index, usedNames, contentType }) {
  const sourceExt = path.extname(sourceName || '').toLowerCase();
  const mimeExt = extensionFromMime(contentType);
  const ext = IMAGE_EXTENSIONS.has(sourceExt) ? sourceExt : mimeExt || '.png';
  const baseName = sanitizeFileName(sourceName || `image${ext}`, `image${ext}`);
  const normalizedName = path.extname(baseName) ? baseName : `${baseName}${ext}`;
  const numberedName = `${String(index).padStart(3, '0')}_${normalizedName}`;
  const outputPath = uniqueOutputPath(outputDir, numberedName, usedNames);

  await fsp.writeFile(outputPath, buffer);
  const meta = await sharp(outputPath, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  const stat = await fsp.stat(outputPath);

  return {
    path: outputPath,
    relativePath: toPosixPath(path.join('images', path.basename(outputPath))),
    fileName: path.basename(outputPath),
    url: sourceUrl,
    width: meta.width,
    height: meta.height,
    format: meta.format,
    size: stat.size,
  };
}

async function readFileImage({ urlObject, outputDir, index, usedNames, limits }) {
  const filePath = fileURLToPath(urlObject);
  const ext = path.extname(filePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) {
    throw new Error('지원하지 않는 파일 형식입니다.');
  }

  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) {
    throw new Error('이미지 파일이 아닙니다.');
  }
  if (stat.size > limits.maxImageBytes) {
    throw new Error('이미지 1개 최대 용량을 초과했습니다.');
  }

  const buffer = await fsp.readFile(filePath);
  return writeImageBuffer({
    buffer,
    outputDir,
    sourceName: path.basename(filePath),
    sourceUrl: urlObject.toString(),
    index,
    usedNames,
  });
}

async function fetchRemoteImage({ urlObject, outputDir, index, usedNames, limits, allowLocalUrls }) {
  await assertRemoteHostAllowed(urlObject, { allowLocalUrls });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), limits.timeoutMs);

  try {
    const response = await fetch(urlObject.toString(), {
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error('외부 이미지 다운로드에 실패했습니다.');
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      throw new Error('이미지 Content-Type이 아닙니다.');
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > limits.maxImageBytes) {
      throw new Error('이미지 1개 최대 용량을 초과했습니다.');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > limits.maxImageBytes) {
      throw new Error('이미지 1개 최대 용량을 초과했습니다.');
    }

    const sourceName = decodeURIComponent(path.basename(urlObject.pathname) || '');
    return writeImageBuffer({
      buffer,
      outputDir,
      sourceName,
      sourceUrl: urlObject.toString(),
      index,
      usedNames,
      contentType,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadImageUrls({ urls, outputDir, limits = {}, allowLocalUrls = false, allowFileUrls = false }) {
  const normalizedLimits = { ...DEFAULT_LIMITS, ...limits };
  await fsp.mkdir(outputDir, { recursive: true });

  const images = [];
  const skipped = [];
  const usedNames = new Set();
  let totalBytes = 0;

  for (const rawUrl of urls.slice(0, normalizedLimits.maxImages)) {
    const index = images.length + 1;

    try {
      const sanitized = sanitizeRemoteImageUrl(rawUrl, { allowLocalUrls, allowFileUrls });
      const urlObject = new URL(sanitized);
      const image =
        urlObject.protocol === 'file:'
          ? await readFileImage({ urlObject, outputDir, index, usedNames, limits: normalizedLimits })
          : await fetchRemoteImage({ urlObject, outputDir, index, usedNames, limits: normalizedLimits, allowLocalUrls });

      totalBytes += image.size || 0;
      if (totalBytes > normalizedLimits.maxTotalBytes) {
        throw new Error('전체 다운로드 최대 용량을 초과했습니다.');
      }

      images.push(image);
    } catch (err) {
      skipped.push({
        url: rawUrl,
        reason: err.message || '외부 이미지 다운로드에 실패했습니다.',
      });
    }
  }

  return { images, skipped, totalBytes };
}

function outputExtension(format) {
  const normalized = String(format || 'png').toLowerCase();
  if (normalized === 'jpeg' || normalized === 'jpg') return 'jpg';
  if (normalized === 'webp') return 'webp';
  if (normalized === 'avif') return 'avif';
  if (normalized === 'gif') return 'gif';
  if (normalized === 'tiff' || normalized === 'tif') return 'tiff';
  return 'png';
}

function formatPipeline(pipeline, format, quality) {
  const normalized = String(format || 'png').toLowerCase();
  if (normalized === 'jpeg' || normalized === 'jpg') return pipeline.jpeg({ quality: quality || 92 });
  if (normalized === 'webp') return pipeline.webp({ quality: quality || 92 });
  if (normalized === 'avif') return pipeline.avif({ quality: quality || 92 });
  if (normalized === 'gif') return pipeline.gif();
  if (normalized === 'tiff' || normalized === 'tif') return pipeline.tiff({ quality: quality || 92 });
  return pipeline.png();
}

async function createCombinedImage({ imagePaths, outputDir, targetWidth, outputFormat = 'png', quality = 92, background = '#ffffff' }) {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) return null;

  await fsp.mkdir(outputDir, { recursive: true });

  const prepared = [];
  for (const imagePath of imagePaths) {
    let pipeline = sharp(imagePath, { animated: false, limitInputPixels: MAX_INPUT_PIXELS }).rotate();
    if (targetWidth) {
      pipeline = pipeline.resize({ width: Number(targetWidth) });
    }
    const buffer = await pipeline.toBuffer();
    const meta = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    prepared.push({ buffer, width: meta.width, height: meta.height });
  }

  const width = Math.max(...prepared.map(item => item.width));
  const height = prepared.reduce((sum, item) => sum + item.height, 0);
  let top = 0;
  const composites = prepared.map(item => {
    const current = { input: item.buffer, left: 0, top };
    top += item.height;
    return current;
  });

  const fileName = `combined_vertical.${outputExtension(outputFormat)}`;
  const outputPath = path.join(outputDir, fileName);
  const pipeline = sharp({
    create: {
      width,
      height,
      channels: 4,
      background,
    },
  }).composite(composites);

  await formatPipeline(pipeline, outputFormat, quality).toFile(outputPath);
  const stat = await fsp.stat(outputPath);

  return {
    path: outputPath,
    relativePath: toPosixPath(path.join('combined', fileName)),
    fileName,
    width,
    height,
    format: outputExtension(outputFormat),
    size: stat.size,
  };
}

async function processHtmlImages({ htmlText, htmlFilePath, outputDir, options = {}, allowLocalUrls = false, allowFileUrls = false }) {
  await fsp.mkdir(outputDir, { recursive: true });

  const html =
    htmlText && htmlText.trim()
      ? htmlText
      : htmlFilePath
        ? await fsp.readFile(htmlFilePath, 'utf8')
        : '';

  if (!html.trim()) {
    throw new Error('HTML 파일을 업로드하거나 HTML 코드를 입력해주세요.');
  }

  const urls = extractImageUrlsFromHtml(html, options.baseUrl);
  if (urls.length === 0) {
    throw new Error('HTML에서 이미지 링크를 찾지 못했습니다.');
  }

  const imagesDir = path.join(outputDir, 'images');
  const combinedDir = path.join(outputDir, 'combined');
  const downloaded = await downloadImageUrls({
    urls,
    outputDir: imagesDir,
    allowLocalUrls,
    allowFileUrls,
  });

  if (downloaded.images.length === 0) {
    throw new Error(downloaded.skipped[0]?.reason || '외부 이미지 다운로드에 실패했습니다.');
  }

  let combined = null;
  if (options.createCombinedImage !== false) {
    combined = await createCombinedImage({
      imagePaths: downloaded.images.map(image => image.path),
      outputDir: combinedDir,
      targetWidth: Number(options.combinedTargetWidth || 0) || undefined,
      outputFormat: options.outputFormat || 'png',
      quality: Number(options.quality || 92),
    });
  }

  const manifest = {
    sourceType: 'html',
    baseUrl: options.baseUrl || '',
    count: downloaded.images.length,
    requestedCount: urls.length,
    images: downloaded.images.map((image, index) => ({
      index: index + 1,
      url: image.url,
      fileName: image.relativePath,
      width: image.width,
      height: image.height,
      size: image.size,
    })),
    skipped: downloaded.skipped,
    combined: combined
      ? {
          fileName: combined.relativePath,
          width: combined.width,
          height: combined.height,
        }
      : null,
  };

  const manifestPath = path.join(outputDir, 'manifest.json');
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  const files = [
    ...downloaded.images,
    ...(combined ? [combined] : []),
    {
      path: manifestPath,
      relativePath: 'manifest.json',
      fileName: 'manifest.json',
      format: 'json',
      size: Buffer.byteLength(JSON.stringify(manifest, null, 2)),
    },
  ];

  return {
    files,
    manifest,
  };
}

module.exports = {
  extractImageUrlsFromHtml,
  downloadImageUrls,
  sanitizeRemoteImageUrl,
  processHtmlImages,
};
