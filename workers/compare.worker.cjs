const { parentPort, workerData } = require('worker_threads');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execFile } = require('child_process');
const { PNG } = require('pngjs');
const cv   = require('@techstark/opencv-js');
const { createWorker, PSM, OEM } = require('tesseract.js');
const diffLib = require('diff');
const { PDFDocument } = require('pdf-lib');

// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧
// UTILITIES
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧

function diceSim(a, b) {
  a = a.replace(/\uFFFD/g, '').replace(/\s+/g,'').toLowerCase();
  b = b.replace(/\uFFFD/g, '').replace(/\s+/g,'').toLowerCase();
  if (a === b) return 1.0;
  if (a.length < 2 || b.length < 2) return 0.0;
  const m = new Map();
  for (let i = 0; i < a.length-1; i++) { const k=a.slice(i,i+2); m.set(k,(m.get(k)||0)+1); }
  let h=0;
  for (let i = 0; i < b.length-1; i++) {
    const k=b.slice(i,i+2);
    if ((m.get(k)||0)>0){m.set(k,m.get(k)-1);h++;}
  }
  return (2*h)/(a.length+b.length-2);
}

// Extract all numeric tokens and compare them strictly
function numericDiffers(a, b) {
  const numsA = (a.match(/[\d.,]+/g) || []).map(n=>parseFloat(n.replace(/,/g,'')));
  const numsB = (b.match(/[\d.,]+/g) || []).map(n=>parseFloat(n.replace(/,/g,'')));
  if (numsA.length !== numsB.length) return true;
  return numsA.some((v,i) => Math.abs(v - numsB[i]) > 1e-6);
}

// Post-process OCR text: fix common OCR errors, trim junk
function postProcess(raw) {
  return raw
    .replace(/\uFFFD/g, ' ')
    .trim()
    .replace(/[|]{1}/g, 'I')          // pipe ??I
    .replace(/0(?=[a-zA-Z])/g,'O')    // 0?뭀 before letters
    .replace(/(?<=[a-zA-Z])0/g,'O')   // 0?뭀 after letters
    .replace(/[^\x20-\x7E\uAC00-\uD7A3\u3131-\u314E\u314F-\u3163\uFF00-\uFFEF]/g,' ')
    .replace(/\s{2,}/g,' ')
    .trim();
}

// Crop png region using raw buffer (no bitblt)
function cropRegion(png, x, y, w, h) {
  x = Math.max(0, x); y = Math.max(0, y);
  w = Math.min(png.width  - x, w);
  h = Math.min(png.height - y, h);
  if (w <= 0 || h <= 0) return null;
  const out = new PNG({ width: w, height: h });
  for (let row = 0; row < h; row++)
    png.data.copy(out.data, row*w*4, ((y+row)*png.width+x)*4, ((y+row)*png.width+x+w)*4);
  return out;
}

// Extract the actual content bounding rect from a PNG image using adaptive thresholding and contour detection.
function getContentBoundingBox(png) {
  const { width, height, data } = png;
  let src;
  try {
    src = cv.matFromImageData({ width, height, data });
  } catch (e) {
    return { x: 0, y: 0, w: width, h: height };
  }
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  
  const bin = new cv.Mat();
  // Threshold to find non-white pixels (PDF background is 255)
  cv.threshold(gray, bin, 252, 255, cv.THRESH_BINARY_INV);
  
  const ctrs = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(bin, ctrs, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  
  let minX = width, minY = height, maxX = 0, maxY = 0;
  let found = false;
  for (let i = 0; i < ctrs.size(); i++) {
    const c = ctrs.get(i);
    const r = cv.boundingRect(c);
    if (r.width > 2 && r.height > 2) {
      found = true;
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.width > maxX) maxX = r.x + r.width;
      if (r.y + r.height > maxY) maxY = r.y + r.height;
    }
    c.delete();
  }
  
  src.delete(); gray.delete(); bin.delete(); ctrs.delete(); hier.delete();
  
  if (!found) {
    return { x: 0, y: 0, w: width, h: height };
  }
  
  // Padding to avoid clipping edge content
  const pad = 4;
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  const w = Math.min(width - x, (maxX - minX) + pad * 2);
  const h = Math.min(height - y, (maxY - minY) + pad * 2);
  return { x, y, w, h };
}

// Extract standard page boxes from a PDF-lib PDFDocument
function getPageBoxes(pdfDoc, pIndex) {
  if (!pdfDoc) return null;
  try {
    const pages = pdfDoc.getPages();
    if (pIndex >= pages.length) return null;
    const page = pages[pIndex];
    
    const boxToObj = (box) => box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
    
    return {
      mediaBox: boxToObj(page.getMediaBox()),
      cropBox: boxToObj(page.getCropBox()),
      trimBox: boxToObj(page.getTrimBox()),
      bleedBox: boxToObj(page.getBleedBox()),
      artBox: boxToObj(page.getArtBox()),
    };
  } catch (e) {
    return null;
  }
}

// Group separate text items into logical lines based on spatial relationships (Y and X alignment)
function groupTextIntoLines(items) {
  if (!items || items.length === 0) return [];

  // Sort primarily by Y, then by X
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 6) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });

  const lines = [];
  let currentLine = [];

  for (const item of sorted) {
    if (currentLine.length === 0) {
      currentLine.push(item);
    } else {
      const prev = currentLine[currentLine.length - 1];
      // Group items on roughly the same horizontal level (Y within 8px)
      // and ensure they are not separated by large columns (X within 120px)
      const isSameY = Math.abs(item.y - prev.y) <= 8;
      const isCloseX = (item.x - (prev.x + prev.w)) < 120;

      if (isSameY && isCloseX) {
        currentLine.push(item);
      } else {
        lines.push(currentLine);
        currentLine = [item];
      }
    }
  }
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  // Convert groups into continuous line descriptors
  return lines.map(lineItems => {
    lineItems.sort((a, b) => a.x - b.x);
    const str = lineItems.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
    const minX = Math.min(...lineItems.map(it => it.x));
    const minY = Math.min(...lineItems.map(it => it.y));
    const maxX = Math.max(...lineItems.map(it => it.x + it.w));
    const maxY = Math.max(...lineItems.map(it => it.y + it.h));
    return {
      str,
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
      items: lineItems
    };
  }).filter(line => line.str.length > 0);
}

// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧
// OCR PIPELINE

// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧

let _ocrWorker = null;
async function getOCRWorker() {
  if (!_ocrWorker) {
    const localLangPath = path.join(__dirname, '..');
    _ocrWorker = await createWorker('kor+eng', OEM.LSTM_ONLY, {
      langPath: localLangPath,
      cachePath: localLangPath,
      gzip: false
    });
  }
  return _ocrWorker;
}

/**
 * preprocess(): OpenCV image preprocessing for OCR accuracy
 * - upscale small regions 2x
 * - CLAHE contrast enhancement
 * - Gaussian denoise
 * - Adaptive threshold for outlined/thin fonts
 */
function preprocessForOCR(pngCrop) {
  const { width, height, data } = pngCrop;
  const src = cv.matFromImageData({ width, height, data });

  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  // Upscale tiny regions (text < 30px tall is unreadable)
  let working = gray;
  const scaled = new cv.Mat();
  if (height < 40) {
    const factor = Math.ceil(40 / height) + 1;
    cv.resize(gray, scaled, new cv.Size(width*factor, height*factor), 0, 0, cv.INTER_CUBIC);
    working = scaled;
  }

  // CLAHE ??contrast limited adaptive histogram equalization
  const clahe = new cv.CLAHE(3.0, new cv.Size(8, 8));
  const enhanced = new cv.Mat();
  clahe.apply(working, enhanced);

  // Gaussian denoise
  const denoised = new cv.Mat();
  cv.GaussianBlur(enhanced, denoised, new cv.Size(3, 3), 0);

  // Sharpening kernel
  const kernel = cv.matFromArray(3, 3, cv.CV_32F, [
    0, -0.5, 0, -0.5, 3, -0.5, 0, -0.5, 0
  ]);
  const sharpened = new cv.Mat();
  cv.filter2D(denoised, sharpened, -1, kernel);

  // Otsu's binarization to perfectly handle both small and large fonts without hollowing
  const binary = new cv.Mat();
  cv.threshold(sharpened, binary, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);

  // Ensure black text on white background (automatically invert if background is dark)
  const meanVal = cv.mean(binary);
  if (meanVal[0] < 127) {
    cv.bitwise_not(binary, binary);
  }

  // Morphology cleanup & stroke enhancement using MORPH_CLOSE
  const element = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
  const morph = new cv.Mat();
  cv.morphologyEx(binary, morph, cv.MORPH_CLOSE, element);

  // Convert back to RGBA for PNG encoding
  const rgba = new cv.Mat();
  cv.cvtColor(morph, rgba, cv.COLOR_GRAY2RGBA);

  const outW = rgba.cols, outH = rgba.rows;
  const outPng = new PNG({ width: outW, height: outH });
  outPng.data.set(rgba.data);

  src.delete(); gray.delete(); scaled.delete(); enhanced.delete();
  denoised.delete(); sharpened.delete(); binary.delete(); rgba.delete(); kernel.delete();
  clahe.delete(); element.delete(); morph.delete();

  return outPng;
}

/**
 * ocrRegion(): multi-pass OCR with PSM voting
 * Runs Tesseract at PSM.SINGLE_LINE and PSM.SINGLE_BLOCK,
 * picks the result with higher confidence.
 */
async function ocrRegion(pngCrop, ocr) {
  // Preprocess
  let processed;
  try { processed = preprocessForOCR(pngCrop); }
  catch(_) { processed = pngCrop; }

  const buf = PNG.sync.write(processed);

  // Pass 1: Single-line mode (best for title/headline text)
  const r1 = await ocr.recognize(buf, {}, { blocks: false, layoutBlocks: false });
  const text1 = postProcess(r1.data.text || '');
  const conf1 = r1.data.confidence || 0;

  // Pass 2: If low confidence, retry with block mode
  let text2 = '', conf2 = 0;
  if (conf1 < 65) {
    try {
      await ocr.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      const r2 = await ocr.recognize(buf);
      text2 = postProcess(r2.data.text || '');
      conf2 = r2.data.confidence || 0;
      await ocr.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
    } catch(_) {}
  }

  // Vote: pick higher confidence result
  const winner = (conf2 > conf1 + 10) ? { text: text2, conf: conf2 } : { text: text1, conf: conf1 };
  return winner;
}

// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧
// GEOMETRY DETECTION (OpenCV)
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧

function detectGeo(png, minSide, textList = [], contentBox = null) {
  const { width, height, data } = png;
  const src  = cv.matFromImageData({ width, height, data });
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  // Catch lighter filled shapes and pastel buttons by lowering/sensitizing threshold to 245
  const bin  = new cv.Mat();
  cv.threshold(gray, bin, 245, 255, cv.THRESH_BINARY_INV);

  const k      = cv.Mat.ones(3, 3, cv.CV_8U);
  const closed = new cv.Mat();
  cv.morphologyEx(bin, closed, cv.MORPH_CLOSE, k);

  const ctrs = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(closed, ctrs, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const geos = [];
  for (let i = 0; i < ctrs.size(); i++) {
    const c = ctrs.get(i);
    const r = cv.boundingRect(c);
    
    // 1. Discard tiny noise (specks)
    if (r.width < 5 && r.height < 5) { c.delete(); continue; }

    // 2. Line/Shape classification: dividers and borders can be thin and short (>= 10px)
    // Elongated rectangular blocks (like table cells, form inputs, button boundaries) are captured perfectly.
    const isLine = (r.width >= 10 && r.height <= 8) || (r.height >= 10 && r.width <= 8);
    const isNormalShape = (r.width >= minSide && r.height >= minSide) || 
                          (r.width >= 6 && r.height >= 6 && Math.max(r.width, r.height) >= minSide);

    if (!isLine && !isNormalShape) { c.delete(); continue; }

    // 2.1. Discard giant page-border boxes or background containers
    if (r.width > width * 0.8 && r.height > height * 0.8) { c.delete(); continue; }

    // 2.2. Discard geometry outside the active content bounds to ignore artboard margin/border shifts
    if (contentBox && contentBox.w > 0) {
      const pad = 10;
      const inBox = r.x >= contentBox.x - pad &&
                    r.y >= contentBox.y - pad &&
                    (r.x + r.width) <= (contentBox.x + contentBox.w + pad) &&
                    (r.y + r.height) <= (contentBox.y + contentBox.h + pad);
      if (!inBox) { c.delete(); continue; }
    }

    // Determine type before checking text outlines
    let type = 'block';
    if      (r.width > 80 && r.height <= 6)  type = 'hline';
    else if (r.height > 80 && r.width <= 6)  type = 'vline';
    else {
      const peri = cv.arcLength(c, true);
      const app  = new cv.Mat();
      cv.approxPolyDP(c, app, 0.04*peri, true);
      type = app.rows === 4 ? 'rect' : app.rows > 4 && app.rows <= 10 ? 'rounded' : 'block';
      app.delete();
    }

    // 3. Ignore shapes that overlap significantly with text blocks (likely text contours)
    // ONLY ignore if it is classified as a generic 'block' outline.
    // Genuine geometric shapes ('rect', 'rounded', 'hline', 'vline') represent containers/lines and must be compared!
    if (type === 'block' && textList.length > 0) {
      let isTextOutline = false;
      for (const t of textList) {
        const ix1 = Math.max(r.x, t.x);
        const iy1 = Math.max(r.y, t.y);
        const ix2 = Math.min(r.x + r.w, t.x + t.w);
        const iy2 = Math.min(r.y + r.h, t.y + t.h);
        if (ix2 > ix1 && iy2 > iy1) {
          const interArea = (ix2 - ix1) * (iy2 - iy1);
          const rArea = r.width * r.height;
          if (interArea / rArea > 0.25) { // 25% area overlap
            isTextOutline = true;
            break;
          }
        }
      }
      if (isTextOutline) { c.delete(); continue; }
    }

    geos.push({ type, x:r.x, y:r.y, w:r.width, h:r.height });
    c.delete();
  }

  src.delete(); gray.delete(); bin.delete(); k.delete(); closed.delete(); ctrs.delete(); hier.delete();
  return geos;
}

// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧
// HELPERS
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧

function overlaps(a, b, pad=2) {
  return !(b.x > a.x+a.w+pad || b.x+b.w < a.x-pad || b.y > a.y+a.h+pad || b.y+b.h < a.y-pad);
}
function iou(a, b) {
  const ix1=Math.max(a.x,b.x), iy1=Math.max(a.y,b.y);
  const ix2=Math.min(a.x+a.w,b.x+b.w), iy2=Math.min(a.y+a.h,b.y+b.h);
  if(ix2<=ix1||iy2<=iy1) return 0;
  const inter=(ix2-ix1)*(iy2-iy1);
  return inter/(a.w*a.h+b.w*b.h-inter);
}
function pixDiffRatio(dA, dB, W, x, y, w, h) {
  let d=0;
  for(let row=y;row<y+h;row++)
    for(let col=x;col<x+w;col++){
      const i=(row*W+col)*4;
      if(Math.abs(dA[i]-dB[i])>22||Math.abs(dA[i+1]-dB[i+1])>22||Math.abs(dA[i+2]-dB[i+2])>22) d++;
    }
  return w*h>0?d/(w*h):0;
}

// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧
// MAIN PIPELINE
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧

async function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfdiff-'));
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs').catch(()=>require('pdfjs-dist/legacy/build/pdf.js'));
    const { default: pixelmatch } = await import('pixelmatch');
    const { fileA, fileB, gsPath, gsLibPath, sensitivity } = workerData;

    // Load PDF-lib Documents for page boxes extraction
    let pdfDocA = null, pdfDocB = null;
    try { pdfDocA = await PDFDocument.load(fs.readFileSync(fileA)); } catch(e) {}
    try { pdfDocB = await PDFDocument.load(fs.readFileSync(fileB)); } catch(e) {}

    // OCR Vector supersampling re-renderer helper using Ghostscript
    function renderVectorRegion(filePath, p, x_pdf, y_pdf, w_pt, h_pt, targetDPI, outPath) {
      return new Promise((res, rej) => {
        execFile(gsPath, [
          '-I' + gsLibPath, '-dSAFER', '-dBATCH', '-dNOPAUSE',
          '-sDEVICE=png16m', `-r${targetDPI}`,
          `-dFirstPage=${p}`, `-dLastPage=${p}`,
          `-dDEVICEWIDTHPOINTS=${w_pt}`,
          `-dDEVICEHEIGHTPOINTS=${h_pt}`,
          '-dUseCropBox',
          '-dFIXEDMEDIA',
          '-c', `<</PageOffset [-${x_pdf} -${y_pdf}]>> setpagedevice`,
          `-sOutputFile=${outPath}`, filePath
        ], err => err ? rej(err) : res());
      });
    }

    // ?? Mode configuration ??????????????????????????????????????????????????
    // DPI: 150 for default/layout (excellent speed + accurate OCR), 300 for ultra (ultra precision)
    const DPI = sensitivity === 'ultra' ? 300 : 150;

    const R   = 72 / DPI; // px ??PDF pt

    const M = sensitivity === 'ultra'
      ? { minGeo:1,  geoTol:0.05, textSim:0.99, visTol:0.001, ocrConf:25 } // 珥덉젙諛 寃??(紐⑤뱺 誘몄꽭 李⑥씠 諛??ㅼ감 ?꾧꺽 媛먯?)
      : sensitivity === 'layout'
      ? { minGeo:5,  geoTol:1.0,  textSim:0.95, visTol:0.01,  ocrConf:40 } // 援ъ“ 寃??(?띿뒪???ㅼ감 洹뱁엳 ?쇰? ?덉슜, 援ъ“/?꾪삎 以묒떖)
      : { minGeo:10, geoTol:3.0,  textSim:0.88, visTol:0.06,  ocrConf:55 }; // ?ㅻТ 寃??(1湲??蹂寃쎈룄 ?щ쭔?섎㈃ ?〓룄濡?88%濡??곹뼢)

    // ?? Initialise OCR ??????????????????????????????????????????????????????
    let ocr = null;
    try { ocr = await getOCRWorker(); } catch(e) {}

    // ?? Extract native text ?????????????????????????????????????????????????
    async function getNativeText(filePath) {
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(filePath)), verbosity:0 }).promise;
      const pages = [];
      for (let p=1; p<=doc.numPages; p++) {
        const page = await doc.getPage(p);
        const vp   = page.getViewport({ scale:1.0 });
        const tc   = await page.getTextContent();
        const items = [];
        for (const it of tc.items) {
          if (!it.str?.trim()) continue;
          const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
          // Scale bbox to match DPI render
          const scale = DPI / 72;
          items.push({
            str: it.str.replace(/\uFFFD/g, ' ').replace(/\s+/g, ' ').trim(),
            x: tx[4]*scale, y:(tx[5]-it.height)*scale,
            w: it.width*scale, h: it.height*scale
          });
        }
        pages.push(items);
      }
      return pages;
    }

    // ?? Render all pages with GhostScript in one pass ????????????????????????
    function renderAllPNGs(filePath, outPattern) {
      return new Promise((res, rej) =>
        execFile(gsPath, [
          '-I' + gsLibPath, '-dSAFER', '-dBATCH', '-dNOPAUSE',
          '-sDEVICE=png16m', `-r${DPI}`,
          '-dUseCropBox',
          `-sOutputFile=${outPattern}`, filePath
        ], err => err ? rej(err) : res())
      );
    }

    const [nativeA, nativeB] = await Promise.all([getNativeText(fileA), getNativeText(fileB)]);
    const maxPages = Math.max(nativeA.length, nativeB.length);
    const results  = [];

    // Run sequentially to save memory on resource-constrained environments (like Render free tier)
    try {
      await renderAllPNGs(fileA, path.join(tempDir, 'a%d.png'));
    } catch (e) {
      console.error('[Worker] Error rendering PDF A:', e);
    }
    try {
      await renderAllPNGs(fileB, path.join(tempDir, 'b%d.png'));
    } catch (e) {
      console.error('[Worker] Error rendering PDF B:', e);
    }

    for (let p=1; p<=maxPages; p++) {
      const diffs  = [];
      const tA     = nativeA[p-1] || [];
      const tB_orig= nativeB[p-1] || [];
      const pA = path.join(tempDir, `a${p}.png`);
      const pB = path.join(tempDir, `b${p}.png`);

      const hasA = fs.existsSync(pA), hasB = fs.existsSync(pB);
      let base64A=null, base64B=null;

      let boxesA = null, boxesB = null;
      let contentBoxA = null, contentBoxB = null;
      let s_x = 1.0, s_y = 1.0, t_x = 0.0, t_y = 0.0;
      let imgA = null, imgB = null;

      if (!hasA && !hasB) continue;
      if (hasA && !hasB) {
        const rawA = PNG.sync.read(fs.readFileSync(pA));
        diffs.push({ type:'page_deleted', severity:'critical', desc:'페이지 삭제됨', bbox:{x:0,y:0,width:rawA.width,height:rawA.height} });
      } else if (!hasA && hasB) {
        const rawB = PNG.sync.read(fs.readFileSync(pB));
        diffs.push({ type:'page_added', severity:'critical', desc:'페이지 추가됨', bbox:{x:0,y:0,width:rawB.width,height:rawB.height} });
      } else {
        const rawA = PNG.sync.read(fs.readFileSync(pA));
        const rawB = PNG.sync.read(fs.readFileSync(pB));

        // Step 1 & 2: Extract PDF standard boxes and actual content boxes using OpenCV contour detection
        boxesA = getPageBoxes(pdfDocA, p - 1);
        boxesB = getPageBoxes(pdfDocB, p - 1);
        
        contentBoxA = getContentBoundingBox(rawA);
        contentBoxB = getContentBoundingBox(rawB);

        // Step 3: Compute affine scale ratio and translation offset mapping content box B to A
        s_x = contentBoxB.w > 0 ? contentBoxA.w / contentBoxB.w : 1.0;
        s_y = contentBoxB.h > 0 ? contentBoxA.h / contentBoxB.h : 1.0;
        
        // Snap scale to 1.0 if the difference is negligible (< 2%) to prevent sub-pixel blurring during warp
        if (Math.abs(s_x - 1.0) < 0.02) s_x = 1.0;
        if (Math.abs(s_y - 1.0) < 0.02) s_y = 1.0;
        
        t_x = contentBoxA.x - s_x * contentBoxB.x;
        t_y = contentBoxA.y - s_y * contentBoxB.y;

        // SEMANTIC ANCHOR ALIGNMENT: Find an identical native text in both to lock absolute sub-pixel accuracy!
        if (tA.length > 0 && tB_orig.length > 0 && s_x === 1.0 && s_y === 1.0) {
          // Sort texts by length descending to find the most unique, stable string
          const sortedA = [...tA].filter(t => t.str.trim().length > 3).sort((a,b) => b.str.length - a.str.length);
          for (const anchorA of sortedA) {
            const anchorB = tB_orig.find(t => t.str === anchorA.str);
            if (anchorB) {
              t_x = anchorA.x - anchorB.x;
              t_y = anchorA.y - anchorB.y;
              break; // Alignment Locked!
            }
          }
        }

        // Snapping translation offsets to exact integers to completely eliminate low-pass blurring during warpAffine
        if (s_x === 1.0 && s_y === 1.0) {
          t_x = Math.round(t_x);
          t_y = Math.round(t_y);
        }

        // Page-level overall shift warning (Artboard offset detection)
        const pShiftX = t_x * (72 / DPI);
        const pShiftY = t_y * (72 / DPI);
        if (Math.abs(pShiftX) > 2.0 || Math.abs(pShiftY) > 2.0) {
          diffs.push({
            type: 'spacing_changed',
            severity: 'low',
            desc: `[INFO] 페이지 전체 디자인이 대지 기준으로 평행 이동되었습니다. (가로 ${Math.round(pShiftX)}pt, 세로 ${Math.round(pShiftY)}pt 이동, 내용물 일치)`,
            bbox: { x: 0, y: 0, width: rawA.width, height: 25 }
          });
        }

        // Warp Image B to align perfectly with Image A's dimensions and coordinate space
        const srcB = cv.matFromImageData({ width: rawB.width, height: rawB.height, data: rawB.data });
        const M = cv.matFromArray(2, 3, cv.CV_64F, [s_x, 0, t_x, 0, s_y, t_y]);
        const dstB = new cv.Mat();
        const dsize = new cv.Size(rawA.width, rawA.height);
        
        cv.warpAffine(srcB, dstB, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));

        imgA = rawA;
        imgB = new PNG({ width: rawA.width, height: rawA.height });
        imgB.data.set(dstB.data);

        srcB.delete(); M.delete(); dstB.delete();

        const W = imgA.width;
        const H = imgA.height;
        const handled = []; // px-space rects already processed

        const overlapHandled = (r) => handled.some(h=>overlaps(r,h,4));

        // Vector-aware OCR Region Re-renderer to render target areas at high DPI (supersampled)
        async function ocrVectorRegion(filePath, bx, by, bw, bh, isA) {
          let targetX = bx;
          let targetY = by;
          let targetW = bw;
          let targetH = bh;

          if (!isA) {
            // Inverse transform back to B's original pixel coordinate space
            targetX = (bx - t_x) / s_x;
            targetY = (by - t_y) / s_y;
            targetW = bw / s_x;
            targetH = bh / s_y;
          }

          // Dynamic scale factor based on text pixel height in target space
          let F = 4;
          if (targetH < 8) {
            F = 12;
          } else if (targetH < 12) {
            F = 8;
          }

          const targetDPI = DPI * F;
          const R_base = 72 / DPI;

          // Convert to PDF points
          const x_pt = targetX * R_base;
          const y_pt = targetY * R_base;
          const w_pt = targetW * R_base;
          const h_pt = targetH * R_base;

          const H_base = isA ? rawA.height : rawB.height;
          const H_pt_total = H_base * R_base;

          // PDF bottom-left points origin conversion
          const y_pdf = H_pt_total - (y_pt + h_pt);

          // Padding in points
          const pad_pt = 3;
          const x_pdf_padded = Math.floor(Math.max(0, x_pt - pad_pt));
          const y_pdf_padded = Math.floor(Math.max(0, y_pdf - pad_pt));

          const maxW_pt = H_pt_total * (isA ? rawA.width/rawA.height : rawB.width/rawB.height);
          const w_pt_padded = Math.ceil(Math.min(maxW_pt - x_pdf_padded, w_pt + pad_pt * 2));
          const h_pt_padded = Math.ceil(Math.min(H_pt_total - y_pdf_padded, h_pt + pad_pt * 2));

          if (w_pt_padded <= 0 || h_pt_padded <= 0) return { text: '', conf: 0 };

          const tempCropPath = path.join(tempDir, `crop_${p}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.png`);
          try {
            await renderVectorRegion(filePath, p, x_pdf_padded, y_pdf_padded, w_pt_padded, h_pt_padded, targetDPI, tempCropPath);
            const pngCrop = PNG.sync.read(fs.readFileSync(tempCropPath));
            try { fs.unlinkSync(tempCropPath); } catch(_) {}

            // Preprocess & run OCR
            return await ocrRegion(pngCrop, ocr);
          } catch (err) {
            console.error('Vector OCR render error:', err);
            try { fs.unlinkSync(tempCropPath); } catch(_) {}
            // Fallback to standard crop
            const cropFallback = cropRegion(isA ? imgA : imgB, bx, by, bw, bh);
            if (cropFallback) {
              return await ocrRegion(cropFallback, ocr);
            }
            return { text: '', conf: 0 };
          }
        }

        // Apply affine translation & scaling to Document B's native text coordinates
        const tB = tB_orig.map(item => ({
          ...item,
          x: s_x * item.x + t_x,
          y: s_y * item.y + t_y,
          w: s_x * item.w,
          h: s_y * item.h
        }));

        // ── LAYER 2 & 3 ── Layout Block & Text Region Detection (OpenCV) ──────────────────
        function detectTextRegions(img) {
          const { width, height, data } = img;
          const src = cv.matFromImageData({ width, height, data });
          const gray = new cv.Mat();
          cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
          
          const bin = new cv.Mat();
          cv.adaptiveThreshold(gray, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);
          
          // Horizontal dilation to connect words into semantic text lines
          const k = cv.Mat.ones(3, 15, cv.CV_8U); 
          const morph = new cv.Mat();
          cv.morphologyEx(bin, morph, cv.MORPH_DILATE, k);
          
          const ctrs = new cv.MatVector();
          const hier = new cv.Mat();
          cv.findContours(morph, ctrs, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
          
          const regions = [];
          for (let i = 0; i < ctrs.size(); i++) {
            const r = cv.boundingRect(ctrs.get(i));
            // Filter out pure noise or excessively large graphic blocks
            if (r.width > 8 && r.height > 6 && r.height < 300) {
              regions.push({ x: r.x, y: r.y, w: r.width, h: r.height });
            }
          }
          
          src.delete(); gray.delete(); bin.delete(); k.delete(); morph.delete(); ctrs.delete(); hier.delete();
          return regions.sort((a,b) => Math.abs(a.y-b.y)>8 ? a.y-b.y : a.x-b.x);
        }

        // ── LAYER 1 ── Native Priority & Outlined OCR Fallback (Hybrid Engine) ────────────
        const regionsB_all = detectTextRegions(imgB);
        const linesA = groupTextIntoLines(tA);
        const linesB = groupTextIntoLines(tB);
        const handledB = new Set(); // indices of linesB that have been matched

        // 1. Compare Native A to Native B, falling back to targeted OCR on B if needed
        for (const lineA of linesA) {
          const rA = { x: lineA.x, y: lineA.y, w: lineA.w, h: lineA.h };
          if (overlapHandled(rA)) continue;

          // Find overlapping line in B (spatial matching)
          let bestIdx = -1;
          let bestScore = -1;

          for (let i = 0; i < linesB.length; i++) {
            if (handledB.has(i)) continue;
            const lineB = linesB[i];

            const yDiff = Math.abs(lineA.y - lineB.y);
            // If the lines overlap vertically or are very close (within 16px)
            if (yDiff < 16) {
              const textSim = diceSim(lineA.str, lineB.str);
              const spatialScore = 1.0 - (yDiff / 16);
              const score = textSim * 0.7 + spatialScore * 0.3;

              if (score > bestScore && (textSim > 0.2 || yDiff < 8)) {
                bestScore = score;
                bestIdx = i;
              }
            }
          }

          let strB = '';
          let lineB = null;
          let isOcrFallback = false;

          if (bestIdx >= 0) {
            lineB = linesB[bestIdx];
            strB = lineB.str;
            handledB.add(bestIdx);
          } else {
            // CASE 2: Native in A, Outlined in B. Run targeted OCR on B
            if (ocr) {
              const pad = 6;
              const { text, conf } = await ocrVectorRegion(fileB,
                Math.max(0, Math.floor(lineA.x) - pad), Math.max(0, Math.floor(lineA.y) - pad),
                Math.ceil(lineA.w) + pad * 2, Math.ceil(lineA.h) + pad * 2,
                false
              );
              if (conf >= M.ocrConf) {
                strB = text;
                isOcrFallback = true;
              }
            }
          }

          const strA = lineA.str;

          // If no text found in B at this location (or low similarity), search B for a shifted match!
          let foundShifted = false;
          if (!strB || diceSim(strA, strB) < 0.3) {
            // 1. Search in native B lines first
            const lbMatched = linesB.find(lb => 
              !handledB.has(linesB.indexOf(lb)) &&
              Math.abs(lineA.x - lb.x) < 150 &&
              Math.abs(lineA.y - lb.y) < 150 &&
              diceSim(strA, lb.str) === 1.0
            );

            if (lbMatched) {
              const bIdx = linesB.indexOf(lbMatched);
              handledB.add(bIdx);
              const dx = lbMatched.x - lineA.x;
              const dy = lbMatched.y - lineA.y;
              const dx_pt = Math.round(dx * R);
              const dy_pt = Math.round(dy * R);

              diffs.push({
                type: 'spacing_changed',
                severity: 'low',
                desc: `"${strA}" 컨테이너 그룹 이동됨(가로 ${dx_pt}pt, 세로 ${dy_pt}pt 이동, 내용물 일치)`,
                bbox: { x: lineA.x, y: lineA.y, width: lineA.w, height: lineA.h }
              });

              handled.push(rA);
              handled.push({ x: lbMatched.x, y: lbMatched.y, w: lbMatched.w, h: lbMatched.h });
              foundShifted = true;
            }

            if (!foundShifted && ocr) {
              // 2. Search in outlined regions of B
              const localRegions = regionsB_all.filter(r => 
                Math.abs(lineA.x - r.x) < 150 && 
                Math.abs(lineA.y - r.y) < 150 &&
                !overlapHandled({ x: r.x, y: r.y, w: r.w, h: r.h })
              );

              for (const rB of localRegions) {
                const pad = 4;
                const { text, conf } = await ocrVectorRegion(fileB, rB.x - pad, rB.y - pad, rB.w + pad * 2, rB.h + pad * 2, false);
                if (conf >= M.ocrConf && text.trim().length > 0) {
                  const processed = postProcess(text);
                  if (diceSim(strA, processed) >= M.textSim) {
                    const dx = rB.x - lineA.x;
                    const dy = rB.y - lineA.y;
                    const dx_pt = Math.round(dx * R);
                    const dy_pt = Math.round(dy * R);

                    diffs.push({
                      type: 'spacing_changed',
                      severity: 'low',
                desc: `"${strA}" 컨테이너 그룹 이동됨(가로 ${dx_pt}pt, 세로 ${dy_pt}pt 이동, 내용물 일치)`,
                      bbox: { x: lineA.x, y: lineA.y, width: lineA.w, height: lineA.h }
                    });

                    handled.push(rA);
                    handled.push({ x: rB.x, y: rB.y, w: rB.w, h: rB.h });
                    foundShifted = true;
                    break;
                  }
                }
              }
            }
          }

          if (foundShifted) continue;

          // If no text found in B at this location, it's a deletion
          if (!strB) {
            diffs.push({
              type: 'text_modified',
              severity: 'high',
              before: strA,
              desc: `"${strA}" 삭제됨`,
              bbox: { x: lineA.x, y: lineA.y, width: lineA.w, height: lineA.h },
              textInfo: {
                beforeStr: strA,
                afterStr: '',
                diffs: [[-1, strA]]
              }
            });
            handled.push(rA);
            continue;
          }

          const sim = diceSim(strA, strB);

          // Check for numeric differences (critical)
          const hasNum = /\d/.test(strA) || /\d/.test(strB);
          const numDiff = hasNum ? numericDiffers(strA, strB) : false;

          // Ignore Rules Engine: 
          // For OCR fallback, we allow fuzzy matching (M.textSim) to bypass OCR noise.
          // For Native Text, we require 100% character match (sim === 1.0) because any letter change is a deliberate edit!
          const requiredSim = (lineB && !isOcrFallback) ? 1.0 : M.textSim;

          if (sim >= requiredSim && !(hasNum && numDiff)) {
            if (lineB && !isOcrFallback) {
              // Both are Native Text. Compare bbox and font size!
              const sizeDiff = Math.abs(lineA.h - lineB.h) * R;
              const posDiffX = Math.abs(lineA.x - lineB.x) * R;
              const posDiffY = Math.abs(lineA.y - lineB.y) * R;

              if (sizeDiff > 1.5) { // Font size change > 1.5pt
                diffs.push({
                  type: 'style_changed',
                  severity: 'low',
                  desc: `"${lineA.str}" 글자 크기 변경(${Math.round(lineA.h * R)}pt → ${Math.round(lineB.h * R)}pt)`,
                  bbox: { x: lineA.x, y: lineA.y, width: lineA.w, height: lineA.h }
                });
              } else if (posDiffX > 3 || posDiffY > 3) { // Spacing/position shift
                diffs.push({
                  type: 'spacing_changed',
                  severity: 'low',
                desc: `"${strA}" 위치 미세 이동 (XΔ${Math.round(posDiffX)} YΔ${Math.round(posDiffY)} pt)`,
                  bbox: { x: lineA.x, y: lineA.y, width: lineA.w, height: lineA.h }
                });
              }
            }

            // If it matched via OCR fallback, it means outline-only differences! We ignore it under the Ignore Rules Engine.
            handled.push(rA);
            if (lineB) {
              handled.push({ x: lineB.x, y: lineB.y, w: lineB.w, h: lineB.h });
            }
            continue;
          }

          const type = numDiff || hasNum ? 'number_changed' : 'text_modified';
          const severity = numDiff ? 'critical' : hasNum ? 'critical' : 'high';

          // Perform character-level diffing using diffLib
          const diffParts = diffLib.diffChars(strA, strB);
          const diffsArray = diffParts.map(part => {
            const op = part.removed ? -1 : part.added ? 1 : 0;
            return [op, part.value];
          });

          diffs.push({
            type,
            severity,
            before: strA,
              desc: `"${strA}" ➔ "${strB}"${isOcrFallback ? ' (아웃라인)' : ''}`,
            bbox: { x: lineA.x, y: lineA.y, width: lineA.w, height: lineA.h },
            textInfo: {
              beforeStr: strA,
              afterStr: strB,
              diffs: diffsArray
            }
          });

          handled.push(rA);
          if (lineB) {
            handled.push({ x: lineB.x, y: lineB.y, w: lineB.w, h: lineB.h });
          }
        }

        // 2. CASE 2 (B has native, A has outlined): For un-matched lines in B, run targeted OCR on A
        for (let i = 0; i < linesB.length; i++) {
          if (handledB.has(i)) continue;
          const lineB = linesB[i];
          const rB = { x: lineB.x, y: lineB.y, w: lineB.w, h: lineB.h };
          if (overlapHandled(rB)) continue;

          let strA = '';
          let isOcrFallback = false;
          if (ocr) {
            const pad = 6;
            const { text, conf } = await ocrVectorRegion(fileA,
              Math.max(0, Math.floor(lineB.x) - pad), Math.max(0, Math.floor(lineB.y) - pad),
              Math.ceil(lineB.w) + pad * 2, Math.ceil(lineB.h) + pad * 2,
              true
            );
            if (conf >= M.ocrConf) {
              strA = text;
              isOcrFallback = true;
            }
          }

          if (!strA) {
            // Truly new text in B
            diffs.push({
              type: 'text_modified',
              severity: 'high',
              before: '',
              desc: `"${lineB.str}" 새로 추가됨`,
              bbox: { x: lineB.x, y: lineB.y, width: lineB.w, height: lineB.h },
              textInfo: {
                beforeStr: '',
                afterStr: lineB.str,
                diffs: [[1, lineB.str]]
              }
            });
            handled.push(rB);
            continue;
          }

          const sim = diceSim(strA, lineB.str);
          const hasNum = /\d/.test(strA) || /\d/.test(lineB.str);
          const numDiff = hasNum ? numericDiffers(strA, lineB.str) : false;

          if (sim >= M.textSim && !(hasNum && numDiff)) {
            // Outline converted, ignore
            handled.push(rB);
            continue;
          }


          const type = numDiff || hasNum ? 'number_changed' : 'text_modified';
          const severity = numDiff ? 'critical' : hasNum ? 'critical' : 'high';
          const diffParts = diffLib.diffChars(strA, lineB.str);
          const diffsArray = diffParts.map(part => [part.removed ? -1 : part.added ? 1 : 0, part.value]);

          diffs.push({
            type, severity,
            before: strA,
              desc: `"${strA}" ➔ "${lineB.str}"${isOcrFallback ? ' (아웃라인)' : ''}`,
            bbox: { x: lineB.x, y: lineB.y, width: lineB.w, height: lineB.h },
            textInfo: { beforeStr: strA, afterStr: lineB.str, diffs: diffsArray }
          });
          handled.push(rB);
        }

        const regionsA = detectTextRegions(imgA).filter(r => !overlapHandled({ x: r.x, y: r.y, w: r.w, h: r.h }));
        const regionsB = detectTextRegions(imgB).filter(r => !overlapHandled({ x: r.x, y: r.y, w: r.w, h: r.h }));
        const ocrLinesA = [];
        const ocrLinesB = [];

        if (ocr) {
          for (const r of regionsA) {
            const pad = 4;
            const { text, conf } = await ocrVectorRegion(fileA, r.x-pad, r.y-pad, r.w+pad*2, r.h+pad*2, true);
            if (conf >= M.ocrConf && text.trim().length > 0) {
              ocrLinesA.push({ str: postProcess(text), x: r.x, y: r.y, w: r.w, h: r.h });
            }
          }
          for (const r of regionsB) {
            const pad = 4;
            const { text, conf } = await ocrVectorRegion(fileB, r.x-pad, r.y-pad, r.w+pad*2, r.h+pad*2, false);
            if (conf >= M.ocrConf && text.trim().length > 0) {
              ocrLinesB.push({ str: postProcess(text), x: r.x, y: r.y, w: r.w, h: r.h });
            }
          }
        }

        const groupedOcrA = groupTextIntoLines(ocrLinesA);
        const groupedOcrB = groupTextIntoLines(ocrLinesB);
        const handledOcrB = new Set();

        for (const lineA of groupedOcrA) {
          const rA = { x: lineA.x, y: lineA.y, w: lineA.w, h: lineA.h };
          if (overlapHandled(rA)) continue;

          let bestIdx = -1;
          let bestScore = -1;
          for (let i = 0; i < groupedOcrB.length; i++) {
            if (handledOcrB.has(i)) continue;
            const lineB = groupedOcrB[i];
            const yDiff = Math.abs(lineA.y - lineB.y);
            if (yDiff < 16) {
              const textSim = diceSim(lineA.str, lineB.str);
              const spatialScore = 1.0 - (yDiff / 16);
              const score = textSim * 0.7 + spatialScore * 0.3;
              if (score > bestScore && (textSim > 0.2 || yDiff < 8)) {
                bestScore = score;
                bestIdx = i;
              }
            }
          }

          if (bestIdx >= 0) {
            const lineB = groupedOcrB[bestIdx];
            handledOcrB.add(bestIdx);
            const numDiff = numericDiffers(lineA.str, lineB.str);
            const hasNum = /\d/.test(lineA.str) || /\d/.test(lineB.str);

            if (diceSim(lineA.str, lineB.str) >= M.textSim && !(hasNum && numDiff)) {
              handled.push(rA);
              handled.push({ x: lineB.x, y: lineB.y, w: lineB.w, h: lineB.h });
              continue;
            }

            const type = numDiff || hasNum ? 'number_changed' : 'text_modified';
            const severity = numDiff ? 'critical' : hasNum ? 'critical' : 'high';
            const diffParts = diffLib.diffChars(lineA.str, lineB.str);
            const diffsArray = diffParts.map(part => [part.removed ? -1 : part.added ? 1 : 0, part.value]);

            diffs.push({
              type, severity,
              before: lineA.str,
              desc: `"${lineA.str}" ➔ "${lineB.str}" (아웃라인)`,
              bbox: { x: lineA.x, y: lineA.y, width: lineA.w, height: lineA.h },
              textInfo: { beforeStr: lineA.str, afterStr: lineB.str, diffs: diffsArray }
            });
            handled.push(rA);
            handled.push({ x: lineB.x, y: lineB.y, w: lineB.w, h: lineB.h });
          } else {
            diffs.push({
              type: 'text_modified', severity: 'high',
              before: lineA.str,
              desc: `"${lineA.str}" 삭제됨 (아웃라인)`,
              bbox: { x: lineA.x, y: lineA.y, width: lineA.w, height: lineA.h },
              textInfo: { beforeStr: lineA.str, afterStr: '', diffs: [[-1, lineA.str]] }
            });
            handled.push(rA);
          }
        }

        for (let i = 0; i < groupedOcrB.length; i++) {
          if (handledOcrB.has(i)) continue;
          const lineB = groupedOcrB[i];
          const rB = { x: lineB.x, y: lineB.y, w: lineB.w, h: lineB.h };
          if (overlapHandled(rB)) continue;
          diffs.push({
            type: 'text_modified', severity: 'high',
            before: '',
            desc: `"${lineB.str}" 새로 추가됨 (아웃라인)`,
            bbox: { x: lineB.x, y: lineB.y, width: lineB.w, height: lineB.h },
            textInfo: { beforeStr: '', afterStr: lineB.str, diffs: [[1, lineB.str]] }
          });
          handled.push(rB);
        }

        const tA_processed = [...tA, ...ocrLinesA];
        const tB_processed = [...tB, ...ocrLinesB];

        const geosA = detectGeo(imgA, M.minGeo, tA_processed, contentBoxA);
        const geosB = detectGeo(imgB, M.minGeo, tB_processed, contentBoxA);
        const usedB = new Set();

        for (const gA of geosA) {
          const rA = { x:gA.x,y:gA.y,w:gA.w,h:gA.h };
          if (overlapHandled(rA)) continue;

          let best=-1, bestV=0;
          for (let i=0; i<geosB.length; i++) {
            if (usedB.has(i)) continue;
            const v=iou(gA, geosB[i]);
            if (v>bestV){ bestV=v; best=i; }
          }

          const pdfBox = { x:gA.x,y:gA.y,width:gA.w,height:gA.h };

          if (best>=0 && bestV>0.18) {
            usedB.add(best);
            const gB=geosB[best];
            const dw=Math.abs(gA.w-gB.w)*R, dh=Math.abs(gA.h-gB.h)*R;
            const dx=Math.abs(gA.x-gB.x)*R, dy=Math.abs(gA.y-gB.y)*R;
            const visualDiff = pixDiffRatio(imgA.data, imgB.data, W, gA.x, gA.y, gA.w, gA.h);

            if (dw>M.geoTol||dh>M.geoTol) {
              const large = gA.w*R>150||gA.h*R>150;
              diffs.push({
                type:large?'layout_changed':'shape_resized',
                severity:large?'high':'medium',
                desc:`${gA.type==='rect'?'사각형':'도형'} 크기 변경 (가로Δ${Math.round(dw)} 세로Δ${Math.round(dh)} pt)`,
                bbox:pdfBox
              });
              handled.push(rA);
            } else if (dx>M.geoTol||dy>M.geoTol) {
              diffs.push({
                type:'spacing_changed', severity:'low',
                desc:`도형 위치 이동 (XΔ${Math.round(dx)} YΔ${Math.round(dy)} pt)`,
                bbox:pdfBox
              });
              handled.push(rA);
            } else if (gA.type !== gB.type) {
              diffs.push({
                type:'shape_modified', severity:'medium',
                desc:`도형 타입 변경 (${gA.type==='rect'?'사각형':'도형'} ➔ ${gB.type==='rect'?'사각형':'도형'})`,
                bbox:pdfBox
              });
              handled.push(rA);
            } else if (visualDiff > 0.03) {
              diffs.push({
                type:'shape_modified', severity:'medium',
                desc:'도형 색상/채우기/테두리 변경',
                bbox:pdfBox
              });
              handled.push(rA);
            } else {
              handled.push(rA);
            }
          } else if (best<0||bestV<0.05) {
            diffs.push({ type:'layout_changed', severity:'high', desc:'도형/블록 삭제됨', bbox:pdfBox });
            handled.push(rA);
          }
        }

        for (let i=0; i<geosB.length; i++) {
          if (usedB.has(i)) continue;
          const gB=geosB[i];
          const rB={x:gB.x,y:gB.y,w:gB.w,h:gB.h};
          if (overlapHandled(rB)) continue;
          diffs.push({ type:'layout_changed', severity:'high', desc:'새 도형/블록 추가됨',
            bbox:{x:gB.x,y:gB.y,width:gB.w,height:gB.h}
          });
          handled.push(rB);
        }

        const diffPng = new PNG({ width:W, height:H });
        const matchThresh = sensitivity === 'ultra' ? 0.01 : sensitivity === 'layout' ? 0.04 : 0.08;
        pixelmatch(imgA.data, imgB.data, diffPng.data, W, H, { threshold: matchThresh, alpha:0.5 });

        const G = sensitivity==='ultra'?10:18;
        const edgeStrip = 8;
        const useContentLimit = contentBoxA && contentBoxA.w > 0 && contentBoxA.h > 0;
        const minX = useContentLimit ? Math.max(edgeStrip, contentBoxA.x) : edgeStrip;
        const minY = useContentLimit ? Math.max(edgeStrip, contentBoxA.y) : edgeStrip;
        const maxX = useContentLimit ? Math.min(W - edgeStrip, contentBoxA.x + contentBoxA.w) : W - edgeStrip;
        const maxY = useContentLimit ? Math.min(H - edgeStrip, contentBoxA.y + contentBoxA.h) : H - edgeStrip;

        const cols = Math.ceil(W/G), rows = Math.ceil(H/G);
        const grid = new Uint8Array(cols*rows);

        for (let y=minY;y<maxY;y++)
          for (let x=minX;x<maxX;x++){
            const i=(y*W+x)*4;
            if(diffPng.data[i]===255&&diffPng.data[i+1]===0&&diffPng.data[i+2]===0)
              grid[Math.floor(y/G)*cols+Math.floor(x/G)]=1;
          }

        const vis = new Uint8Array(cols*rows);
        for (let r=0;r<rows;r++) {
          for (let c=0;c<cols;c++){
            if(!grid[r*cols+c]||vis[r*cols+c]) continue;
            let minC=c,maxC=c,minR=r,maxR=r;
            const q=[r*cols+c]; vis[r*cols+c]=1;
            while(q.length){
              const cur=q.pop(),cr=Math.floor(cur/cols),cc=cur%cols;
              if(cc<minC)minC=cc;if(cc>maxC)maxC=cc;if(cr<minR)minR=cr;if(cr>maxR)maxR=cr;
              for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
                const nr=cr+dr,nc=cc+dc;
                if(nr>=0&&nr<rows&&nc>=0&&nc<cols&&grid[nr*cols+nc]&&!vis[nr*cols+nc])
                  {vis[nr*cols+nc]=1;q.push(nr*cols+nc);}
              }
            }
            const bx=minC*G,by=minR*G,bw=(maxC-minC+1)*G,bh=(maxR-minR+1)*G;
            if(bw<2||bh<2) continue;
            // Intentionally NOT calling overlapHandled() — background colour
            // changes share the same bbox as already-handled text.
            const dr=pixDiffRatio(imgA.data,imgB.data,W,bx,by,bw,bh);
            // Skip pure anti-aliasing edge noise (pixel change density < 1.5%)
            if(dr<0.015) continue;
            diffs.push({
              type:'design_changed', severity:'low',
              desc:`이미지/아이콘 변경 (${Math.round(bw)}×${Math.round(bh)} px, Δ${Math.round(dr*100)}%)`,
              bbox:{x:bx,y:by,width:bw,height:bh}
            });
      }
      }
    }

      if (hasA) {
        base64A = imgA ? PNG.sync.write(imgA).toString('base64') : fs.readFileSync(pA).toString('base64');
      }
      if (hasB) {
        base64B = imgB ? PNG.sync.write(imgB).toString('base64') : fs.readFileSync(pB).toString('base64');
      }
      results.push({
        page: p,
        diffs,
        base64A,
        base64B,
        normalization: (hasA && hasB) ? {
          boxesA,
          boxesB,
          contentBoxA,
          contentBoxB,
          scaleX: s_x,
          scaleY: s_y,
          offsetX: t_x,
          offsetY: t_y
        } : null
      });
      try { if(hasA) fs.unlinkSync(pA); } catch(_){}
      try { if(hasB) fs.unlinkSync(pB); } catch(_){}
    }

    try{ fs.rmdirSync(tempDir); }catch(_){}
    parentPort.postMessage({ success:true, results });

  } catch(err) {
    try{ fs.rmdirSync(tempDir,{recursive:true}); }catch(_){}
    parentPort.postMessage({ success:false, error:err.stack });
  } finally {
    if (_ocrWorker) {
      try {
        await _ocrWorker.terminate();
        console.log('[Worker] Tesseract OCR worker terminated successfully.');
      } catch (_) {}
      _ocrWorker = null;
    }
  }
}

run();
