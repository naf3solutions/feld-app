import JSZip from 'jszip';
import { listEntries, getPhotosForEntry } from '../db.js';
import { toCsv } from './csv.js';

const COLUMNS = [
  'id', 'name',
  'lat', 'lng', 'accuracy',
  'altitude', 'altitudeAccuracy', 'heading', 'speed',
  'gpsTimestamp', 'createdAt', 'updatedAt',
  'notes', 'photos',
];

export async function buildExportZip({ format = 'csv' } = {}) {
  const zip = new JSZip();
  const entries = await listEntries();
  const rows = [];

  for (const entry of entries) {
    const photos = await getPhotosForEntry(entry.id);
    const filenames = [];
    for (let i = 0; i < photos.length; i++) {
      const filename = `entry-${entry.id}-${i + 1}.jpg`;
      filenames.push(filename);
      zip.file(`photos/${filename}`, photos[i].blob);
    }
    rows.push({
      id: entry.id,
      name: entry.name ?? '',
      lat: entry.lat ?? '',
      lng: entry.lng ?? '',
      accuracy: entry.accuracy ?? '',
      altitude: entry.altitude ?? '',
      altitudeAccuracy: entry.altitudeAccuracy ?? '',
      heading: entry.heading ?? '',
      speed: entry.speed ?? '',
      gpsTimestamp: entry.gpsTimestamp ? new Date(entry.gpsTimestamp).toISOString() : '',
      createdAt: new Date(entry.createdAt).toISOString(),
      updatedAt: new Date(entry.updatedAt).toISOString(),
      notes: entry.notes ?? '',
      photos: filenames.join(';'),
    });
  }

  if (format === 'json') {
    zip.file('entries.json', JSON.stringify(rows, null, 2));
  } else {
    zip.file('entries.csv', toCsv(rows, COLUMNS));
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
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
