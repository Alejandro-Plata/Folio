import '@fontsource-variable/inter';
import './styles.css';
import './sync/sync.css';
import './social/social.css';
import { installFontFaces } from './fonts';
import { App } from './app';
import { registerEditorDialogs } from './ui/dialogs';
import { wantsMobileUI } from './platform/platform';
import './mobile/mobile.css';

installFontFaces();
if (wantsMobileUI()) document.body.classList.add('is-mobile');
const app = new App();
app.start().then(() => registerEditorDialogs(app)).catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="padding:24px;white-space:pre-wrap">No se pudo iniciar Folio:\n${String(e?.stack ?? e)}</pre>`;
});
(window as any).folio = app;
