import { readExif, prepareExif, setGps, insertExif, summarizeExif } from './exif.js';

const MAX_EDGE = 1600;
const THUMB_EDGE = 200;
const JPEG_QUALITY = 0.85;
const THUMB_QUALITY = 0.7;

export function pickPhoto() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    }, { once: true });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Verkleinert das Foto, übernimmt das Original-EXIF (Kamera, Belichtung,
 * Aufnahmezeit …) und schreibt – falls vorhanden – die GPS-Position des
 * Eintrags hinein.
 */
export async function processPhoto(file, { gps = null } = {}) {
  const originalExif = await readExif(file);
  const bitmap = await loadBitmap(file);
  try {
    const full = await resizeToBlob(bitmap, MAX_EDGE, JPEG_QUALITY);
    const thumb = await resizeToBlob(bitmap, THUMB_EDGE, THUMB_QUALITY);
    const exif = prepareExif(originalExif, {
      width: full.width,
      height: full.height,
      fallbackTime: file.lastModified || Date.now(),
    });
    setGps(exif, gps);
    let blob = full.blob;
    try {
      blob = await insertExif(full.blob, exif);
    } catch (err) {
      console.warn('[exif] Einfügen fehlgeschlagen, Foto ohne EXIF gespeichert', err);
    }
    return {
      blob,
      thumbnail: thumb.blob,
      exif,
      meta: summarizeExif(exif),
      hadOriginalExif: !!originalExif,
    };
  } finally {
    bitmap.close?.();
  }
}

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // fallthrough to HTMLImageElement
    }
  }
  return await loadViaImage(file);
}

function loadViaImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Bild konnte nicht geladen werden.'));
    };
    img.src = url;
  });
}

async function resizeToBlob(source, maxEdge, quality) {
  const sw = source.width;
  const sh = source.height;
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, w, h);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Bild-Encoding fehlgeschlagen.'))),
      'image/jpeg',
      quality
    );
  });
  return { blob, width: w, height: h };
}
