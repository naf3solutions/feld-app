import {
  getEntry, addEntry, updateEntry, deleteEntry,
  getPhotosForEntry, addPhoto, deletePhoto,
} from '../db.js';
import { navigate } from '../router.js';
import { getCurrentPosition } from '../lib/geo.js';
import { pickPhoto, processPhoto } from '../lib/camera.js';
import { suggestNamesFromPhoto, readAtPoint } from '../lib/ocr.js';
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
    selectedPhotoId: null,
  };
  const objectUrls = [];

  root.innerHTML = `
    <header class="topbar">
      <a class="link nav-back" href="#/" data-action="back" aria-label="Zurück"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></a>
      <h1>${isNew ? 'Neuer Eintrag' : 'Eintrag bearbeiten'}<small>${BUILD_LABEL}</small></h1>
      <button type="button" class="save-pill" id="btn-save-quick">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
          <path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>
          <path d="M7 3v5h8V3"/>
          <rect x="7" y="13" width="10" height="6" rx="1"/>
        </svg>
        Speichern
      </button>
    </header>
    <main class="editor">
      <div class="field">
        <label class="label" for="f-name">Name</label>
        <div class="name-row">
          <input type="text" id="f-name" autocomplete="off" inputmode="text" />
          <button type="button" class="ocr-btn" id="btn-ocr" aria-label="Name aus Foto lesen" title="Name aus Foto lesen">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>
              <path d="M7 9h10M7 12h10M7 15h6"/>
            </svg>
          </button>
        </div>
        <div class="ocr-box" id="ocr-box" role="status"></div>
      </div>

      <section class="field">
        <span class="label">GPS</span>
        <div id="gps-section"></div>
        <p class="hint" id="gps-msg" role="status"></p>
      </section>

      <section class="field">
        <span class="label">Fotos</span>
        <div class="photo-grid" id="photo-grid"></div>
        <div class="photo-actions">
          <button type="button" class="btn" id="btn-photo">Foto aufnehmen</button>
          <button type="button" class="btn" id="btn-photo-lib">Aus Mediathek wählen</button>
        </div>
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

  root.querySelector('#btn-photo').addEventListener('click', () => onAddPhoto({ camera: true }));
  root.querySelector('#btn-photo-lib').addEventListener('click', () => onAddPhoto({ camera: false }));
  root.querySelector('#btn-save').addEventListener('click', onSave);
  root.querySelector('#btn-save-quick').addEventListener('click', onSave);
  root.querySelector('#btn-ocr').addEventListener('click', () => onOcr());
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

  async function onAddPhoto({ camera = true } = {}) {
    const msg = root.querySelector('#photo-msg');
    msg.textContent = '';
    msg.classList.remove('error');
    try {
      const file = await pickPhoto({ camera });
      if (!file) return;
      msg.textContent = 'Verarbeite Foto…';
      const { blob, thumbnail, exif, meta, hadOriginalExif } = await processPhoto(file, { gps: state.gps });
      const entryId = await ensureEntryId();
      const source = { type: file.type, size: file.size, hadExif: hadOriginalExif };
      const photoId = await addPhoto({ entryId, blob, thumbnail, exif, meta, source });
      state.selectedPhotoId = photoId;
      await renderPhotos();
      // Noch kein Name? → Schild im neuen Foto lesen und Vorschläge zeigen.
      if (!nameInput.value.trim()) onOcr({ photoId, auto: true });
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
    if (!photos.some((p) => p.id === state.selectedPhotoId)) state.selectedPhotoId = null;
    for (const photo of photos) {
      const url = URL.createObjectURL(photo.thumbnail);
      objectUrls.push(url);
      const tile = document.createElement('div');
      tile.className = 'photo-tile' + (photo.id === state.selectedPhotoId ? ' selected' : '');
      tile.innerHTML = `
        <img src="${url}" alt="Foto anzeigen" />
        <button type="button" class="photo-del" aria-label="Foto löschen">×</button>
      `;
      tile.querySelector('img').addEventListener('click', () => {
        state.selectedPhotoId = state.selectedPhotoId === photo.id ? null : photo.id;
        grid.querySelectorAll('.photo-tile').forEach((t) => t.classList.remove('selected'));
        if (state.selectedPhotoId != null) tile.classList.add('selected');
        showPhotoInfo(photos.find((p) => p.id === state.selectedPhotoId));
      });
      tile.querySelector('.photo-del').addEventListener('click', async () => {
        if (!confirm('Dieses Foto löschen?')) return;
        await deletePhoto(photo.id);
        await renderPhotos();
      });
      grid.appendChild(tile);
    }
    showPhotoInfo(photos.find((p) => p.id === state.selectedPhotoId));
  }

  // ---------- Schrifterkennung für den Namen ----------

  async function pickOcrPhoto(photoId) {
    if (state.entryId == null) return null;
    const photos = await getPhotosForEntry(state.entryId);
    const id = photoId ?? state.selectedPhotoId;
    return photos.find((p) => p.id === id) ?? photos[photos.length - 1] ?? null;
  }

  function renderOcrBox({ status = '', error = false, suggestions = null, photo = null } = {}) {
    const box = root.querySelector('#ocr-box');
    box.innerHTML = '';
    if (status) {
      const p = document.createElement('p');
      p.className = 'hint' + (error ? ' error' : '');
      p.textContent = status;
      box.appendChild(p);
    }
    if (!suggestions) return;
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const text of suggestions) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = text;
      chip.addEventListener('click', () => {
        nameInput.value = text;
        renderOcrBox();
      });
      chips.appendChild(chip);
    }
    if (photo) {
      const tap = document.createElement('button');
      tap.type = 'button';
      tap.className = 'chip chip-alt';
      tap.textContent = 'Auf Schild tippen…';
      tap.addEventListener('click', () => openTapOverlay(photo));
      chips.appendChild(tap);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'chip chip-alt';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Vorschläge schließen');
    close.addEventListener('click', () => renderOcrBox());
    chips.appendChild(close);
    box.appendChild(chips);
  }

  async function onOcr({ photoId = null, auto = false } = {}) {
    const photo = await pickOcrPhoto(photoId);
    if (!photo) {
      renderOcrBox({ status: 'Erst ein Foto vom Schild aufnehmen.', error: true });
      return;
    }
    const btn = root.querySelector('#btn-ocr');
    btn.disabled = true;
    try {
      renderOcrBox({ status: 'Suche Schild…' });
      const results = await suggestNamesFromPhoto(photo.blob, {
        onStatus: (s) => renderOcrBox({ status: s }),
      });
      if (results.length) {
        renderOcrBox({ status: 'Name übernehmen:', suggestions: results.map((r) => r.text), photo });
      } else {
        renderOcrBox({
          status: auto ? 'Kein Schild erkannt.' : 'Kein Schild erkannt – tippe im Foto auf das Schild.',
          suggestions: [], photo,
        });
      }
    } catch (err) {
      console.error('[ocr]', err);
      renderOcrBox({ status: `Texterkennung fehlgeschlagen: ${err.message}`, error: true });
    } finally {
      btn.disabled = false;
    }
  }

  function openTapOverlay(photo) {
    const url = URL.createObjectURL(photo.blob);
    const overlay = document.createElement('div');
    overlay.className = 'tap-overlay';
    overlay.innerHTML = `
      <p class="tap-hint">Tippe auf das Schild</p>
      <img src="${url}" alt="Foto" />
      <button type="button" class="btn">Abbrechen</button>
    `;
    const closeOverlay = () => {
      overlay.remove();
      URL.revokeObjectURL(url);
    };
    overlay.querySelector('button').addEventListener('click', () => {
      closeOverlay();
      renderOcrBox();
    });
    overlay.querySelector('img').addEventListener('click', async (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const relX = (e.clientX - r.left) / r.width;
      const relY = (e.clientY - r.top) / r.height;
      closeOverlay();
      try {
        renderOcrBox({ status: 'Lese Schild…' });
        const res = await readAtPoint(photo.blob, relX, relY, {
          onStatus: (s) => renderOcrBox({ status: s }),
        });
        if (res?.lines.length) {
          renderOcrBox({ status: 'Name übernehmen:', suggestions: res.lines.slice(0, 5), photo });
        } else {
          renderOcrBox({ status: 'An dieser Stelle keinen Text erkannt.', suggestions: [], photo });
        }
      } catch (err) {
        console.error('[ocr]', err);
        renderOcrBox({ status: `Texterkennung fehlgeschlagen: ${err.message}`, error: true });
      }
    });
    document.body.appendChild(overlay);
  }

  function showPhotoInfo(photo) {
    const msg = root.querySelector('#photo-msg');
    msg.classList.remove('error');
    msg.textContent = photo ? describePhoto(photo) : '';
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

// Kurzinfo zu einem gespeicherten Foto: Aufnahmezeit + Kameradaten bzw.
// Hinweis, dass der Browser keine geliefert hat.
function describePhoto(photo) {
  const meta = photo.meta ?? {};
  const time = new Date(meta.dateTimeOriginal ?? photo.takenAt).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const parts = [
    meta.camera,
    meta.exposureTime,
    meta.fNumber != null ? `f/${String(meta.fNumber).replace('.', ',')}` : null,
    meta.iso != null ? `ISO ${meta.iso}` : null,
    meta.focalLength != null ? `${String(meta.focalLength).replace('.', ',')} mm` : null,
  ].filter(Boolean);
  if (parts.length) return `${time} · ${parts.join(' · ')}`;
  const src = photo.source;
  if (!src) return `${time} · keine Kameradaten gespeichert (Foto vor dem EXIF-Update)`;
  const fileInfo = `${src.type || 'unbekannter Typ'}, ${Math.round(src.size / 1024)} KB`;
  return src.hadExif
    ? `${time} · EXIF erhalten, aber ohne Kameradaten (${fileInfo})`
    : `${time} · keine Kameradaten vom Browser erhalten (${fileInfo})`;
}

function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';
}
