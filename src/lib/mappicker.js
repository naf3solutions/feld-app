// Vollbild-Karte zum Korrigieren der Position: Stecknadel verschieben oder
// auf die richtige Stelle tippen, dann „Übernehmen“.
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

const LAYERS = {
  sat: {
    label: 'Luftbild',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      maxNativeZoom: 19, maxZoom: 21,
      attribution: 'Luftbild © Esri, Maxar, Earthstar Geographics',
    },
  },
  osm: {
    label: 'Karte',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      maxNativeZoom: 19, maxZoom: 21,
      attribution: '© OpenStreetMap-Mitwirkende',
    },
  },
};
const LAYER_KEY = 'feld-app.mapLayer';

const PIN_SVG = `<svg viewBox="0 0 32 44" width="32" height="44" aria-hidden="true">
  <path d="M16 1C7.7 1 1 7.6 1 15.8 1 27 16 43 16 43s15-16 15-27.2C31 7.6 24.3 1 16 1z" fill="#ef4444" stroke="#ffffff" stroke-width="2"/>
  <circle cx="16" cy="16" r="5.5" fill="#ffffff"/>
</svg>`;

/**
 * Öffnet die Karte. Liefert { lat, lng } bei „Übernehmen“, sonst null.
 * gps: aktuelle Position des Eintrags; measured: ursprüngliche GPS-Messung
 * (für „Zurück auf GPS“ und den Genauigkeitskreis); externalUrl: Link zur
 * Karten-App des Geräts.
 */
export function openMapPicker({ gps, measured = null, label = '', externalUrl = null }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'map-overlay';
    overlay.innerHTML = `
      <header class="topbar">
        <button type="button" class="link nav-back" data-act="cancel" aria-label="Abbrechen">
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
        <h1>Position korrigieren<small></small></h1>
        <button type="button" class="save-pill" data-act="ok">Übernehmen</button>
      </header>
      <div class="map-canvas"></div>
      <div class="map-panel">
        <div class="map-coords" aria-live="polite"></div>
        <div class="map-actions">
          <div class="map-seg" role="group" aria-label="Kartenart">
            <button type="button" data-layer="sat">Luftbild</button>
            <button type="button" data-layer="osm">Karte</button>
          </div>
          <button type="button" class="btn" data-act="reset">Auf GPS zurück</button>
          ${externalUrl ? '<a class="btn" data-act="external" href="#">Karten-App</a>' : ''}
        </div>
        <p class="hint">Stecknadel ziehen oder auf die richtige Stelle tippen.</p>
      </div>
    `;
    overlay.querySelector('h1 small').textContent = label;
    document.body.appendChild(overlay);
    document.body.classList.add('no-scroll');

    const start = L.latLng(gps.lat, gps.lng);
    const map = L.map(overlay.querySelector('.map-canvas'), {
      zoomControl: true,
      attributionControl: true,
      maxZoom: 21,
    }).setView(start, 19);

    let layerKey = 'sat';
    try { layerKey = localStorage.getItem(LAYER_KEY) || 'sat'; } catch { /* egal */ }
    if (!LAYERS[layerKey]) layerKey = 'sat';
    let tileLayer = null;
    const segButtons = overlay.querySelectorAll('[data-layer]');
    function setLayer(key) {
      if (tileLayer) map.removeLayer(tileLayer);
      tileLayer = L.tileLayer(LAYERS[key].url, LAYERS[key].options).addTo(map);
      layerKey = key;
      segButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layer === key)));
      try { localStorage.setItem(LAYER_KEY, key); } catch { /* egal */ }
    }
    setLayer(layerKey);
    segButtons.forEach((b) => b.addEventListener('click', () => setLayer(b.dataset.layer)));

    const origin = measured && measured.lat != null ? measured : gps;
    if (origin.accuracy != null) {
      L.circle([origin.lat, origin.lng], {
        radius: origin.accuracy,
        color: '#60a5fa', weight: 2, fillColor: '#60a5fa', fillOpacity: 0.15, interactive: false,
      }).addTo(map);
      L.circleMarker([origin.lat, origin.lng], {
        radius: 5, color: '#ffffff', weight: 2, fillColor: '#2563eb', fillOpacity: 1, interactive: false,
      }).addTo(map);
    }

    const marker = L.marker(start, {
      draggable: true,
      autoPan: true,
      icon: L.divIcon({ className: 'map-pin', html: PIN_SVG, iconSize: [32, 44], iconAnchor: [16, 43] }),
      keyboard: false,
    }).addTo(map);

    const coords = overlay.querySelector('.map-coords');
    function showCoords() {
      const p = marker.getLatLng();
      const d = map.distance(p, [origin.lat, origin.lng]);
      coords.textContent = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`
        + (d >= 0.5 ? ` · ${d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(2) + ' km'} vom GPS-Punkt` : '');
    }
    marker.on('drag dragend', showCoords);
    map.on('click', (e) => { marker.setLatLng(e.latlng); showCoords(); });
    showCoords();
    // Größe nach dem Einblenden neu berechnen (sonst graue Ränder)
    requestAnimationFrame(() => map.invalidateSize());

    function close(result) {
      map.remove();
      overlay.remove();
      document.body.classList.remove('no-scroll');
      resolve(result);
    }
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => close(null));
    overlay.querySelector('[data-act="ok"]').addEventListener('click', () => {
      const p = marker.getLatLng();
      close({ lat: p.lat, lng: p.lng });
    });
    overlay.querySelector('[data-act="reset"]').addEventListener('click', () => {
      marker.setLatLng([origin.lat, origin.lng]);
      map.panTo([origin.lat, origin.lng]);
      showCoords();
    });
    overlay.querySelector('[data-act="external"]')?.addEventListener('click', (e) => {
      const p = marker.getLatLng();
      e.currentTarget.href = externalUrl({ lat: p.lat, lng: p.lng });
    });
  });
}
