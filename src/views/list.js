import { listEntries, getFirstThumbnail, countPhotos } from '../db.js';
import { navigate } from '../router.js';

export async function renderList({ root }) {
  const urls = [];
  const entries = await listEntries();

  root.innerHTML = `
    <header class="topbar">
      <h1>Einträge</h1>
      <a class="link" href="#/export">Export</a>
    </header>
    <main class="list-main">
      ${entries.length === 0
        ? '<p class="empty">Noch keine Einträge. Tippe auf das Plus, um zu starten.</p>'
        : '<ul class="entry-list"></ul>'}
    </main>
    <button class="fab" type="button" aria-label="Neuer Eintrag">+</button>
  `;

  root.querySelector('.fab').addEventListener('click', () => navigate('/entry/new'));

  const ul = root.querySelector('.entry-list');
  if (ul) {
    for (const entry of entries) {
      const li = document.createElement('li');
      li.className = 'entry-row';
      li.tabIndex = 0;
      li.setAttribute('role', 'button');

      const thumb = await getFirstThumbnail(entry.id);
      const count = await countPhotos(entry.id);
      let thumbHtml = '<div class="thumb thumb-empty">—</div>';
      if (thumb) {
        const url = URL.createObjectURL(thumb);
        urls.push(url);
        thumbHtml = `<img class="thumb" src="${url}" alt="" />`;
      }

      const created = new Date(entry.createdAt).toLocaleString('de-DE', {
        dateStyle: 'short',
        timeStyle: 'short',
      });
      const hasGps = entry.lat != null && entry.lng != null;
      const meta = [created];
      if (hasGps) meta.push('GPS');
      if (count > 0) meta.push(`${count} Foto${count === 1 ? '' : 's'}`);

      li.innerHTML = `
        ${thumbHtml}
        <div class="entry-text">
          <div class="entry-name">${escapeHtml(entry.name || '(ohne Name)')}</div>
          <div class="entry-meta">${meta.join(' · ')}</div>
        </div>
        <div class="chev">›</div>
      `;
      li.addEventListener('click', () => navigate(`/entry/${entry.id}`));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(`/entry/${entry.id}`);
        }
      });
      ul.appendChild(li);
    }
  }

  return {
    cleanup() {
      urls.forEach((u) => URL.revokeObjectURL(u));
    },
  };
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
