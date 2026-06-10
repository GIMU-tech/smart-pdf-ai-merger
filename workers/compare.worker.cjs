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

// -----------------------------------------------------------------------------
// UTILITIES
// -----------------------------------------------------------------------------

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
function numericTokens(s) {
  return (String(s || '').match(/[-+]?\d[\d,]*(?:\.\d+)?/g) || [])
    .map(n => Number(n.replace(/,/g, '')))
    .filter(n => Number.isFinite(n));
}

function numericDiffers(a, b) {
  const numsA = numericTokens(a);
  const numsB = numericTokens(b);
  if (numsA.length !== numsB.length) return true;
  return numsA.some((v,i) => Math.abs(v - numsB[i]) > 1e-6);
}

function compactText(s) {
  return (s || '').replace(/\s+/g, '').toUpperCase();
}

function isSpecLikeText(s) {
  return /(PRICE|AMOUNT|TOTAL|QTY|SIZE|SPEC|DIM|WIDTH|HEIGHT|LENGTH|N\.?W|G\.?W|KG|KGS|G|MM|CM|M\b|EA|PCS|규격|치수|중량|무게|수량|가격|\d+[X*]\d+)/i.test(String(s || ''));
}

function isCodeLikeText(s) {
  if (isSpecLikeText(s)) return false;
  const compact = compactText(s);
  return compact.length >= 5 &&
    /[A-Z]/.test(compact) &&
    /\d/.test(compact) &&
    (/(MODEL|SKU|ITEM|CODE|품번|모델|제품|상품)/i.test(String(s || '')) || /^[A-Z]{1,6}[-_]?\d{3,}[A-Z0-9-]*$/i.test(compact));
}

function normalizedSemanticText(s) {
  return String(s || '')
    .replace(/\uFFFD/g, ' ')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function semanticKey(s) {
  return normalizedSemanticText(s)
    .toUpperCase()
    .replace(/[：]/g, ':')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripNumbers(s) {
  return semanticKey(s)
    .replace(/[-+]?\d[\d,]*(?:\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSemanticLabelValue(s) {
  const key = semanticKey(s);
  const colon = key.match(/^([^:]{1,32}):\s*(.+)$/);
  if (colon) return { label: colon[1].trim(), value: colon[2].trim() };

  const firstNumber = key.search(/[-+]?\d/);
  if (firstNumber > 0) {
    return {
      label: key.slice(0, firstNumber).replace(/[-:：/]+$/g, '').trim(),
      value: key.slice(firstNumber).trim()
    };
  }

  const parts = key.split(/\s+/);
  if (parts.length >= 2) {
    return { label: parts[0], value: parts.slice(1).join(' ') };
  }
  return { label: key, value: '' };
}

function labelCompatible(a, b) {
  const la = splitSemanticLabelValue(a).label;
  const lb = splitSemanticLabelValue(b).label;
  if (!la || !lb) return false;
  if (la === lb) return true;
  return diceSim(la, lb) >= 0.92;
}

function textMatchScore(a, b) {
  const aa = semanticKey(a);
  const bb = semanticKey(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;

  const base = Math.max(diceSim(aa, bb), diceSim(compactText(aa), compactText(bb)));
  const sameLabel = labelCompatible(aa, bb);
  if (sameLabel) return Math.max(base, 0.985);

  const patternA = stripNumbers(aa);
  const patternB = stripNumbers(bb);
  if (patternA && patternA === patternB && numericTokens(aa).length && numericTokens(bb).length) {
    return Math.max(base, 0.98);
  }

  return base;
}

function shouldMatchText(a, b, threshold) {
  if (textMatchScore(a, b) >= threshold) return true;
  if (labelCompatible(a, b) && (numericTokens(a).length || numericTokens(b).length)) return true;
  return false;
}

function diffTypeForText(before, after) {
  if (isCodeLikeText(before) || isCodeLikeText(after)) {
    return { type: 'code_changed', severity: 'critical' };
  }
  if (numericTokens(before).length || numericTokens(after).length) {
    if (numericDiffers(before, after)) {
      return { type: 'number_changed', severity: 'critical' };
    }
  }
  return { type: 'text_modified', severity: 'high' };
}

// Post-process OCR text: fix common OCR errors, trim junk
function postProcess(raw) {
  return raw
    .replace(/\uFFFD/g, ' ')
    .trim()
    .replace(/[|]{1}/g, 'I')          // pipe to I
    .replace(/0(?=[a-zA-Z])/g,'O')    // 0 to O before letters
    .replace(/(?<=[a-zA-Z])0/g,'O')   // 0 to O after letters
    .replace(/[^\x20-\x7E\uAC00-\uD7A3\u3131-\u314E\u314F-\u3163\uFF00-\uFFEF]/g,' ')
    .replace(/\s{2,}/g,' ')
    .trim();
}

function unionBbox(items) {
  const boxes = items.map(item => item.bbox).filter(Boolean);
  if (!boxes.length) return { x: 0, y: 0, width: 1, height: 1 };
  const minX = Math.min(...boxes.map(b => b.x));
  const minY = Math.min(...boxes.map(b => b.y));
  const maxX = Math.max(...boxes.map(b => b.x + b.width));
  const maxY = Math.max(...boxes.map(b => b.y + b.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function reviewCategoryForText(before, after) {
  const text = `${before || ''} ${after || ''}`;
  const compact = compactText(text);
  if (/LE\d{4,}|RY\d{4,}|L\d{3,}|\d{7,}/i.test(compact)) return {
    category: 'identity',
    severity: 'critical',
    title: '제품 코드/모델명 변경',
  };
  if (/(N\.?W|G\.?W|KG|KGS|MM|CM|\d+[X*]\d+|\b350\b|\b600\b)/i.test(compact)) return {
    category: 'spec',
    severity: 'critical',
    title: '규격/치수/중량 변경',
  };
  if (/(주의|경고|반품|교환|조립|반드시|확인|WARNING|CAUTION)/i.test(text)) return {
    category: 'warning',
    severity: 'high',
    title: '주의/안내 문구 변경',
  };
  return {
    category: 'text',
    severity: 'high',
    title: '문구 변경',
  };
}

function reviewCategoryForText(before, after) {
  const text = `${before || ''} ${after || ''}`;
  const compact = compactText(text);
  if (isSpecLikeText(text) || isSpecLikeText(compact)) {
    return {
      category: 'spec',
      severity: 'critical',
      title: '규격/치수/중량/수량 변경',
    };
  }
  if (/(MODEL|SKU|ITEM|CODE|품번|모델|제품|상품)/i.test(text) ||
      /[A-Z]{1,6}[-_]?\d{3,}[A-Z0-9-]*/i.test(compact) ||
      /\d{7,}/i.test(compact)) {
    return {
      category: 'identity',
      severity: 'critical',
      title: '제품 코드/모델명 변경',
    };
  }
  if (/(주의|경고|반품|교환|조립|반드시|확인|WARNING|CAUTION|NOTICE|DANGER)/i.test(text)) {
    return {
      category: 'warning',
      severity: 'high',
      title: '주의/안내 문구 변경',
    };
  }
  return {
    category: 'text',
    severity: 'high',
    title: '문구 변경',
  };
}

function bboxToRect(bbox) {
  if (!bbox) return { x: 0, y: 0, w: 1, h: 1 };
  return {
    x: bbox.x || 0,
    y: bbox.y || 0,
    w: bbox.width || bbox.w || 1,
    h: bbox.height || bbox.h || 1
  };
}

function rectArea(rect) {
  return Math.max(1, rect.w) * Math.max(1, rect.h);
}

function unionRect(a, b) {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) };
}

function rectToBbox(rect) {
  return { x: rect.x, y: rect.y, width: rect.w, height: rect.h };
}

function rectGap(a, b) {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return Math.sqrt(dx * dx + dy * dy);
}

function rectOverlapRatio(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return overlap / Math.max(1, Math.min(rectArea(a), rectArea(b)));
}

function clusterDiffsByRegion(items, pageSize, options = {}) {
  const maxGap = options.maxGap ?? Math.max(36, Math.min(pageSize.width, pageSize.height) * 0.035);
  const maxClusterAreaRatio = options.maxClusterAreaRatio ?? 0.18;
  const maxClusterWidthRatio = options.maxClusterWidthRatio ?? 0.7;
  const maxClusterHeightRatio = options.maxClusterHeightRatio ?? 0.34;

  const seeds = items
    .map(item => ({ ...item, rect: bboxToRect(item.diff.bbox) }))
    .filter(item => rectArea(item.rect) >= (options.minArea ?? 80));

  const clusters = [];
  for (const seed of seeds) {
    let best = null;
    let bestGap = Infinity;
    for (const cluster of clusters) {
      const gap = rectGap(cluster.rect, seed.rect);
      const merged = unionRect(cluster.rect, seed.rect);
      const tooWide = merged.w > pageSize.width * maxClusterWidthRatio;
      const tooTall = merged.h > pageSize.height * maxClusterHeightRatio;
      const tooLarge = rectArea(merged) > pageSize.width * pageSize.height * maxClusterAreaRatio;
      if (gap <= maxGap && !tooWide && !tooTall && !tooLarge && gap < bestGap) {
        best = cluster;
        bestGap = gap;
      }
    }

    if (!best) {
      clusters.push({ rect: seed.rect, items: [seed] });
    } else {
      best.rect = unionRect(best.rect, seed.rect);
      best.items.push(seed);
    }
  }

  // If many small regions line up in separate instruction panels, keep them as
  // separate review targets instead of melting the entire row into one card.
  return clusters
    .map(cluster => ({
      ...cluster,
      rect: rectToBbox(cluster.rect),
      score: cluster.items.length * 10000 + rectArea(cluster.rect)
    }))
    .sort((a, b) => b.score - a.score);
}

function buildHumanReviewSummary(page, diffs, pageSize, normalization) {
  const reviewItems = [];
  const textReviewBoxes = [];
  let id = 1;
  const addItem = (item) => {
    reviewItems.push({
      id: `p${page}-r${id++}`,
      confidence: item.confidence ?? 0.75,
      relatedDiffs: item.relatedDiffs || [],
      ...item
    });
  };

  const textGroups = new Map();
  const cleanCandidate = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const joinCandidates = (values) => [...new Set(values.map(cleanCandidate).filter(Boolean))]
    .slice(0, 6)
    .join(' / ');

  diffs.forEach((diff, idx) => {
    if (!diff.textInfo) return;
    const before = diff.textInfo.beforeStr || diff.before || '';
    const after = diff.textInfo.afterStr || '';
    const info = reviewCategoryForText(before, after);
    const labelA = splitSemanticLabelValue(before).label;
    const labelB = splitSemanticLabelValue(after).label;
    const semanticLabel = labelA || labelB || stripNumbers(before || after).slice(0, 48);
    const key = `${info.category}:${info.title}:${semanticLabel}`;
    if (!textGroups.has(key)) {
      textGroups.set(key, {
        ...info,
        beforeValues: [],
        afterValues: [],
        boxes: [],
        relatedDiffs: [],
        confidence: diff.type === 'number_changed' ? 0.92 : 0.82
      });
    }
    const group = textGroups.get(key);
    if (before) group.beforeValues.push(before);
    if (after) group.afterValues.push(after);
    if (diff.bbox) group.boxes.push({ bbox: diff.bbox });
    group.relatedDiffs.push(idx);
    group.confidence = Math.max(group.confidence, diff.type === 'number_changed' ? 0.92 : 0.82);
  });

  for (const group of textGroups.values()) {
    const before = joinCandidates(group.beforeValues);
    const after = joinCandidates(group.afterValues);
    const desc = before && after
      ? `${group.title} 후보가 변경되었습니다.`
      : (after ? `새 ${group.title} 후보가 추가되었습니다.` : `${group.title} 후보가 삭제되었습니다.`);

    addItem({
      category: group.category,
      severity: group.severity,
      title: group.title,
      before,
      after,
      desc: before && after
        ? `${group.title} 정보가 변경되었습니다.`
        : (after ? `${group.title} 정보가 추가되었습니다.` : `${group.title} 정보가 삭제되었습니다.`),
      bbox: unionBbox(group.boxes),
      relatedDiffs: group.relatedDiffs,
      confidence: group.confidence
    });
    textReviewBoxes.push(bboxToRect(unionBbox(group.boxes)));
  }

  const visualDiffs = diffs
    .map((diff, idx) => ({ diff, idx }))
    .filter(({ diff }) => ['layout_changed', 'shape_resized', 'shape_modified', 'design_changed'].includes(diff.type));
  const detailedVisualDiffs = visualDiffs.filter(({ diff }) => {
    const rect = bboxToRect(diff.bbox);
    const areaRatio = rectArea(rect) / Math.max(1, pageSize.width * pageSize.height);
    if (areaRatio > 0.08) return false;
    if (['shape_modified', 'layout_changed'].includes(diff.type) && areaRatio > 0.08) return false;
    return true;
  });
  const movedDiffs = diffs
    .map((diff, idx) => ({ diff, idx }))
    .filter(({ diff }) => diff.type === 'block_moved');
  const spacingDiffs = diffs
    .map((diff, idx) => ({ diff, idx }))
    .filter(({ diff }) => diff.type === 'spacing_changed');

  if (visualDiffs.length >= 3) {
    const clusteringSource = detailedVisualDiffs.length >= 3 ? detailedVisualDiffs : visualDiffs;
    const allVisualClusters = clusterDiffsByRegion(clusteringSource, pageSize)
      .filter(cluster => cluster.items.length >= 2 || rectArea(bboxToRect(cluster.rect)) > 900);
    const visualClusters = allVisualClusters
      .filter(cluster => {
        const rect = bboxToRect(cluster.rect);
        return !textReviewBoxes.some(textRect =>
          rectOverlapRatio(rect, textRect) > 0.15 || rectGap(rect, textRect) < 24
        );
      })
      .sort((a, b) => {
        const ar = bboxToRect(a.rect);
        const br = bboxToRect(b.rect);
        return (b.items.length * 10000 + Math.min(rectArea(br), pageSize.width * pageSize.height * 0.08)) -
               (a.items.length * 10000 + Math.min(rectArea(ar), pageSize.width * pageSize.height * 0.08));
      });
    let primaryVisualClusters = visualClusters.slice(0, 16);
    let remainingVisualClusters = visualClusters.slice(16);
    if (primaryVisualClusters.length > 1) {
      const mergedRect = primaryVisualClusters
        .map(cluster => bboxToRect(cluster.rect))
        .reduce((acc, rect) => acc ? unionRect(acc, rect) : rect, null);
      const mergedAreaRatio = mergedRect
        ? rectArea(mergedRect) / Math.max(1, pageSize.width * pageSize.height)
        : 1;
      const mergedItemCount = primaryVisualClusters.reduce((sum, cluster) => sum + cluster.items.length, 0);
      if (mergedRect && (mergedAreaRatio <= 0.12 || (primaryVisualClusters.length <= 4 && mergedItemCount <= 10))) {
        primaryVisualClusters = [{
          rect: rectToBbox(mergedRect),
          items: primaryVisualClusters.flatMap(cluster => cluster.items),
          score: primaryVisualClusters.reduce((sum, cluster) => sum + cluster.score, 0)
        }];
        remainingVisualClusters = visualClusters.slice(16);
      }
    }

    primaryVisualClusters.forEach((cluster, clusterIdx) => {
      const relatedDiffs = cluster.items.map(x => x.idx);
      const itemCount = relatedDiffs.length;
      addItem({
        category: 'drawing',
        severity: itemCount >= 8 ? 'high' : 'medium',
        title: primaryVisualClusters.length === 1 ? '도면 변경' : `도면 변경 ${clusterIdx + 1}`,
        desc: itemCount >= 2
          ? `가까운 도면/이미지 변화 ${itemCount}건을 하나의 확인 지점으로 표시했습니다. PDF 위의 빨간 박스 위치를 원본과 수정본에서 바로 대조하세요.`
          : '도면/이미지 안에서 실제 픽셀 변화가 감지된 위치입니다. PDF 위의 빨간 박스를 바로 확인하세요.',
        bbox: cluster.rect,
        relatedDiffs,
        confidence: 0.78
      });
    });

    remainingVisualClusters.slice(0, 6).forEach((cluster, clusterIdx) => {
      const relatedDiffs = cluster.items.map(x => x.idx);
      addItem({
        category: 'drawing',
        severity: 'low',
        title: `추가 도면 변화 후보 ${clusterIdx + 1}`,
        desc: `작거나 반복적인 도면 변화 후보 ${relatedDiffs.length}건입니다. 주요 변경을 확인한 뒤 참고로 보세요.`,
        bbox: cluster.rect,
        relatedDiffs,
        confidence: 0.58
      });
    });
  } else {
    visualDiffs.forEach(({ diff, idx }) => addItem({
      category: 'drawing',
      severity: diff.severity === 'high' ? 'medium' : 'low',
      title: diff.type === 'shape_resized' ? '도형 크기 변경' : '도형/이미지 변경',
      desc: diff.desc || '시각 요소 변경 후보입니다.',
      bbox: diff.bbox,
      relatedDiffs: [idx],
      confidence: 0.62
    }));
  }

  if (movedDiffs.length) {
    const relatedDiffs = movedDiffs.map(x => x.idx);
    const bbox = unionBbox(movedDiffs.map(x => x.diff));
    addItem({
      category: 'layout',
      severity: 'low',
      title: '블록 위치 이동',
      desc: `같거나 유사한 컨텐츠 블록 위치 이동 ${movedDiffs.length}건입니다. 제품 규격 차이로 인한 정상 변경일 수 있습니다.`,
      bbox,
      relatedDiffs,
      confidence: 0.68
    });
  }

  if (spacingDiffs.length || (normalization && (Math.abs(normalization.offsetX || 0) > 2 || Math.abs(normalization.offsetY || 0) > 2))) {
    const relatedDiffs = spacingDiffs.map(x => x.idx);
    const bbox = spacingDiffs.length ? unionBbox(spacingDiffs.map(x => x.diff)) : { x: 0, y: 0, width: pageSize.width, height: 24 };
    addItem({
      category: 'layout',
      severity: 'low',
      title: '페이지/대지 위치 이동',
      desc: '전체 대지 또는 주요 컨텐츠가 기준 위치에서 이동했습니다. 세부 도형 차이는 참고용으로 접어두는 것이 좋습니다.',
      bbox,
      relatedDiffs,
      confidence: 0.7
    });
  }

  const priority = { critical: 0, high: 1, medium: 2, low: 3 };
  reviewItems.sort((a, b) => (priority[a.severity] ?? 9) - (priority[b.severity] ?? 9));

  const counts = reviewItems.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});
  const pageSummary = reviewItems.length === 0
    ? '변경 없음'
    : [
        counts.identity ? '제품 식별 정보' : '',
        counts.spec ? '규격/치수/중량' : '',
        counts.warning ? '주의 문구' : '',
        counts.text ? '문구' : '',
        counts.drawing ? '도면/일러스트' : '',
        counts.layout ? '레이아웃 참고' : ''
      ].filter(Boolean).join(', ') + ' 변경';

  return { reviewItems, pageSummary };
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

// Check if a PNG image is completely blank/white (for super-fast OCR skipping)
function isImageBlank(png) {
  if (!png) return true;
  const data = png.data;
  const len = data.length;
  // Check every 4th pixel (step by 16 bytes) for high performance scanning
  for (let i = 0; i < len; i += 16) {
    if (data[i] < 250 || data[i+1] < 250 || data[i+2] < 250) {
      return false;
    }
  }
  return true;
}

// -----------------------------------------------------------------------------
// OCR PIPELINE

// -----------------------------------------------------------------------------

let _ocrWorker = null;
let _ocrUnavailableReason = null;

function isUsableTrainedData(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < 1024 * 1024) return false;
    const head = fs.readFileSync(filePath, { encoding: 'utf8', flag: 'r' }).slice(0, 80);
    return !head.startsWith('version https://git-lfs.github.com/spec/');
  } catch (_) {
    return false;
  }
}

function hasUsableOcrData(langPath) {
  return isUsableTrainedData(path.join(langPath, 'kor.traineddata')) &&
    isUsableTrainedData(path.join(langPath, 'eng.traineddata'));
}

async function getOCRWorker() {
  if (_ocrUnavailableReason) return null;
  if (!_ocrWorker) {
    const localLangPath = path.join(__dirname, '..');
    if (!hasUsableOcrData(localLangPath)) {
      _ocrUnavailableReason = `OCR traineddata is missing or not downloaded from Git LFS: ${localLangPath}`;
      console.warn(`[Worker] ${_ocrUnavailableReason}`);
      return null;
    }
    try {
      _ocrWorker = await createWorker('kor+eng', OEM.LSTM_ONLY, {
        langPath: localLangPath,
        cachePath: localLangPath,
        gzip: false
      });
    } catch (err) {
      _ocrUnavailableReason = err?.message || 'OCR worker failed to initialize';
      console.warn(`[Worker] OCR disabled: ${_ocrUnavailableReason}`);
      _ocrWorker = null;
      return null;
    }
  }
  return _ocrWorker;
}

async function resetOCRWorker() {
  if (_ocrWorker) {
    try { await _ocrWorker.terminate(); } catch (_) {}
    _ocrWorker = null;
  }
}


// -----------------------------------------------------------------------------
// GEOMETRY DETECTION (OpenCV)
// -----------------------------------------------------------------------------

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
          const ix2 = Math.min(r.x + r.width, t.x + t.w);
          const iy2 = Math.min(r.y + r.height, t.y + t.h);
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

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

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

function clampBox(box, width, height, pad = 0) {
  const x = Math.max(0, Math.floor(box.x - pad));
  const y = Math.max(0, Math.floor(box.y - pad));
  const x2 = Math.min(width, Math.ceil(box.x + box.w + pad));
  const y2 = Math.min(height, Math.ceil(box.y + box.h + pad));
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

function pastePng(src, dst, dx = 0, dy = 0) {
  if (!src || !dst) return;
  for (let y = 0; y < src.height; y++) {
    const targetY = y + dy;
    if (targetY < 0 || targetY >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const targetX = x + dx;
      if (targetX < 0 || targetX >= dst.width) continue;
      const si = (y * src.width + x) * 4;
      const di = (targetY * dst.width + targetX) * 4;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
}

function whitePng(width, height) {
  const png = new PNG({ width, height });
  png.data.fill(255);
  return png;
}

function localDiffRatio(pngA, pngB, boxA, boxB, pad = 2) {
  const a = clampBox(boxA, pngA.width, pngA.height, pad);
  const b = clampBox(boxB, pngB.width, pngB.height, pad);
  if (a.w <= 0 || a.h <= 0 || b.w <= 0 || b.h <= 0) return 1;

  const cropA = cropRegion(pngA, a.x, a.y, a.w, a.h);
  const cropB = cropRegion(pngB, b.x, b.y, b.w, b.h);
  const w = Math.max(cropA?.width || 0, cropB?.width || 0);
  const h = Math.max(cropA?.height || 0, cropB?.height || 0);
  if (w <= 0 || h <= 0) return 0;

  const canvasA = whitePng(w, h);
  const canvasB = whitePng(w, h);
  pastePng(cropA, canvasA);
  pastePng(cropB, canvasB);
  return pixDiffRatio(canvasA.data, canvasB.data, w, 0, 0, w, h);
}

function sampledDiffRatio(dA, dB, W, x, y, w, h, step = 4) {
  let changed = 0;
  let total = 0;
  for (let row = y; row < y + h; row += step) {
    for (let col = x; col < x + w; col += step) {
      const i = (row * W + col) * 4;
      if (Math.abs(dA[i] - dB[i]) > 22 || Math.abs(dA[i + 1] - dB[i + 1]) > 22 || Math.abs(dA[i + 2] - dB[i + 2]) > 22) {
        changed++;
      }
      total++;
    }
  }
  return total > 0 ? changed / total : 0;
}

// -----------------------------------------------------------------------------
// MAIN PIPELINE
// -----------------------------------------------------------------------------

async function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfdiff-'));
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs').catch(()=>require('pdfjs-dist/legacy/build/pdf.js'));
    const { default: pixelmatch } = await import('pixelmatch');
    const { fileA, fileB, gsPath, gsLibPath, sensitivity } = workerData;
    if (!gsPath || (path.isAbsolute(gsPath) && !fs.existsSync(gsPath))) {
      throw new Error(`Ghostscript executable not found: ${gsPath || '(empty)'}`);
    }

    // Load PDF-lib Documents for page boxes extraction
    let pdfDocA = null, pdfDocB = null;
    try { pdfDocA = await PDFDocument.load(fs.readFileSync(fileA)); } catch(e) {}
    try { pdfDocB = await PDFDocument.load(fs.readFileSync(fileB)); } catch(e) {}

    // OCR Vector supersampling re-renderer helper using Ghostscript
    function renderVectorRegion(filePath, p, x_pdf, y_pdf, w_pt, h_pt, targetDPI, outPath) {
      return new Promise((res, rej) => {
        execFile(gsPath, [
          gsLibPath ? '-I' + gsLibPath : null, '-dSAFER', '-dBATCH', '-dNOPAUSE',
          '-sDEVICE=png16m', `-r${targetDPI}`,
          `-dFirstPage=${p}`, `-dLastPage=${p}`,
          `-dDEVICEWIDTHPOINTS=${w_pt}`,
          `-dDEVICEHEIGHTPOINTS=${h_pt}`,
          '-dUseCropBox',
          '-dFIXEDMEDIA',
          '-c', `<</PageOffset [-${x_pdf} -${y_pdf}]>> setpagedevice`,
          `-sOutputFile=${outPath}`, filePath
        ].filter(Boolean), err => err ? rej(err) : res());
      });
    }

    // ?? Mode configuration ??????????????????????????????????????????????????
    // DPI: 150 for default/layout (excellent speed + accurate OCR), 300 for ultra (ultra precision)
    // Parse numeric precision or legacy string mode
    let precision = 80;
    if (sensitivity) {
      if (!isNaN(sensitivity)) {
        precision = Math.max(1, Math.min(100, parseInt(sensitivity, 10)));
      } else if (sensitivity === 'ultra') {
        precision = 95;
      } else if (sensitivity === 'layout') {
        precision = 40;
      }
    }

    // Set DPI based on precision, but cap it for very large/long PDFs.
    // 100% mode previously forced 300DPI, which can explode memory on long print/artboard PDFs.
    function getMaxPageAreaPt(pdfDoc) {
      if (!pdfDoc) return 0;
      try {
        let maxArea = 0;
        for (const page of pdfDoc.getPages()) {
          const box = page.getCropBox ? page.getCropBox() : page.getMediaBox();
          const w = Math.max(1, box.width || 0);
          const h = Math.max(1, box.height || 0);
          maxArea = Math.max(maxArea, w * h);
        }
        return maxArea;
      } catch (_) {
        return 0;
      }
    }

    const requestedDPI = precision >= 90 ? 300 : 150;
    const maxRenderPixels = precision >= 90 ? 14000000 : 9000000;
    const maxPageAreaPt = Math.max(getMaxPageAreaPt(pdfDocA), getMaxPageAreaPt(pdfDocB));
    let DPI = requestedDPI;
    if (maxPageAreaPt > 0) {
      const capped = Math.floor(Math.sqrt((maxRenderPixels * 72 * 72) / maxPageAreaPt));
      DPI = Math.max(96, Math.min(requestedDPI, capped));
    }

    const R   = 72 / DPI; // px to PDF pt

    const p = precision / 100.0;
    
    // Smooth interpolations for all detection parameters (1% - 100%)
    const pxPerPt = DPI / 72;
    const minGeoPt = Math.max(0.5, 4.0 - 3.5 * p);
    const minGeo = Math.max(1, Math.round(minGeoPt * pxPerPt));
    const geoTol = Math.max(0.05, parseFloat((5.0 - 4.95 * p).toFixed(3)));
    const textSim = Math.max(0.85, parseFloat((0.85 + 0.14 * p).toFixed(3)));
    const visTol = Math.max(0.001, parseFloat((0.1 - 0.099 * p).toFixed(4)));
    const ocrConf = Math.max(25, Math.round(70 - 45 * p));
    const minVisualPx = Math.max(2, Math.round((precision >= 90 ? 0.45 : 0.8) * pxPerPt));
    const minVisualAreaPx = Math.max(9, minVisualPx * minVisualPx);
    const minVisualDensity = precision >= 90 ? 0.01 : 0.018;
    const pageEdgePx = Math.max(4, Math.round(2 * pxPerPt));

    const M = { minGeo, geoTol, textSim, visTol, ocrConf, minVisualPx, minVisualAreaPx, minVisualDensity, pageEdgePx };

    // ⚙⚙ Initialise OCR ⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙
    // Will be lazily initialized if a page contains no native text

    // ⚙⚙ Extract native text ⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙⚙
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
      const cores = Math.min(4, os.cpus().length || 1);
      return new Promise((res, rej) =>
        execFile(gsPath, [
          gsLibPath ? '-I' + gsLibPath : null, '-dSAFER', '-dBATCH', '-dNOPAUSE',
          '-sDEVICE=png16m', `-r${DPI}`,
          '-dUseCropBox',
          `-dNumRenderingThreads=${cores}`,
          '-dBufferSpace=1000000000', // 1GB buffer space for speed
          `-sOutputFile=${outPattern}`, filePath
        ].filter(Boolean), err => err ? rej(err) : res())
      );
    }

    function renderOcrPage(filePath, pageNum, outPath, ocrDpi) {
      return new Promise((res, rej) =>
        execFile(gsPath, [
          gsLibPath ? '-I' + gsLibPath : null, '-dSAFER', '-dBATCH', '-dNOPAUSE',
          '-sDEVICE=png16m', `-r${ocrDpi}`,
          '-dUseCropBox',
          `-dFirstPage=${pageNum}`, `-dLastPage=${pageNum}`,
          `-sOutputFile=${outPath}`, filePath
        ].filter(Boolean), err => err ? rej(err) : res())
      );
    }

    const [nativeA, nativeB] = await Promise.all([getNativeText(fileA), getNativeText(fileB)]);
    const maxPages = Math.max(nativeA.length, nativeB.length);
    const results  = [];

    // Render sequentially to avoid memory spikes in 95~100% mode.
    // Concurrent Ghostscript rendering was fast, but it could crash the worker on long/high-DPI PDFs.
    try {
      await renderAllPNGs(fileA, path.join(tempDir, 'a%d.png'));
      await renderAllPNGs(fileB, path.join(tempDir, 'b%d.png'));
    } catch (e) {
      console.error('[Worker] Error rendering PDFs:', e);
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
      let origDataA = null, origDataB = null;

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
        const affineM = cv.matFromArray(2, 3, cv.CV_64F, [s_x, 0, t_x, 0, s_y, t_y]);
        const dstB = new cv.Mat();
        const dsize = new cv.Size(rawA.width, rawA.height);
        
        cv.warpAffine(srcB, dstB, affineM, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));

        imgA = rawA;
        imgB = new PNG({ width: rawA.width, height: rawA.height });
        imgB.data.set(dstB.data);

        srcB.delete(); affineM.delete(); dstB.delete();

        const W = imgA.width;
        const H = imgA.height;
        
        // Apply affine translation & scaling to Document B's native text coordinates
        const tB = tB_orig.map(item => ({
          ...item,
          x: s_x * item.x + t_x,
          y: s_y * item.y + t_y,
          w: s_x * item.w,
          h: s_y * item.h
        }));

        const ocrLinesA = [];
        const ocrLinesB = [];

        async function recognizeHighResOcrPage(filePath, nativeCount, side, mapBox) {
          const sourceForBlankCheck = side === 'A' ? rawA : imgB;
          // Allow OCR even when native text exists because outlined/vector text may coexist.
          // Only skip OCR on pages already extremely text-dense.
          if (nativeCount > 120 || isImageBlank(sourceForBlankCheck)) return [];

          const basePixels = sourceForBlankCheck.width * sourceForBlankCheck.height;
          const maxOcrPixels = precision >= 90 ? 10000000 : 8000000;
          const preferredDpis = precision >= 90 ? [300, 240, 220, 180, 150] : [300, 220, 180, 150, 120];
          const dpis = [...new Set(preferredDpis)];

          async function ocrImagePath(imagePath, scaleToBase, offsetX = 0, offsetY = 0) {
            const ocr = await getOCRWorker().catch(() => null);
            if (!ocr) return [];

            await ocr.setParameters({
              tessedit_pageseg_mode: PSM.AUTO,
              preserve_interword_spaces: '1'
            }).catch(() => {});

            const { data } = await ocr.recognize(imagePath, {}, { blocks: true });
            const lines = [];
            if (!data || !data.blocks) return lines;

            for (const block of data.blocks) {
              if (!block.paragraphs) continue;
              for (const para of block.paragraphs) {
                if (!para.lines) continue;
                for (const line of para.lines) {
                  const text = postProcess(line.text || '');
                  if (line.confidence < M.ocrConf || text.trim().length === 0) continue;
                  const baseBox = {
                    x: (line.bbox.x0 + offsetX) * scaleToBase,
                    y: (line.bbox.y0 + offsetY) * scaleToBase,
                    w: (line.bbox.x1 - line.bbox.x0) * scaleToBase,
                    h: (line.bbox.y1 - line.bbox.y0) * scaleToBase
                  };
                  lines.push({ str: text, ...mapBox(baseBox) });
                }
              }
            }
            return lines;
          }

          async function ocrTopBandTiles(probe, outPath, ocrDpi, scaleToBase) {
            const tileSize = Math.min(2800, Math.floor(Math.sqrt(maxOcrPixels * 0.72)));
            const topBandHeight = Math.min(probe.height, tileSize, Math.ceil(probe.height * 0.28));
            const xTiles = Math.ceil(probe.width / tileSize);
            const yTiles = Math.ceil(topBandHeight / tileSize);

            // Keep this as a targeted rescue path, not a full-page OCR explosion.
            // The first screen band carries product codes/spec headlines in most print PDFs.
            if (xTiles * yTiles > 5) {
              throw new Error(`OCR image too large at ${ocrDpi} DPI (${probe.width}x${probe.height}); top-band tiles would be ${xTiles * yTiles}`);
            }

            const lines = [];
            for (let ty = 0; ty < yTiles; ty++) {
              for (let tx = 0; tx < xTiles; tx++) {
                const x = tx * tileSize;
                const y = ty * tileSize;
                const w = Math.min(tileSize, probe.width - x);
                const h = Math.min(tileSize, topBandHeight - y);
                if (w <= 0 || h <= 0) continue;

                const tile = cropRegion(probe, x, y, w, h);
                const tilePath = path.join(tempDir, `ocr_${side}${p}_${ocrDpi}_${tx}_${ty}.png`);
                try {
                  fs.writeFileSync(tilePath, PNG.sync.write(tile, { deflateLevel: 1 }));
                  lines.push(...await ocrImagePath(tilePath, scaleToBase, x, y));
                } finally {
                  try { fs.unlinkSync(tilePath); } catch (_) {}
                }
              }
            }
            return lines;
          }

          for (const ocrDpi of dpis) {
            const scaleToBase = DPI / ocrDpi;
            const outPath = path.join(tempDir, `ocr_${side}${p}_${ocrDpi}.png`);

            try {
              await renderOcrPage(filePath, p, outPath, ocrDpi);

              const stat = fs.existsSync(outPath) ? fs.statSync(outPath) : null;
              if (!stat || stat.size < 1000) {
                throw new Error(`OCR render produced an empty image at ${ocrDpi} DPI`);
              }

              // Validate the PNG before handing it to Tesseract. Oversized pages are handled
              // with top-band tiles so product codes/specs can still be found without OCRing
              // the whole artboard at once.
              const probe = PNG.sync.read(fs.readFileSync(outPath));
              if (!probe.width || !probe.height) {
                throw new Error(`OCR render produced invalid dimensions at ${ocrDpi} DPI`);
              }
              if (probe.width * probe.height > maxOcrPixels) {
                const tiledLines = await ocrTopBandTiles(probe, outPath, ocrDpi, scaleToBase);
                if (tiledLines.length > 0) return tiledLines;
                throw new Error(`OCR image too large at ${ocrDpi} DPI (${probe.width}x${probe.height})`);
              }

              return await ocrImagePath(outPath, scaleToBase);
            } catch (err) {
              console.error(`[Worker] high-res OCR ${side} failed at ${ocrDpi} DPI:`, err);
              await resetOCRWorker();
            } finally {
              try { fs.unlinkSync(outPath); } catch (_) {}
            }
          }

          return [];
        }

        ocrLinesA.push(...await recognizeHighResOcrPage(fileA, tA.length, 'A', box => box));
        ocrLinesB.push(...await recognizeHighResOcrPage(fileB, tB_orig.length, 'B', box => ({
          x: s_x * box.x + t_x,
          y: s_y * box.y + t_y,
          w: s_x * box.w,
          h: s_y * box.h
        })));



        // Remove OCR lines that overlap strongly with native text lines.
        function dedupeOcrAgainstNative(ocrLines, nativeLines) {
          return ocrLines.filter(ocr => {
            for (const nativeLine of nativeLines) {
              const overlapX = Math.max(0, Math.min(ocr.x + ocr.w, nativeLine.x + nativeLine.w) - Math.max(ocr.x, nativeLine.x));
              const overlapY = Math.max(0, Math.min(ocr.y + ocr.h, nativeLine.y + nativeLine.h) - Math.max(ocr.y, nativeLine.y));
              const overlapArea = overlapX * overlapY;
              const minArea = Math.min(
                Math.max(1, ocr.w * ocr.h),
                Math.max(1, nativeLine.w * nativeLine.h)
              );
              if (overlapArea / minArea > 0.6) {
                return false;
              }
            }
            return true;
          });
        }

        // Legacy low-resolution OCR fallback is kept disabled; OCR now uses high-DPI renderings above.
        if (false && tA.length <= 3 && !isImageBlank(rawA)) {
          const ocr = await getOCRWorker().catch(() => null);
          if (ocr) {
            try {
              const { data } = await ocr.recognize(pA, {}, { blocks: true });
              if (data && data.blocks) {
                for (const block of data.blocks) {
                  if (block.paragraphs) {
                    for (const para of block.paragraphs) {
                      if (para.lines) {
                        for (const line of para.lines) {
                          const text = postProcess(line.text || '');
                          if (line.confidence >= M.ocrConf && text.trim().length > 0) {
                            const x = line.bbox.x0;
                            const y = line.bbox.y0;
                            const w = line.bbox.x1 - line.bbox.x0;
                            const h = line.bbox.y1 - line.bbox.y0;
                            ocrLinesA.push({ str: text, x, y, w, h });
                          }
                        }
                      }
                    }
                  }
                }
              }
            } catch (err) {
              console.error('[Worker] OCR A failed:', err);
            }
          }
        }

        if (false && tB_orig.length <= 3 && !isImageBlank(imgB)) {
          const ocr = await getOCRWorker().catch(() => null);
          if (ocr) {
            try {
              const bufB = PNG.sync.write(imgB, { deflateLevel: 1 });
              const { data } = await ocr.recognize(bufB, {}, { blocks: true });
              if (data && data.blocks) {
                for (const block of data.blocks) {
                  if (block.paragraphs) {
                    for (const para of block.paragraphs) {
                      if (para.lines) {
                        for (const line of para.lines) {
                          const text = postProcess(line.text || '');
                          if (line.confidence >= M.ocrConf && text.trim().length > 0) {
                            const x = line.bbox.x0;
                            const y = line.bbox.y0;
                            const w = line.bbox.x1 - line.bbox.x0;
                            const h = line.bbox.y1 - line.bbox.y0;
                            ocrLinesB.push({ str: text, x, y, w, h });
                          }
                        }
                      }
                    }
                  }
                }
              }
            } catch (err) {
              console.error('[Worker] OCR B failed:', err);
            }
          }
        }

        // Group individual native text items into logical lines for accurate comparison
        const linesA = groupTextIntoLines(tA);
        const linesB = groupTextIntoLines(tB);

        ocrLinesA.splice(0, ocrLinesA.length, ...dedupeOcrAgainstNative(ocrLinesA, linesA));
        ocrLinesB.splice(0, ocrLinesB.length, ...dedupeOcrAgainstNative(ocrLinesB, linesB));

        const tA_processed = [...linesA, ...ocrLinesA];
        const tB_processed = [...linesB, ...ocrLinesB];

        const geosA = detectGeo(imgA, M.minGeo, tA_processed, contentBoxA);
        const geosB = detectGeo(imgB, M.minGeo, tB_processed, contentBoxA);

        // Gather all elements
        const elementsA = [];
        const elementsB = [];

        for (const line of linesA) {
          elementsA.push({ type: 'text', str: line.str, x: line.x, y: line.y, w: line.w, h: line.h, original: line });
        }
        for (const line of ocrLinesA) {
          elementsA.push({ type: 'ocr', str: line.str, x: line.x, y: line.y, w: line.w, h: line.h, original: line });
        }
        for (const geo of geosA) {
          elementsA.push({ type: 'shape', shapeType: geo.type, x: geo.x, y: geo.y, w: geo.w, h: geo.h, original: geo });
        }

        for (const line of linesB) {
          elementsB.push({ type: 'text', str: line.str, x: line.x, y: line.y, w: line.w, h: line.h, original: line });
        }
        for (const line of ocrLinesB) {
          elementsB.push({ type: 'ocr', str: line.str, x: line.x, y: line.y, w: line.w, h: line.h, original: line });
        }
        for (const geo of geosB) {
          elementsB.push({ type: 'shape', shapeType: geo.type, x: geo.x, y: geo.y, w: geo.w, h: geo.h, original: geo });
        }

        // Clustering algorithm to group elements into blocks
        function clusterElements(elements) {
          const n = elements.length;
          const parent = Array.from({ length: n }, (_, i) => i);

          function find(i) {
            if (parent[i] === i) return i;
            return parent[i] = find(parent[i]);
          }

          function union(i, j) {
            const rootI = find(i);
            const rootJ = find(j);
            if (rootI !== rootJ) {
              parent[rootI] = rootJ;
            }
          }

          function isClose(b1, b2) {
            const padX = 25;
            const padY = 15;
            return !(b2.x > b1.x + b1.w + padX ||
                     b2.x + b2.w < b1.x - padX ||
                     b2.y > b1.y + b1.h + padY ||
                     b2.y + b2.h < b1.y - padY);
          }

          for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
              if (isClose(elements[i], elements[j])) {
                union(i, j);
              }
            }
          }

          const groups = new Map();
          for (let i = 0; i < n; i++) {
            const root = find(i);
            if (!groups.has(root)) {
              groups.set(root, []);
            }
            groups.get(root).push(elements[i]);
          }

          const blocks = [];
          for (const [root, elms] of groups.entries()) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const el of elms) {
              if (el.x < minX) minX = el.x;
              if (el.y < minY) minY = el.y;
              if (el.x + el.w > maxX) maxX = el.x + el.w;
              if (el.y + el.h > maxY) maxY = el.y + el.h;
            }
            
            const textElements = elms.filter(e => e.type === 'text' || e.type === 'ocr');
            textElements.sort((a, b) => Math.abs(a.y - b.y) > 8 ? a.y - b.y : a.x - b.x);
            const textSummary = textElements.map(e => e.str).join(' ');

            blocks.push({
              bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
              elements: elms,
              textSummary: textSummary.replace(/\s+/g, ' ').trim(),
              textCount: textElements.length,
              shapeCount: elms.filter(e => e.type === 'shape').length
            });
          }

          return blocks;
        }

        // Translation-invariant block matcher
        function matchBlocks(blocksA, blocksB) {
          const matchedA = new Set();
          const matchedB = new Set();
          const pairs = [];
          const candidates = [];

          for (let i = 0; i < blocksA.length; i++) {
            const bA = blocksA[i];
            const textA = bA.textSummary;
            const shapesA = bA.elements.filter(e => e.type === 'shape');

            for (let j = 0; j < blocksB.length; j++) {
              const bB = blocksB[j];
              const textB = bB.textSummary;
              const shapesB = bB.elements.filter(e => e.type === 'shape');

              let sim = 0;
              let hasText = textA.length > 0 || textB.length > 0;
              let hasShapes = shapesA.length > 0 || shapesB.length > 0;

              if (hasText) {
                sim = textMatchScore(textA, textB);
                if (labelCompatible(textA, textB) && (numericTokens(textA).length || numericTokens(textB).length)) {
                  sim = Math.max(sim, 0.92);
                }
              } else if (hasShapes) {
                let matchedShapes = 0;
                const usedShapesB = new Set();
                for (const sA of shapesA) {
                  let bestB = -1;
                  for (let k = 0; k < shapesB.length; k++) {
                    if (usedShapesB.has(k)) continue;
                    const sB = shapesB[k];
                    if (sA.shapeType === sB.shapeType && Math.abs(sA.w - sB.w) < 20 && Math.abs(sA.h - sB.h) < 20) {
                      bestB = k;
                      break;
                    }
                  }
                  if (bestB >= 0) {
                    matchedShapes++;
                    usedShapesB.add(bestB);
                  }
                }
                sim = matchedShapes / Math.max(shapesA.length, shapesB.length || 1);
              }

              const areaA = Math.max(1, bA.bbox.w * bA.bbox.h);
              const areaB = Math.max(1, bB.bbox.w * bB.bbox.h);
              const areaSim = Math.min(areaA, areaB) / Math.max(areaA, areaB);
              const countPenalty = Math.abs(bA.elements.length - bB.elements.length) * 0.025;
              const shapePenalty = Math.abs(bA.shapeCount - bB.shapeCount) * 0.04;

              if (sim >= 0.3 && areaSim >= 0.25) {
                const cxA = bA.bbox.x + bA.bbox.w / 2;
                const cyA = bA.bbox.y + bA.bbox.h / 2;
                const cxB = bB.bbox.x + bB.bbox.w / 2;
                const cyB = bB.bbox.y + bB.bbox.h / 2;
                const dist = Math.sqrt((cxA - cxB) * (cxA - cxB) + (cyA - cyB) * (cyA - cyB));
                const score = (sim * 0.75) + (areaSim * 0.25) - dist * 0.0001 - countPenalty - shapePenalty;

                candidates.push({ i, j, score, sim });
              }
            }
          }

          candidates.sort((a, b) => b.score - a.score);

          for (const cand of candidates) {
            if (matchedA.has(cand.i) || matchedB.has(cand.j)) continue;
            matchedA.add(cand.i);
            matchedB.add(cand.j);
            pairs.push({ blockA: blocksA[cand.i], blockB: blocksB[cand.j] });
          }

          const unmatchedA = blocksA.filter((_, i) => !matchedA.has(i));
          const unmatchedB = blocksB.filter((_, j) => !matchedB.has(j));

          return { pairs, unmatchedA, unmatchedB };
        }

        // Mask region helper to prevent pixelmatch errors on matched shifted elements
        function maskRegion(png, bbox, pad = 2) {
          const { width, height, data } = png;
          const x1 = Math.max(0, Math.floor(bbox.x - pad));
          const y1 = Math.max(0, Math.floor(bbox.y - pad));
          const x2 = Math.min(width, Math.ceil(bbox.x + bbox.w + pad));
          const y2 = Math.min(height, Math.ceil(bbox.y + bbox.h + pad));
          
          for (let y = y1; y < y2; y++) {
            for (let x = x1; x < x2; x++) {
              const idx = (y * width + x) * 4;
              data[idx]     = 255;
              data[idx + 1] = 255;
              data[idx + 2] = 255;
              data[idx + 3] = 255;
            }
          }
        }

        function compareLocalBlockPixels(blockA, blockB) {
          const hasText = blockA.textCount > 0 || blockB.textCount > 0;
          const hasShapes = blockA.shapeCount > 0 || blockB.shapeCount > 0;
          if (hasText && !hasShapes && precision < 90) return [];

          const pad = 4;
          const a = clampBox(blockA.bbox, imgA.width, imgA.height, pad);
          const b = clampBox(blockB.bbox, imgB.width, imgB.height, pad);
          if (a.w <= 0 || a.h <= 0 || b.w <= 0 || b.h <= 0) return [];

          // Use the original, unmasked render here. The normal diff pipeline masks
          // matched shapes to avoid duplicate noise, but for review summaries we need
          // the inside of large drawings to split into meaningful visual sub-regions.
          const sourceA = origDataA ? { width: imgA.width, height: imgA.height, data: origDataA } : imgA;
          const sourceB = origDataB ? { width: imgB.width, height: imgB.height, data: origDataB } : imgB;
          const cropA = cropRegion(sourceA, a.x, a.y, a.w, a.h);
          const cropB = cropRegion(sourceB, b.x, b.y, b.w, b.h);
          const localW = Math.max(cropA?.width || 0, cropB?.width || 0);
          const localH = Math.max(cropA?.height || 0, cropB?.height || 0);
          if (localW <= 0 || localH <= 0) return [];

          const localA = whitePng(localW, localH);
          const localB = whitePng(localW, localH);
          pastePng(cropA, localA);
          pastePng(cropB, localB);

          const maxExactPixels = precision >= 90 ? 2400000 : 1800000;
          if (localW * localH > maxExactPixels) {
            const ratio = sampledDiffRatio(localA.data, localB.data, localW, 0, 0, localW, localH, precision >= 90 ? 3 : 5);
            if (ratio < 0.02) return [];
            return [{
              type: 'design_changed',
              severity: 'low',
              desc: `Large block internal visual change (${Math.round(localW)}x${Math.round(localH)} px, ~${Math.round(ratio * 100)}%)`,
              bbox: { x: a.x, y: a.y, width: a.w, height: a.h }
            }];
          }

          const diffPng = new PNG({ width: localW, height: localH });
          const threshold = Math.max(0.01, parseFloat((0.10 - 0.09 * p).toFixed(3)));
          pixelmatch(localA.data, localB.data, diffPng.data, localW, localH, { threshold, alpha: 0.5 });

          const G = precision >= 90 ? 8 : 14;
          const cols = Math.ceil(localW / G);
          const rows = Math.ceil(localH / G);
          const grid = new Uint8Array(cols * rows);

          for (let y = 0; y < localH; y++) {
            for (let x = 0; x < localW; x++) {
              const i = (y * localW + x) * 4;
              if (diffPng.data[i] === 255 && diffPng.data[i + 1] === 0 && diffPng.data[i + 2] === 0) {
                grid[Math.floor(y / G) * cols + Math.floor(x / G)] = 1;
              }
            }
          }

          const regions = [];
          const visited = new Uint8Array(cols * rows);
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const start = r * cols + c;
              if (!grid[start] || visited[start]) continue;

              let minC = c, maxC = c, minR = r, maxR = r;
              const q = [start];
              visited[start] = 1;
              while (q.length) {
                const cur = q.pop();
                const cr = Math.floor(cur / cols);
                const cc = cur % cols;
                if (cc < minC) minC = cc;
                if (cc > maxC) maxC = cc;
                if (cr < minR) minR = cr;
                if (cr > maxR) maxR = cr;
                for (let dr = -1; dr <= 1; dr++) {
                  for (let dc = -1; dc <= 1; dc++) {
                    const nr = cr + dr;
                    const nc = cc + dc;
                    const ni = nr * cols + nc;
                    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[ni] && !visited[ni]) {
                      visited[ni] = 1;
                      q.push(ni);
                    }
                  }
                }
              }

              const bx = minC * G;
              const by = minR * G;
              const bw = Math.min(localW - bx, (maxC - minC + 1) * G);
              const bh = Math.min(localH - by, (maxR - minR + 1) * G);
              if (bw < M.minVisualPx || bh < M.minVisualPx || bw * bh < M.minVisualAreaPx) continue;

              const density = pixDiffRatio(localA.data, localB.data, localW, bx, by, bw, bh);
              if (density < M.minVisualDensity) continue;

              const isLargeConnectedRegion = bw > 360 || bh > 360 || bw * bh > 180000;
              if (isLargeConnectedRegion) {
                const tileW = Math.max(180, Math.min(320, Math.ceil(bw / Math.ceil(bw / 280))));
                const tileH = Math.max(160, Math.min(280, Math.ceil(bh / Math.ceil(bh / 240))));
                for (let ty = by; ty < by + bh; ty += tileH) {
                  for (let tx = bx; tx < bx + bw; tx += tileW) {
                    const tw = Math.min(tileW, bx + bw - tx);
                    const th = Math.min(tileH, by + bh - ty);
                    if (tw < 24 || th < 24) continue;
                    const tileDensity = pixDiffRatio(localA.data, localB.data, localW, tx, ty, tw, th);
                    if (tileDensity < M.minVisualDensity) continue;
                    regions.push({
                      type: 'design_changed',
                      severity: 'low',
                      desc: `Block visual change section (${Math.round(tw)}x${Math.round(th)} px, ${Math.round(tileDensity * 100)}%)`,
                      bbox: {
                        x: Math.min(imgA.width - 1, a.x + tx),
                        y: Math.min(imgA.height - 1, a.y + ty),
                        width: tw,
                        height: th
                      }
                    });
                  }
                }
              } else {
                regions.push({
                  type: 'design_changed',
                  severity: 'low',
                  desc: `Block internal visual change (${Math.round(bw)}x${Math.round(bh)} px, ${Math.round(density * 100)}%)`,
                  bbox: {
                    x: Math.min(imgA.width - 1, a.x + bx),
                    y: Math.min(imgA.height - 1, a.y + by),
                    width: bw,
                    height: bh
                  }
                });
              }
            }
          }

          return regions.slice(0, 12);
        }

        // Save original image data for display (masking is only for internal pixelmatch)
        origDataA = Buffer.from(imgA.data);
        origDataB = Buffer.from(imgB.data);

        const blocksA = clusterElements(elementsA);
        const blocksB = clusterElements(elementsB);
        const { pairs, unmatchedA, unmatchedB } = matchBlocks(blocksA, blocksB);

        // Process matched pairs
        for (const pair of pairs) {
          const bA = pair.blockA;
          const bB = pair.blockB;

          // Detect whole block movement when internal content is effectively identical.
          const blockTextSame =
            compactText(bA.textSummary) === compactText(bB.textSummary);

          const areaA = Math.max(1, bA.bbox.w * bA.bbox.h);
          const areaB = Math.max(1, bB.bbox.w * bB.bbox.h);
          const areaRatio = Math.abs(areaA - areaB) / Math.max(areaA, areaB);

          const dx = bB.bbox.x - bA.bbox.x;
          const dy = bB.bbox.y - bA.bbox.y;
          const dxPt = dx * R;
          const dyPt = dy * R;

          if (
            blockTextSame &&
            areaRatio < 0.15 &&
            (Math.abs(dxPt) > 1 || Math.abs(dyPt) > 1)
          ) {
            diffs.push({
              type: 'block_moved',
              severity: 'medium',
              desc: `컨텐츠 블록 이동 (가로 ${Math.round(dxPt)}pt, 세로 ${Math.round(dyPt)}pt)`,
              bbox: {
                x: bA.bbox.x,
                y: bA.bbox.y,
                width: bA.bbox.w,
                height: bA.bbox.h
              },
              moveInfo: {
                from: bA.bbox,
                to: bB.bbox,
                dxPx: dx,
                dyPx: dy,
                dxPt,
                dyPt
              }
            });
          }

          // Match text elements inside the block
          const textsA = bA.elements.filter(e => e.type === 'text' || e.type === 'ocr');
          const textsB = bB.elements.filter(e => e.type === 'text' || e.type === 'ocr');
          const matchedTextB = new Set();

          for (const ta of textsA) {
            let bestB = -1;
            let bestSim = -1;
            for (let k = 0; k < textsB.length; k++) {
              if (matchedTextB.has(k)) continue;
              const tb = textsB[k];
              const sim = textMatchScore(ta.str, tb.str);
              if (sim > bestSim) {
                bestSim = sim;
                bestB = k;
              }
            }

            if (bestB >= 0 && shouldMatchText(ta.str, textsB[bestB].str, M.textSim)) {
              matchedTextB.add(bestB);
              const tb = textsB[bestB];

              // Check content changes (text strings)
              const compareA = normalizedSemanticText(ta.str);
              const compareB = normalizedSemanticText(tb.str);
              if (compareA !== compareB) {
                const { type, severity } = diffTypeForText(compareA, compareB);
                const diffParts = diffLib.diffChars(compareA, compareB);
                const diffsArray = diffParts.map(part => [part.removed ? -1 : part.added ? 1 : 0, part.value]);

                diffs.push({
                  type,
                  severity,
                  before: compareA,
                  desc: `"${compareA}" -> "${compareB}"`,
                  bbox: { x: ta.x, y: ta.y, width: ta.w, height: ta.h },
                  textInfo: { beforeStr: compareA, afterStr: compareB, diffs: diffsArray }
                });
              } else if (ta.type === 'text' && tb.type === 'text') {
                // Both are native text. Check font size change
                const sizeDiff = Math.abs(ta.h - tb.h) * R;
                if (sizeDiff > 1.5) {
                  diffs.push({
                    type: 'style_changed',
                    severity: 'low',
                    desc: `"${ta.str}" 글자 크기 변경(${Math.round(ta.h * R)}pt → ${Math.round(tb.h * R)}pt)`,
                    bbox: { x: ta.x, y: ta.y, width: ta.w, height: ta.h }
                  });
                }
              }

              // Mask the element region on both sides to prevent pixelmatch errors
              maskRegion(imgA, ta);
              maskRegion(imgB, tb);

            } else {
              // Unmatched text in A -> Deleted
              diffs.push({
                type: 'text_modified',
                severity: 'high',
                before: ta.str,
                desc: `"${ta.str}" 삭제됨`,
                bbox: { x: ta.x, y: ta.y, width: ta.w, height: ta.h },
                textInfo: { beforeStr: ta.str, afterStr: '', diffs: [[-1, ta.str]] }
              });
            }
          }

          for (let k = 0; k < textsB.length; k++) {
            if (matchedTextB.has(k)) continue;
            const tb = textsB[k];
            // Unmatched text in B -> Added
            diffs.push({
              type: 'text_modified',
              severity: 'high',
              before: '',
              desc: `"${tb.str}" 새로 추가됨`,
              bbox: { x: tb.x, y: tb.y, width: tb.w, height: tb.h },
              textInfo: { beforeStr: '', afterStr: tb.str, diffs: [[1, tb.str]] }
            });
          }

          // Match shape elements inside the block
          const shapesA = bA.elements.filter(e => e.type === 'shape');
          const shapesB = bB.elements.filter(e => e.type === 'shape');
          const matchedShapeB = new Set();

          for (const sa of shapesA) {
            let bestB = -1;
            let bestIoU = -1;
            for (let k = 0; k < shapesB.length; k++) {
              if (matchedShapeB.has(k)) continue;
              const sb = shapesB[k];
              if (sa.shapeType === sb.shapeType) {
                const dw = Math.abs(sa.w - sb.w);
                const dh = Math.abs(sa.h - sb.h);
                const sizeSimilarity = 1.0 - (dw + dh) / Math.max(sa.w + sa.h, sb.w + sb.h, 1);
                if (sizeSimilarity > bestIoU) {
                  bestIoU = sizeSimilarity;
                  bestB = k;
                }
              }
            }

            if (bestB >= 0 && bestIoU > 0.4) {
              matchedShapeB.add(bestB);
              const sb = shapesB[bestB];

              // Check size change
              const dw = Math.abs(sa.w - sb.w) * R;
              const dh = Math.abs(sa.h - sb.h) * R;

              if (dw > M.geoTol || dh > M.geoTol) {
                const large = sa.w * R > 150 || sa.h * R > 150;
                diffs.push({
                  type: large ? 'layout_changed' : 'shape_resized',
                  severity: large ? 'high' : 'medium',
                  desc: `${sa.shapeType === 'rect' ? '사각형' : '도형'} 크기 변경 (가로Δ${Math.round(dw)} 세로Δ${Math.round(dh)} pt)`,
                  bbox: { x: sa.x, y: sa.y, width: sa.w, height: sa.h }
                });
              } else {
                // Check color/fill changes visually
                const visualDiff = localDiffRatio(imgA, imgB, sa, sb, 2);
                if (visualDiff > 0.05) {
                  diffs.push({
                    type: 'shape_modified',
                    severity: 'medium',
                    desc: '도형 색상/채우기/테두리 변경',
                    bbox: { x: sa.x, y: sa.y, width: sa.w, height: sa.h }
                  });
                }
              }

              // Mask the shape element region on both sides to prevent pixelmatch errors
              maskRegion(imgA, sa);
              maskRegion(imgB, sb);

            } else {
              // Unmatched shape in A -> Deleted
              diffs.push({
                type: 'layout_changed',
                severity: 'high',
                desc: `${sa.shapeType === 'rect' ? '사각형' : '도형'} 삭제됨`,
                bbox: { x: sa.x, y: sa.y, width: sa.w, height: sa.h }
              });
            }
          }

          for (let k = 0; k < shapesB.length; k++) {
            if (matchedShapeB.has(k)) continue;
            const sb = shapesB[k];
            // Unmatched shape in B -> Added
            diffs.push({
              type: 'layout_changed',
              severity: 'high',
              desc: `새 ${sb.shapeType === 'rect' ? '사각형' : '도형'} 추가됨`,
              bbox: { x: sb.x, y: sb.y, width: sb.w, height: sb.h }
            });
            maskRegion(imgB, sb);
          }

          for (const localDiff of compareLocalBlockPixels(bA, bB)) {
            diffs.push(localDiff);
          }

          // Once a block pair has been compared in local coordinates, remove it from
          // the final page-wide pixel pass so a harmless whole-block move is not
          // reported again as a large visual change.
          maskRegion(imgA, bA.bbox, 4);
          maskRegion(imgB, bB.bbox, 4);
        }

        // Process unmatched blocks
        for (const bA of unmatchedA) {
          const texts = bA.elements.filter(e => e.type === 'text' || e.type === 'ocr');
          const shapes = bA.elements.filter(e => e.type === 'shape');

          for (const ta of texts) {
            diffs.push({
              type: 'text_modified',
              severity: 'high',
              before: ta.str,
              desc: `"${ta.str}" 삭제됨`,
              bbox: { x: ta.x, y: ta.y, width: ta.w, height: ta.h },
              textInfo: { beforeStr: ta.str, afterStr: '', diffs: [[-1, ta.str]] }
            });
          }

          for (const sa of shapes) {
            diffs.push({
              type: 'layout_changed',
              severity: 'high',
              desc: `${sa.shapeType === 'rect' ? '사각형' : '도형'} 삭제됨`,
              bbox: { x: sa.x, y: sa.y, width: sa.w, height: sa.h }
            });
          }
          maskRegion(imgA, bA.bbox, 4);
        }

        for (const bB of unmatchedB) {
          const texts = bB.elements.filter(e => e.type === 'text' || e.type === 'ocr');
          const shapes = bB.elements.filter(e => e.type === 'shape');

          for (const tb of texts) {
            diffs.push({
              type: 'text_modified',
              severity: 'high',
              before: '',
              desc: `"${tb.str}" 새로 추가됨`,
              bbox: { x: tb.x, y: tb.y, width: tb.w, height: tb.h },
              textInfo: { beforeStr: '', afterStr: tb.str, diffs: [[1, tb.str]] }
            });
          }

          for (const sb of shapes) {
            diffs.push({
              type: 'layout_changed',
              severity: 'high',
              desc: `새 ${sb.shapeType === 'rect' ? '사각형' : '도형'} 추가됨`,
              bbox: { x: sb.x, y: sb.y, width: sb.w, height: sb.h }
            });
          }
          maskRegion(imgB, bB.bbox, 4);
        }

        // Run pixelmatch on the masked images to detect remaining differences (e.g. background or image edits)
        const diffPng = new PNG({ width: W, height: H });
        const matchThresh = Math.max(0.01, parseFloat((0.10 - 0.09 * p).toFixed(3)));
        pixelmatch(imgA.data, imgB.data, diffPng.data, W, H, { threshold: matchThresh, alpha: 0.5 });

        const G = precision >= 90 ? 10 : 18;
        const edgeStrip = M.pageEdgePx;
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
            if(bw < M.minVisualPx || bh < M.minVisualPx || bw * bh < M.minVisualAreaPx) continue;
            // Intentionally NOT calling overlapHandled() — background colour
            // changes share the same bbox as already-handled text.
            const dr=pixDiffRatio(imgA.data,imgB.data,W,bx,by,bw,bh);
            // Skip pure anti-aliasing edge noise (pixel change density < 1.5%)
            if(dr < M.minVisualDensity) continue;
            diffs.push({
              type:'design_changed', severity:'low',
              desc:`이미지/아이콘 변경 (${Math.round(bw)}×${Math.round(bh)} px, Δ${Math.round(dr*100)}%)`,
              bbox:{x:bx,y:by,width:bw,height:bh}
            });
      }
      }
    }

      if (hasA) {
        if (imgA && origDataA) imgA.data.set(origDataA);
        base64A = imgA ? PNG.sync.write(imgA, { deflateLevel: 1 }).toString('base64') : fs.readFileSync(pA).toString('base64');
      }
      if (hasB) {
        if (imgB && origDataB) imgB.data.set(origDataB);
        base64B = imgB ? PNG.sync.write(imgB, { deflateLevel: 1 }).toString('base64') : fs.readFileSync(pB).toString('base64');
      }
      const normalization = (hasA && hasB) ? {
        boxesA,
        boxesB,
        contentBoxA,
        contentBoxB,
        scaleX: s_x,
        scaleY: s_y,
        offsetX: t_x,
        offsetY: t_y,
        requestedDPI,
        effectiveDPI: DPI
      } : null;
      const humanReview = buildHumanReviewSummary(
        p,
        diffs,
        { width: imgA?.width || imgB?.width || 1, height: imgA?.height || imgB?.height || 1 },
        normalization
      );
      results.push({
        page: p,
        diffs,
        reviewItems: humanReview.reviewItems,
        pageSummary: humanReview.pageSummary,
        base64A,
        base64B,
        normalization
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
