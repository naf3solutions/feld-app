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

export async function processPhoto(file) {
  const bitmap = await loadBitmap(file);
  try {
    const fullBlob = await resizeToBlob(bitmap, MAX_EDGE, JPEG_QUALITY);
    const thumbBlob = await resizeToBlob(bitmap, THUMB_EDGE, THUMB_QUALITY);
    return { blob: fullBlob, thumbnail: thumbBlob };
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
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Bild-Encoding fehlgeschlagen.'))),
      'image/jpeg',
      quality
    );
  });
}
