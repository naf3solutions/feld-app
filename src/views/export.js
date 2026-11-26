import { listEntries } from '../db.js';
import { buildExportZip, triggerDownload } from '../lib/zip.js';
import { navigate } from '../router.js';
import { BUILD_LABEL } from '../lib/build-info.js';

export async function renderExport({ root }) {
  const entries = await listEntries();

  root.innerHTML = `
    <header class="topbar">
      <a class="link" href="#/" data-action="back">← Zurück</a>
      <h1>Export<small>${BUILD_LABEL}</small></h1>
      <span></span>
    </header>
    <main class="editor">
      <p>Insgesamt <strong>${entries.length}</strong> Eintr${entries.length === 1 ? 'ag' : 'äge'} gespeichert.</p>

      <fieldset class="field">
        <legend class="label">Format der Datentabelle</legend>
        <label class="radio">
          <input type="radio" name="fmt" value="csv" checked />
          <span>CSV (für Excel)</span>
        </label>
        <label class="radio">
          <input type="radio" name="fmt" value="json" />
          <span>JSON</span>
        </label>
      </fieldset>

      <p class="hint">
        Das ZIP enthält die Tabelle und alle Fotos im Unterordner <code>photos/</code>.
        Jedes Foto bekommt eine eigene Zeile (Spalte <code>photo</code> = Dateiname, dazu die Kameradaten <code>photoCamera</code> … <code>photoFocalLength35mm</code>);
        die Eintragsdaten werden dabei wiederholt. Einträge ohne Foto stehen in einer Zeile mit leeren Foto-Spalten.
        Die Fotos tragen EXIF-Daten inkl. der GPS-Position des Eintrags.
        Die CSV nutzt Semikolon als Feldtrenner und Komma als Dezimaltrennzeichen (Excel-DE-Standard).
      </p>

      <div class="actions">
        <button type="button" class="btn primary" id="btn-zip" ${entries.length === 0 ? 'disabled' : ''}>
          ZIP herunterladen
        </button>
      </div>
      <p class="hint" id="export-msg" role="status"></p>
    </main>
  `;

  root.querySelector('[data-action="back"]').addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/');
  });

  root.querySelector('#btn-zip').addEventListener('click', async () => {
    const fmt = root.querySelector('input[name="fmt"]:checked').value;
    const btn = root.querySelector('#btn-zip');
    const msg = root.querySelector('#export-msg');
    btn.disabled = true;
    msg.textContent = 'Erstelle ZIP…';
    msg.classList.remove('error');
    try {
      const blob = await buildExportZip({ format: fmt });
      const stamp = new Date().toISOString().slice(0, 10);
      triggerDownload(blob, `feld-export-${stamp}.zip`);
      msg.textContent = 'Download gestartet.';
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('error');
    } finally {
      btn.disabled = false;
    }
  });

  return null;
}
