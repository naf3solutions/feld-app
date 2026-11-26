// EXIF-Handling für Fotos: Original-EXIF übernehmen, GPS aus dem Eintrag
// schreiben, Kamera-Metadaten für den Export auslesen.
import piexif from 'piexifjs';

const SOFTWARE = 'naf3solutions feld-app';
// Tags, die nach dem Neu-Encoding nicht mehr stimmen oder unnötig Platz kosten.
const DROP_EXIF_TAGS = [
  piexif.ExifIFD.MakerNote,          // interne Offsets werden ungültig
  piexif.ExifIFD.InteroperabilityTag,
];
const DROP_0TH_TAGS = [
  piexif.ImageIFD.ImageWidth,
  piexif.ImageIFD.ImageLength,
  piexif.ImageIFD.StripOffsets,
  piexif.ImageIFD.StripByteCounts,
];

/**
 * Liest den EXIF-Block (APP1 "Exif\0\0") aus einer JPEG-Datei.
 * Liefert das EXIF-Objekt von piexif oder null (kein JPEG / kein EXIF).
 */
export async function readExif(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
    if (head[0] !== 0xff || head[1] !== 0xd8) return null;
    let p = 2;
    while (p + 4 <= head.length) {
      if (head[p] !== 0xff) return null;
      const marker = head[p + 1];
      if (marker === 0xda || marker === 0xd9) return null; // Bilddaten erreicht
      const len = (head[p + 2] << 8) | head[p + 3];
      if (marker === 0xe1 && p + 4 + len - 2 <= head.length) {
        const seg = bytesToBinary(head.subarray(p + 4, p + 2 + len));
        if (seg.startsWith('Exif\x00\x00')) {
          const exif = piexif.load(seg);
          exif.thumbnail = null;
          exif['1st'] = {};
          return exif;
        }
      }
      p += 2 + len;
    }
  } catch (err) {
    console.warn('[exif] Lesen fehlgeschlagen', err);
  }
  return null;
}

/** Leeres EXIF-Gerüst. */
export function emptyExif() {
  return { '0th': {}, Exif: {}, GPS: {}, Interop: {}, '1st': {}, thumbnail: null };
}

/**
 * Bereitet das Original-EXIF für das verkleinerte, bereits gedrehte Bild auf.
 */
export function prepareExif(exif, { width, height, fallbackTime }) {
  const e = exif ? structuredClone(exif) : emptyExif();
  e.thumbnail = null;
  e['1st'] = {};
  e.Interop = {};
  for (const t of DROP_EXIF_TAGS) delete e.Exif[t];
  for (const t of DROP_0TH_TAGS) delete e['0th'][t];

  e['0th'][piexif.ImageIFD.Orientation] = 1; // Pixel sind schon richtig gedreht
  e['0th'][piexif.ImageIFD.Software] = SOFTWARE;
  e.Exif[piexif.ExifIFD.PixelXDimension] = width;
  e.Exif[piexif.ExifIFD.PixelYDimension] = height;

  if (!e.Exif[piexif.ExifIFD.DateTimeOriginal] && fallbackTime) {
    const s = formatExifDate(new Date(fallbackTime));
    e.Exif[piexif.ExifIFD.DateTimeOriginal] = s;
    e.Exif[piexif.ExifIFD.DateTimeDigitized] = s;
    e['0th'][piexif.ImageIFD.DateTime] = s;
  }
  return e;
}

/**
 * Schreibt GPS-Daten (Format wie in den Einträgen: lat, lng, accuracy,
 * altitude, heading, speed, gpsTimestamp) in das EXIF-Objekt.
 * Ohne gps bleibt ein evtl. vorhandenes Original-GPS stehen.
 */
export function setGps(exif, gps) {
  if (!gps || gps.lat == null || gps.lng == null) return exif;
  const G = piexif.GPSIFD;
  const out = {
    [G.GPSVersionID]: [2, 3, 0, 0],
    [G.GPSLatitudeRef]: gps.lat >= 0 ? 'N' : 'S',
    [G.GPSLatitude]: toDms(Math.abs(gps.lat)),
    [G.GPSLongitudeRef]: gps.lng >= 0 ? 'E' : 'W',
    [G.GPSLongitude]: toDms(Math.abs(gps.lng)),
    [G.GPSMapDatum]: 'WGS-84',
  };
  if (gps.altitude != null) {
    out[G.GPSAltitudeRef] = gps.altitude < 0 ? 1 : 0;
    out[G.GPSAltitude] = rational(Math.abs(gps.altitude), 100);
  }
  if (gps.accuracy != null) out[G.GPSHPositioningError] = rational(gps.accuracy, 10);
  if (gps.heading != null && !Number.isNaN(gps.heading)) {
    out[G.GPSImgDirectionRef] = 'T';
    out[G.GPSImgDirection] = rational(gps.heading, 100);
  }
  if (gps.speed != null && !Number.isNaN(gps.speed)) {
    out[G.GPSSpeedRef] = 'K';
    out[G.GPSSpeed] = rational(gps.speed * 3.6, 100);
  }
  if (gps.gpsTimestamp) {
    const d = new Date(gps.gpsTimestamp);
    out[G.GPSDateStamp] = `${d.getUTCFullYear()}:${pad(d.getUTCMonth() + 1)}:${pad(d.getUTCDate())}`;
    out[G.GPSTimeStamp] = [[d.getUTCHours(), 1], [d.getUTCMinutes(), 1], [d.getUTCSeconds(), 1]];
  }
  exif.GPS = out;
  return exif;
}

/**
 * Fügt das EXIF in einen JPEG-Blob ein. Klappt der Dump mit dem vollen
 * Original-EXIF nicht (exotische Tags), wird auf die Kern-Tags reduziert.
 */
export async function insertExif(jpegBlob, exif) {
  const jpeg = bytesToBinary(new Uint8Array(await jpegBlob.arrayBuffer()));
  let bytes;
  try {
    bytes = piexif.dump(exif);
  } catch (err) {
    console.warn('[exif] Dump mit Original-EXIF fehlgeschlagen, reduziere', err);
    bytes = piexif.dump(reduceExif(exif));
  }
  const stripped = piexif.remove(jpeg);
  const out = piexif.insert(bytes, stripped);
  return new Blob([binaryToBytes(out)], { type: 'image/jpeg' });
}

/** Kompakte, lesbare Metadaten für DB/CSV. */
export function summarizeExif(exif) {
  if (!exif) return {};
  const z = exif['0th'] || {};
  const x = exif.Exif || {};
  const make = clean(z[piexif.ImageIFD.Make]);
  const model = clean(z[piexif.ImageIFD.Model]);
  const camera = model && make && !model.startsWith(make) ? `${make} ${model}` : (model || make);
  const exposure = x[piexif.ExifIFD.ExposureTime];
  const fNumber = x[piexif.ExifIFD.FNumber];
  const focal = x[piexif.ExifIFD.FocalLength];
  const iso = x[piexif.ExifIFD.ISOSpeedRatings];
  const meta = {
    camera: camera || null,
    lens: clean(x[piexif.ExifIFD.LensModel]) || null,
    dateTimeOriginal: parseExifDate(clean(x[piexif.ExifIFD.DateTimeOriginal])),
    exposureTime: exposure ? formatExposure(exposure) : null,
    fNumber: fNumber ? round(fNumber[0] / fNumber[1], 1) : null,
    iso: Array.isArray(iso) ? iso[0] : (iso ?? null),
    focalLength: focal ? round(focal[0] / focal[1], 1) : null,
    focalLength35mm: x[piexif.ExifIFD.FocalLengthIn35mmFilm] ?? null,
  };
  return meta;
}

// ---------- Helfer ----------

function reduceExif(exif) {
  const keep0 = [piexif.ImageIFD.Make, piexif.ImageIFD.Model, piexif.ImageIFD.Orientation,
    piexif.ImageIFD.Software, piexif.ImageIFD.DateTime];
  const keepX = [piexif.ExifIFD.DateTimeOriginal, piexif.ExifIFD.DateTimeDigitized,
    piexif.ExifIFD.ExposureTime, piexif.ExifIFD.FNumber, piexif.ExifIFD.ISOSpeedRatings,
    piexif.ExifIFD.FocalLength, piexif.ExifIFD.FocalLengthIn35mmFilm, piexif.ExifIFD.LensModel,
    piexif.ExifIFD.LensMake, piexif.ExifIFD.ExposureBiasValue, piexif.ExifIFD.Flash,
    piexif.ExifIFD.WhiteBalance, piexif.ExifIFD.PixelXDimension, piexif.ExifIFD.PixelYDimension];
  const r = emptyExif();
  for (const t of keep0) if (exif['0th'][t] != null) r['0th'][t] = exif['0th'][t];
  for (const t of keepX) if (exif.Exif[t] != null) r.Exif[t] = exif.Exif[t];
  r.GPS = exif.GPS || {};
  try {
    piexif.dump(r);
    return r;
  } catch {
    r.Exif = { [piexif.ExifIFD.PixelXDimension]: exif.Exif[piexif.ExifIFD.PixelXDimension],
      [piexif.ExifIFD.PixelYDimension]: exif.Exif[piexif.ExifIFD.PixelYDimension] };
    r['0th'] = { [piexif.ImageIFD.Orientation]: 1, [piexif.ImageIFD.Software]: SOFTWARE };
    return r;
  }
}

function toDms(deg) {
  const d = Math.floor(deg);
  const mFloat = (deg - d) * 60;
  const m = Math.floor(mFloat);
  const s = Math.round((mFloat - m) * 60 * 10000);
  return [[d, 1], [m, 1], [s, 10000]];
}

function rational(value, denom) {
  return [Math.round(value * denom), denom];
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatExifDate(d) {
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// EXIF-Zeit ist Ortszeit ohne Zone → als lokale Zeit interpretieren.
function parseExifDate(s) {
  const m = s && s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function formatExposure([num, den]) {
  if (!den) return null;
  const v = num / den;
  if (v >= 1) return `${round(v, 1)} s`;
  return `1/${Math.round(den / num)} s`;
}

function round(v, digits) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function clean(v) {
  return typeof v === 'string' ? v.replace(/\0+$/, '').trim() : '';
}

function bytesToBinary(bytes) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return s;
}

function binaryToBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
