import JSZip from 'jszip';
import { listEntries, getPhotosForEntry } from '../db.js';
import { toCsv } from './csv.js';
import { readExif, emptyExif, setGps, insertExif, summarizeExif } from './exif.js';

const COLUMNS = [
  'id', 'name',
  'lat', 'lng', 'accuracy',
  'altitude', 'altitudeAccuracy', 'heading', 'speed',
  'gpsTimestamp', 'createdAt', 'updatedAt',
  'notes', 'photos',
  'photoCamera', 'photoLens', 'photoTakenAt', 'photoExposure',
  'photoFNumber', 'photoISO', 'photoFocalLength', 'photoFocalLength35mm',
];

// Foto-Metadaten: ein Wert pro Foto, mit | getrennt (gleiche Reihenfolge wie 'photos').
const PHOTO_META_COLUMNS = {
  photoCamera: (m) => m.camera,
  photoLens: (m) => m.lens,
  photoTakenAt: (m) => (m.dateTimeOriginal ? new Date(m.dateTimeOriginal).toISOString() : null),
  photoExposure: (m) => m.exposureTime,
  photoFNumber: (m) => decimal(m.fNumber),
  photoISO: (m) => m.iso,
  photoFocalLength: (m) => decimal(m.focalLength),
  photoFocalLength35mm: (m) => m.focalLength35mm,
};

function decimal(v) {
  return v == null ? null : String(v).replace('.', ',');
}

const NUMERIC_COLUMNS = new Set([
  'lat', 'lng', 'accuracy',
  'altitude', 'altitudeAccuracy', 'heading', 'speed',
]);

export async function buildExportZip({ format = 'csv' } = {}) {
  const zip = new JSZip();
  const entries = await listEntries();
  const rows = [];

  for (const entry of entries) {
    const photos = await getPhotosForEntry(entry.id);
    const filenames = [];
    const metas = [];
    const gps = entry.lat != null ? entry : null;
    for (let i = 0; i < photos.length; i++) {
      const filename = `entry-${entry.id}-${i + 1}.jpg`;
      filenames.push(filename);
      const { blob, meta } = await exportPhoto(photos[i], gps);
      zip.file(`photos/${filename}`, blob);
      metas.push({ file: filename, ...meta });
    }
    rows.push({
      id: entry.id,
      name: entry.name ?? '',
      lat: entry.lat,
      lng: entry.lng,
      accuracy: entry.accuracy,
      altitude: entry.altitude,
      altitudeAccuracy: entry.altitudeAccuracy,
      heading: entry.heading,
      speed: entry.speed,
      gpsTimestamp: entry.gpsTimestamp ? new Date(entry.gpsTimestamp).toISOString() : null,
      createdAt: new Date(entry.createdAt).toISOString(),
      updatedAt: new Date(entry.updatedAt).toISOString(),
      notes: entry.notes ?? '',
      photos: filenames.join('|'),
      ...(format === 'json'
        ? { photoMeta: metas }
        : Object.fromEntries(Object.entries(PHOTO_META_COLUMNS).map(([col, get]) => [
          col,
          metas.some((m) => get(m) != null) ? metas.map((m) => get(m) ?? '').join('|') : null,
        ]))),
    });
  }

  if (format === 'json') {
    zip.file('entries.json', JSON.stringify(rows, null, 2));
  } else {
    zip.file('entries.csv', toCsv(rows, COLUMNS, NUMERIC_COLUMNS));
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

// Schreibt die aktuelle GPS-Position des Eintrags ins Foto-EXIF
// (falls nach der Aufnahme neu gemessen wurde) und liefert die Metadaten.
async function exportPhoto(photo, gps) {
  let exif = photo.exif ? structuredClone(photo.exif) : await readExif(photo.blob);
  const meta = photo.meta ?? summarizeExif(exif);
  if (!gps) return { blob: photo.blob, meta };
  try {
    exif = exif ?? emptyExif();
    setGps(exif, gps);
    return { blob: await insertExif(photo.blob, exif), meta };
  } catch (err) {
    console.warn('[export] GPS konnte nicht ins Foto geschrieben werden', err);
    return { blob: photo.blob, meta };
  }
}

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
