import './styles.css';
import { route, startRouter } from './router.js';
import { renderList } from './views/list.js';
import { renderEditor } from './views/editor.js';
import { renderExport } from './views/export.js';
import { registerSW } from 'virtual:pwa-register';

route('/', renderList);
route('/entry/new', ({ root }) => renderEditor({ root, params: { id: null } }));
route('/entry/:id', renderEditor);
route('/export', renderExport);

startRouter();

if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}
