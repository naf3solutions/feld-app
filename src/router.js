const routes = [];
let mounted = null;

export function route(pattern, handler) {
  const keys = [];
  const regex = new RegExp(
    '^' +
      pattern.replace(/:([^/]+)/g, (_, key) => {
        keys.push(key);
        return '([^/]+)';
      }) +
      '$'
  );
  routes.push({ regex, keys, handler });
}

export function navigate(path) {
  if (location.hash === '#' + path) {
    handleRoute();
  } else {
    location.hash = path;
  }
}

async function handleRoute() {
  const path = location.hash.slice(1) || '/';
  const root = document.getElementById('app');

  if (mounted?.cleanup) {
    try { mounted.cleanup(); } catch (e) { console.error(e); }
  }
  mounted = null;
  root.innerHTML = '';

  for (const r of routes) {
    const match = path.match(r.regex);
    if (match) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(match[i + 1]); });
      const result = await r.handler({ root, params });
      mounted = result ?? null;
      return;
    }
  }
  root.textContent = 'Seite nicht gefunden.';
}

export function startRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}
