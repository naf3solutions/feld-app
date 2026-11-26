// Schrifterkennung für Beschriftungsschilder (z. B. "147-VE-171").
// Ablauf: helle, rechteckige Flächen im Foto suchen → Ausschnitt per
// Tesseract (lokal ausgeliefert unter /ocr/) lesen → Vorschläge liefern.

const ANALYSIS_EDGE = 800;   // Kantenlänge für die Flächensuche
const MAX_CANDIDATES = 4;    // so viele Flächen werden höchstens gelesen
// Varianten der Vorverarbeitung. Schildschrift ist im Foto oft nur ~20 px
// hoch; einzelne Lesungen verwechseln dann 1/4/7 oder verschlucken Bindestriche.
// Mehrere Varianten lesen und per Mehrheit entscheiden macht das robuster.
const QUICK_VARIANT = { pad: 0.08, height: 320, binarize: false, psm: '4' };
const VOTE_VARIANTS = [
  { pad: 0.08, height: 420, binarize: true, psm: '4' },
  { pad: 0.08, height: 320, binarize: false, psm: '6' },
  { pad: 0, height: 320, binarize: true, psm: '6' },
  { pad: 0.08, height: 420, binarize: false, psm: '6' },
  QUICK_VARIANT,
];

let workerPromise = null;

function getWorker(onStatus) {
  if (!workerPromise) {
    workerPromise = (async () => {
      onStatus?.('Lade Texterkennung… (nur beim ersten Mal)');
      const { createWorker, PSM } = await import('tesseract.js');
      const base = new URL(import.meta.env.BASE_URL + 'ocr/', window.location.href).href;
      const worker = await createWorker('eng', 1, {
        workerPath: base + 'worker.min.js',
        corePath: base,
        langPath: base.replace(/\/$/, ''),
        cacheMethod: 'none', // Caching übernimmt der Service Worker
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: '1',
      });
      return worker;
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/**
 * Sucht Schilder im Foto und liest sie. Liefert Vorschläge
 * [{ text, lines, confidence, box }] – bester zuerst.
 */
export async function suggestNamesFromPhoto(blob, { onStatus } = {}) {
  const img = await loadBitmap(blob);
  try {
    const small = drawScaled(img, ANALYSIS_EDGE);
    const regions = findLabelRegions(small.data, small.width, small.height)
      .slice(0, MAX_CANDIDATES)
      .map((r) => scaleBox(r, img.width / small.width));
    if (regions.length === 0) return [];
    const worker = await getWorker(onStatus);
    const quick = [];
    for (let i = 0; i < regions.length; i++) {
      onStatus?.(`Suche Text ${i + 1}/${regions.length}…`);
      const res = await readRegion(worker, img, regions[i], QUICK_VARIANT);
      if (res) quick.push(res);
    }
    // Flächen mit Text zuerst, solche mit kennungsartigem Text ganz vorn
    const withText = quick
      .filter((r) => r.lines.some((l) => l.length >= 3))
      .sort((a, b) => score(b) - score(a));
    const suggestions = [];
    for (const region of withText.slice(0, 2)) {
      onStatus?.('Lese Schild genau…');
      const voted = await readRegionVoted(worker, img, region.box);
      if (!voted) continue;
      const tags = voted.lines.filter(looksLikeTag);
      suggestions.push(...(tags.length ? tags : voted.lines.slice(0, 1)).map((text) => ({ text, box: region.box })));
      if (tags.length) break; // Schild gefunden
    }
    return dedupe(suggestions).slice(0, 4);
  } finally {
    img.close?.();
  }
}

/**
 * Liest den Bereich rund um einen angetippten Punkt (Koordinaten relativ
 * 0..1). Liefert { lines, confidence } oder null.
 */
export async function readAtPoint(blob, relX, relY, { onStatus } = {}) {
  const img = await loadBitmap(blob);
  try {
    const small = drawScaled(img, ANALYSIS_EDGE);
    const sx = Math.round(relX * small.width);
    const sy = Math.round(relY * small.height);
    let box = regionAt(small.data, small.width, small.height, sx, sy);
    if (!box) {
      // Fallback: fester Ausschnitt um den Tippunkt
      const bw = small.width * 0.35;
      const bh = small.height * 0.14;
      box = { x: sx - bw / 2, y: sy - bh / 2, w: bw, h: bh };
    }
    const worker = await getWorker(onStatus);
    onStatus?.('Lese Schild…');
    return await readRegionVoted(worker, img, scaleBox(box, img.width / small.width));
  } finally {
    img.close?.();
  }
}

// ---------- Erkennung ----------

// Liest einen Bereich mit allen Varianten; die häufigste erste Zeile gewinnt.
async function readRegionVoted(worker, img, box) {
  const reads = [];
  for (const v of VOTE_VARIANTS) {
    const r = await readRegion(worker, img, box, v);
    if (r) reads.push(r);
  }
  if (reads.length === 0) return null;
  const votes = new Map();
  for (const r of reads) {
    const key = normalizeTag(r.lines.find(looksLikeTag) ?? r.lines[0]);
    const v = votes.get(key) ?? { n: 0, conf: 0, read: r };
    v.n++;
    v.conf += r.confidence;
    votes.set(key, v);
  }
  const [text, win] = [...votes.entries()].sort((a, b) => b[1].n - a[1].n || b[1].conf - a[1].conf)[0];
  const lines = win.read.lines.slice();
  const idx = lines.findIndex(looksLikeTag);
  lines[idx >= 0 ? idx : 0] = text;
  // Abweichende Lesungen als weitere Vorschläge anbieten
  const alternatives = [...votes.keys()].filter((k) => k !== text && looksLikeTag(k));
  return { lines: [...lines, ...alternatives], confidence: win.conf / win.n, box };
}

// Kennungen mit Bindestrich: Leerzeichen/Punkte zwischen Gruppen → Bindestrich
function normalizeTag(s) {
  if (!s.includes('-')) return s;
  return s.replace(/(?<=[\p{L}\p{N}])\s*[ .]\s*(?=[\p{L}\p{N}])/gu, '-');
}

async function readRegion(worker, img, box, variant) {
  const pad = Math.round(Math.min(box.w, box.h) * variant.pad);
  const x = clamp(Math.round(box.x - pad), 0, img.width - 1);
  const y = clamp(Math.round(box.y - pad), 0, img.height - 1);
  const w = clamp(Math.round(box.w + 2 * pad), 1, img.width - x);
  const h = clamp(Math.round(box.h + 2 * pad), 1, img.height - y);
  const scale = Math.max(1, Math.min(5, variant.height / h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
  if (variant.binarize) binarize(ctx, canvas.width, canvas.height);

  await worker.setParameters({ tessedit_pageseg_mode: variant.psm });
  const { data } = await worker.recognize(canvas);
  const lines = (data.text || '')
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((l) => l.length >= 2);
  if (lines.length === 0) return null;
  return { lines, confidence: data.confidence ?? 0, box };
}

function cleanLine(line) {
  return line
    .replace(/[|_~`'"‘’“”«»]/g, ' ')
    .replace(/[^\p{L}\p{N}\-\/.,:+ ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Kennungen wie 147-VE-171, LI-090, P 4711 …
function looksLikeTag(s) {
  return /\d/.test(s) && /^[\p{L}\p{N}][\p{L}\p{N}\-\/. ]{2,24}$/u.test(s);
}

function score(r) {
  return (r.lines.some(looksLikeTag) ? 100 : 0) + (r.confidence ?? 0);
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((r) => r && (seen.has(r.text) ? false : seen.add(r.text)));
}

// ---------- Flächensuche (helle, wenig gesättigte Rechtecke) ----------

function isLabelPixel(d, i) {
  const r = d[i], g = d[i + 1], b = d[i + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max > 185 && max - min < 40;
}

function buildMask(d, w, h) {
  const mask = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) mask[p] = isLabelPixel(d, i) ? 1 : 0;
  return mask;
}

// Zusammenhängende Flächen (4er-Nachbarschaft) mit Bounding-Box
function components(mask, w, h) {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const comps = [];
  let next = 0;
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start]) continue;
    next++;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = next;
    let area = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    while (sp) {
      const p = stack[--sp];
      const x = p % w, y = (p / w) | 0;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = next; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !labels[p - w]) { labels[p - w] = next; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !labels[p + w]) { labels[p + w] = next; stack[sp++] = p + w; }
    }
    comps.push({ id: next, area, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  return { labels, comps };
}

function findLabelRegions(d, w, h) {
  const { comps } = components(buildMask(d, w, h), w, h);
  const total = w * h;
  return comps
    .map((c) => {
      const boxArea = c.w * c.h;
      const fill = c.area / boxArea;
      const aspect = c.w / c.h;
      return { ...c, fill, aspect, boxArea };
    })
    .filter((c) => c.boxArea >= total * 0.003 && c.boxArea <= total * 0.3
      && c.fill >= 0.5 && c.aspect >= 1.1 && c.aspect <= 9
      && c.h >= 12)
    // Rechteckig & gut gefüllt, nicht am Bildrand abgeschnitten bevorzugen
    .map((c) => {
      const touchesEdge = c.x === 0 || c.y === 0 || c.x + c.w >= w || c.y + c.h >= h;
      return { ...c, score: c.fill * Math.sqrt(c.boxArea) * (touchesEdge ? 0.4 : 1) };
    })
    .sort((a, b) => b.score - a.score);
}

function regionAt(d, w, h, sx, sy) {
  const mask = buildMask(d, w, h);
  // Nächstes helles Pixel um den Tippunkt suchen (Tipp kann auf Schrift liegen)
  let seed = -1;
  const R = Math.round(Math.min(w, h) * 0.05);
  for (let r = 0; r <= R && seed < 0; r++) {
    for (let dy = -r; dy <= r && seed < 0; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = sx + dx, y = sy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (mask[y * w + x]) { seed = y * w + x; break; }
      }
    }
  }
  if (seed < 0) return null;
  const { labels, comps } = components(mask, w, h);
  const comp = comps[labels[seed] - 1];
  if (!comp) return null;
  const boxArea = comp.w * comp.h;
  if (boxArea > w * h * 0.35 || boxArea < 100) return null;
  return comp;
}

// ---------- Bild-Helfer ----------

// Graustufen + Otsu-Schwellwert → schwarze Schrift auf weißem Grund
function binarize(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Uint32Array(256);
  const gray = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
    gray[p] = g;
    hist[g]++;
  }
  const total = w * h;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thresh = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thresh = t; }
  }
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const v = gray[p] > thresh ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

async function loadBitmap(blob) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(blob);
    } catch { /* Fallback unten */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht geladen werden.')); };
    img.src = url;
  });
}

function drawScaled(img, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}

function scaleBox(b, f) {
  return { x: b.x * f, y: b.y * f, w: b.w * f, h: b.h * f };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
