import Dexie from 'dexie';

export const db = new Dexie('feld-app');

db.version(1).stores({
  entries: '++id, createdAt, updatedAt',
  photos: '++id, entryId',
});

export async function listEntries() {
  return db.entries.orderBy('createdAt').reverse().toArray();
}

export async function getEntry(id) {
  return db.entries.get(Number(id));
}

export async function addEntry(data) {
  const now = Date.now();
  return db.entries.add({ ...data, createdAt: now, updatedAt: now });
}

export async function updateEntry(id, patch) {
  return db.entries.update(Number(id), { ...patch, updatedAt: Date.now() });
}

export async function deleteEntry(id) {
  const numId = Number(id);
  await db.transaction('rw', db.entries, db.photos, async () => {
    await db.photos.where('entryId').equals(numId).delete();
    await db.entries.delete(numId);
  });
}

export async function addPhoto({ entryId, blob, thumbnail }) {
  return db.photos.add({
    entryId: Number(entryId),
    blob,
    thumbnail,
    takenAt: Date.now(),
  });
}

export async function deletePhoto(id) {
  return db.photos.delete(Number(id));
}

export async function getPhotosForEntry(entryId) {
  return db.photos.where('entryId').equals(Number(entryId)).toArray();
}

export async function getFirstThumbnail(entryId) {
  const photo = await db.photos.where('entryId').equals(Number(entryId)).first();
  return photo?.thumbnail ?? null;
}

export async function countPhotos(entryId) {
  return db.photos.where('entryId').equals(Number(entryId)).count();
}
