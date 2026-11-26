import {
  getEntry, addEntry, updateEntry, deleteEntry,
  getPhotosForEntry, addPhoto, deletePhoto,
} from '../db.js';
import { navigate } from '../router.js';
import { getCurrentPosition } from '../lib/geo.js';
import { pickPhoto, processPhoto } from '../lib/camera.js';
import { BUILD_LABEL } from '../lib/build-info.js';

export async function renderEditor({ root, params }) {
  const isNew = params.id == null || params.id === 'new';
  const entry = isNew
    ? { name: '', notes: '', lat: null, lng: null, accuracy: null, altitude: null, altitudeAccuracy: null, heading: null, speed: null, gpsTimestamp: null }
    : await getEntry(params.id);

  if (!isNew && !entry) {
    root.innerHTML = `<header class="topbar"><a class="link" href="#/">← Zurück</a></header><p class="empty">Eintrag nicht gefunden.</p>`;
    return null;
  }

  const state = {
    name: entry.name ?? '',
    notes: entry.notes ?? '',
    gps: entry.lat != null ? {
      lat: entry.lat, lng: entry.lng, accuracy: entry.accuracy,
      altitude: entry.altitude, altitudeAccuracy: entry.altitudeAccuracy,
      heading: entry.heading, speed: entry.speed, gpsTimestamp: entry.gpsTimestamp,
    } : null,
    gpsCandidate: null,
    entryId: isNew ? null : Number(params.id),
  };
  const objectUrls = [];

  root.innerHTML = `
    <header class="topbar">
      <a class="link" href="#/" data-action="back">← Zurück</a>
      <h1>${isNew ? 'Neuer Eintrag' : 'Eintrag bearbeiten'}<small>${BUILD_LABEL}</small></h1>
      <span></span>
    </header>
    <main class="editor">
      <label class="field">
        <span class="label">Name</span>
        <input type="text" id="f-name" autocomplete="off" inputmode="text" />
      </label>

      <section class="field">
        <span class="label">GPS</span>
        <div id="gps-section"></div>
        <p class="hint" id="gps-msg" role="status"></p>
      </section>

      <section class="field">
        <span class="label">Fotos</span>
        <div class="photo-grid" id="photo-grid"></div>
        <button type="button" class="btn" id="btn-photo">Foto aufnehmen</button>
        <p class="hint" id="photo-msg" role="status"></p>
      </section>

      <label class="field">
        <span class="label">Notiz</span>
        <textarea id="f-notes" rows="4"></textarea>
      </label>

      <div class="actions">
        <button type="button" class="btn primary" id="btn-save">Speichern</button>
        ${isNew ? '' : '<button type="button" class="btn danger" id="btn-delete">Löschen</button>'}
      </div>
    </main>
  `;

  const nameInput = root.querySelector('#f-name');
  const notesInput = root.querySelector('#f-notes');
  nameInput.value = state.name;
  notesInput.value = state.notes;
  autoGrow(notesInput);
  notesInput.addEventListener('input', () => autoGrow(notesInput));

  renderGpsSection();
  await renderPhotos();

  root.querySelector('#btn-photo').addEventListener('click', onAddPhoto);
  root.querySelector('#btn-save').addEventListener('click', onSave);
  if (!isNew) {
    root.querySelector('#btn-delete').addEventListener('click', onDelete);
  }
  root.querySelector('[data-action="back"]').addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/');
  });

  function renderGpsLines(g) {
    // Zeile 1: Koordinaten + horizontale Genauigkeit (immer vorhanden).
    const acc = g.accuracy != null ? ` · ±${Math.round(g.accuracy)} m` : '';
    const line1 = `${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}${acc}`;

    // Zeile 2: optionale Felder (Höhe, Richtung, Geschwindigkeit, Uhrzeit).
    const extras = [];
    if (g.altitude != null) {
      const altAcc = g.altitudeAccuracy != null ? ` ±${Math.round(g.altitudeAccuracy)}` : '';
      extras.push(`H ${Math.round(g.altitude)}${altAcc} m`);
    }
    if (g.heading != null) extras.push(`${Math.round(g.heading)}°`);
    if (g.speed != null) extras.push(`${g.speed.toFixed(1)} m/s`);
    if (g.gpsTimestamp) {
      extras.push(new Date(g.gpsTimestamp).toLocaleTimeString('de-DE', {
        hour: '2-digit', minute: '2-digit',
      }));
    }

    const line2Html = extras.length
      ? `<div class="gps-line gps-line-2">${extras.join(' · ')}</div>`
      : '';
    return `<div class="gps-line">${line1}</div>${line2Html}`;
  }

  function pickDefault(oldGps, newGps) {
    const oldAcc = oldGps?.accuracy;
    const newAcc = newGps?.accuracy;
    if (oldAcc == null && newAcc == null) return 'new';
    if (oldAcc == null) return 'new';
    if (newAcc == null) return 'old';
    return oldAcc <= newAcc ? 'old' : 'new';
  }

  function renderGpsSection() {
    const section = root.querySelector('#gps-section');

    if (state.gpsCandidate) {
      const preferred = pickDefault(state.gps, state.gpsCandidate);
      section.innerHTML = `
        <div class="gps-box gps-choices">
          <label class="gps-choice">
            <input type="radio" name="gps-pick" value="old" ${preferred === 'old' ? 'checked' : ''} />
            <div class="gps-choice-body">
              <div class="gps-choice-label">Gespeichert</div>
              ${renderGpsLines(state.gps)}
            </div>
          </label>
          <label class="gps-choice">
            <input type="radio" name="gps-pick" value="new" ${preferred === 'new' ? 'checked' : ''} />
            <div class="gps-choice-body">
              <div class="gps-choice-label">Neu gemessen</div>
              ${renderGpsLines(state.gpsCandidate)}
            </div>
          </label>
        </div>
        <div class="gps-actions">
          <button type="button" class="btn" id="btn-gps-cancel">Neuen Wert verwerfen</button>
          <button type="button" class="btn primary" id="btn-gps-confirm">Übernehmen</button>
        </div>
      `;
      section.querySelector('#btn-gps-cancel').addEventListener('click', () => {
        state.gpsCandidate = null;
        renderGpsSection();
      });
      section.querySelector('#btn-gps-confirm').addEventListener('click', () => {
        const pick = section.querySelector('input[name="gps-pick"]:checked')?.value;
        if (pick === 'new') state.gps = state.gpsCandidate;
        state.gpsCandidate = null;
        renderGpsSection();
      });
    } else if (state.gps) {
      section.innerHTML = `
        <div class="gps-box">${renderGpsLines(state.gps)}</div>
        <button type="button" class="btn" id="btn-gps">Erneut messen</button>
      `;
      section.querySelector('#btn-gps').addEventListener('click', onGetGps);
    } else {
      section.innerHTML = `
        <div class="gps-box"><p class="muted">Noch nicht ermittelt.</p></div>
        <button type="button" class="btn" id="btn-gps">Standort holen</button>
      `;
      section.querySelector('#btn-gps').addEventListener('click', onGetGps);
    }
  }

  async function onGetGps() {
    const btn = root.querySelector('#btn-gps');
    const msg = root.querySelector('#gps-msg');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Messe…';
    }
    msg.textContent = '';
    msg.classList.remove('error');
    try {
      const measurement = await getCurrentPosition();
      if (state.gps) {
        state.gpsCandidate = measurement;
      } else {
        state.gps = measurement;
      }
      renderGpsSection();
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('error');
      renderGpsSection();
    }
  }

  async function ensureEntryId() {
    if (state.entryId != null) return state.entryId;
    const id = await addEntry(collectData());
    state.entryId = id;
    return id;
  }

  async function onAddPhoto() {
    const msg = root.querySelector('#photo-msg');
    msg.textContent = '';
    msg.classList.remove('error');
    try {
      const file = await pickPhoto();
      if (!file) return;
      msg.textContent = 'Verarbeite Foto…';
      const { blob, thumbnail, exif, meta } = await processPhoto(file, { gps: state.gps });
      const entryId = await ensureEntryId();
      await addPhoto({ entryId, blob, thumbnail, exif, meta });
      msg.textContent = '';
      await renderPhotos();
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('error');
    }
  }

  async function renderPhotos() {
    const grid = root.querySelector('#photo-grid');
    objectUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    grid.innerHTML = '';
    if (state.entryId == null) {
      grid.innerHTML = '<p class="muted">Noch keine Fotos.</p>';
      return;
    }
    const photos = await getPhotosForEntry(state.entryId);
    if (photos.length === 0) {
      grid.innerHTML = '<p class="muted">Noch keine Fotos.</p>';
      return;
    }
    for (const photo of photos) {
      const url = URL.createObjectURL(photo.thumbnail);
      objectUrls.push(url);
      const tile = document.createElement('div');
      tile.className = 'photo-tile';
      tile.innerHTML = `
        <img src="${url}" alt="" />
        <button type="button" class="photo-del" aria-label="Foto löschen">×</button>
      `;
      tile.querySelector('.photo-del').addEventListener('click', async () => {
        if (!confirm('Dieses Foto löschen?')) return;
        await deletePhoto(photo.id);
        await renderPhotos();
      });
      grid.appendChild(tile);
    }
  }

  function collectData() {
    const g = state.gps ?? {};
    return {
      name: nameInput.value.trim(),
      notes: notesInput.value,
      lat: g.lat ?? null,
      lng: g.lng ?? null,
      accuracy: g.accuracy ?? null,
      altitude: g.altitude ?? null,
      altitudeAccuracy: g.altitudeAccuracy ?? null,
      heading: g.heading ?? null,
      speed: g.speed ?? null,
      gpsTimestamp: g.gpsTimestamp ?? null,
    };
  }

  async function onSave() {
    const data = collectData();
    if (state.entryId == null) {
      await addEntry(data);
    } else {
      await updateEntry(state.entryId, data);
    }
    navigate('/');
  }

  async function onDelete() {
    if (!confirm('Diesen Eintrag inklusive aller Fotos löschen?')) return;
    await deleteEntry(state.entryId);
    navigate('/');
  }

  return {
    cleanup() {
      objectUrls.forEach((u) => URL.revokeObjectURL(u));
    },
  };
}

function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';
}
