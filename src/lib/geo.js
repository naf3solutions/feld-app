export function getCurrentPosition({ timeout = 15000, maximumAge = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocation wird von diesem Browser nicht unterstützt.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = pos.coords;
        resolve({
          lat: c.latitude,
          lng: c.longitude,
          accuracy: c.accuracy ?? null,
          altitude: c.altitude ?? null,
          altitudeAccuracy: c.altitudeAccuracy ?? null,
          heading: Number.isFinite(c.heading) ? c.heading : null,
          speed: Number.isFinite(c.speed) ? c.speed : null,
          gpsTimestamp: pos.timestamp,
        });
      },
      (err) => {
        const messages = {
          1: 'Standortzugriff wurde verweigert. Bitte in den Browser-Einstellungen erlauben.',
          2: 'Standort konnte nicht ermittelt werden (Signal zu schwach?).',
          3: 'Standortabfrage hat zu lange gedauert.',
        };
        reject(new Error(messages[err.code] ?? err.message ?? 'Unbekannter GPS-Fehler.'));
      },
      { enableHighAccuracy: true, timeout, maximumAge }
    );
  });
}
