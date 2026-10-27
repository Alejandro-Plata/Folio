// Diálogo «Sincronización»: vincular una nube (WebDAV o Google Drive), ver el
// estado, sincronizar ahora, vincular otro dispositivo con un código QR y desvincular.
import qrcode from 'qrcode-generator';
import type { App } from '../app';
import { api } from '../api';
import { isAndroid } from '../platform/platform';
import { confirmDialog, h, modal, toast } from '../ui/dom';
import { icon } from '../ui/icons';
import { relativeTimeText } from './manager';

interface PairPayload { p: 'webdav'; u: string; n: string }

export async function syncDialog(app: App) {
  const mgr = app.sync;
  const body = h('div', { class: 'sy' });
  let webdavOpen = false;
  let draft = { url: '', user: '', password: '' };
  let busy = false;

  const field = (label: string, input: HTMLElement, hint?: string) =>
    h('label', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, label), input, hint ? h('span', { class: 'muted small' }, hint) : null);

  const run = async (work: () => Promise<void>, ok?: string) => {
    if (busy) return;
    busy = true;
    render();
    try { await work(); if (ok) toast(ok, { kind: 'ok' }); }
    catch (e) { toast(String((e as Error)?.message ?? e).replace(/^Error:\s*/, ''), { kind: 'error', ms: 8000 }); }
    finally { busy = false; await mgr.refresh(); render(); }
  };

  // ---------- Sin vincular ----------

  const unlinked = (): HTMLElement[] => {
    const url = h('input', { class: 'input', type: 'url', value: draft.url, placeholder: 'https://nube.ejemplo.es/remote.php/dav/files/usuario/Folio', 'aria-label': 'Dirección del servidor' });
    const user = h('input', { class: 'input', value: draft.user, autocomplete: 'username', 'aria-label': 'Usuario' });
    const pass = h('input', { class: 'input', type: 'password', value: draft.password, autocomplete: 'current-password', 'aria-label': 'Contraseña de aplicación' });
    const keep = () => { draft = { url: url.value, user: user.value, password: pass.value }; };
    for (const i of [url, user, pass]) i.addEventListener('input', keep);

    const link = async () => {
      keep();
      const cfg = { provider: 'webdav' as const, url: draft.url.trim(), user: draft.user.trim() };
      await api.SyncTest(cfg, draft.password);
      await api.SyncConfigure(cfg);
      await api.SyncSetSecret(draft.password);
      draft.password = '';
      await mgr.refresh();
      await mgr.run('vinculación', { manual: true });
    };

    const webdavForm = h('div', { class: 'sy-form', hidden: !webdavOpen },
      h('p', { class: 'muted small' }, 'Funciona con Nextcloud, ownCloud, Synology y cualquier servidor WebDAV. Usa una contraseña de aplicación (en Nextcloud: Ajustes > Seguridad), no la de tu cuenta.'),
      field('Dirección de la carpeta', url, 'Debe empezar por https://'),
      field('Usuario', user),
      field('Contraseña de aplicación', pass),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-sm', disabled: busy, onclick: () => { keep(); void run(() => api.SyncTest({ provider: 'webdav', url: draft.url.trim(), user: draft.user.trim() }, draft.password), 'Conexión correcta'); } }, 'Probar conexión'),
        h('button', { type: 'button', class: 'btn btn-sm btn-primary', disabled: busy, onclick: () => void run(link) }, 'Vincular y sincronizar')),
      h('p', { class: 'muted small' }, 'Se juntarán los documentos de este dispositivo con los de la nube. No se borra nada.'));

    const card = (ic: string, title: string, text: string, action: HTMLElement) =>
      h('div', { class: 'sy-card' }, h('span', { class: 'sy-card-ic', html: icon(ic, 22) }), h('div', { class: 'sy-card-main' }, h('strong', {}, title), h('span', { class: 'muted small' }, text)), action);

    return [
      h('p', {}, 'Vincula una nube para tener los mismos documentos y la misma agenda en tus ordenadores y en el móvil. Los datos van directamente de tu equipo a tu nube: Folio no tiene servidores propios.'),
      card('cloud', 'Nextcloud u otro servidor WebDAV', 'Tu propia nube o la de tu centro.',
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { webdavOpen = !webdavOpen; render(); } }, webdavOpen ? 'Ocultar' : 'Elegir')),
      webdavForm,
      card('globe', 'Google Drive', 'Folio solo accede a su propia carpeta «Folio».',
        h('button', { type: 'button', class: 'btn btn-sm', disabled: busy, onclick: () => void run(async () => { await api.SyncLinkGoogle(); await mgr.refresh(); await mgr.run('vinculación', { manual: true }); }) }, 'Vincular')),
      card('qr', 'Ya tengo otro dispositivo vinculado', isAndroid ? 'Escanea el código que muestra el otro dispositivo.' : 'Pega los datos que muestra el otro dispositivo.',
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => void pair() }, isAndroid ? 'Escanear' : 'Pegar datos')),
    ];
  };

  const applyPayload = (raw: string) => {
    try {
      const p = JSON.parse(raw) as PairPayload;
      if (p.p !== 'webdav' || !p.u) throw new Error();
      draft = { url: p.u, user: p.n ?? '', password: '' };
      webdavOpen = true;
      render();
      toast('Datos recibidos. Escribe la contraseña de aplicación para terminar.', { kind: 'ok' });
    } catch { toast('Ese código no es de Folio.', { kind: 'error' }); }
  };

  const pair = async () => {
    if (isAndroid) {
      try {
        const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');
        await BarcodeScanner.requestPermissions();
        const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
        if (barcodes[0]) applyPayload(barcodes[0].rawValue);
      } catch (e) { toast(`No se pudo escanear: ${(e as Error).message}`, { kind: 'error' }); }
      return;
    }
    const ta = h('textarea', { class: 'input', rows: 3, placeholder: '{"p":"webdav","u":"https://…","n":"usuario"}' });
    const r = await modal('Pegar los datos del otro dispositivo', h('div', { class: 'ag-form' }, ta),
      [{ label: 'Cancelar', value: null, kind: 'ghost' }, { label: 'Usar', value: 'ok', kind: 'primary' }]);
    if (r === 'ok') applyPayload(ta.value);
  };

  // ---------- Vinculado ----------

  const showQr = async () => {
    const c = mgr.config!;
    const payload = JSON.stringify({ p: 'webdav', u: c.url, n: c.user } satisfies PairPayload);
    const qr = qrcode(0, 'M');
    qr.addData(payload);
    qr.make();
    await modal('Vincular otro dispositivo', h('div', { class: 'ag-form sy-qr' },
      h('div', { class: 'sy-qr-img', html: qr.createSvgTag({ scalable: true, margin: 2 }), role: 'img', 'aria-label': 'Código QR con la dirección y el usuario de la nube' }),
      h('p', {}, 'En el otro dispositivo, abre Folio > Sincronización > «Ya tengo otro dispositivo vinculado» y escanea este código. Después escribe la misma contraseña de aplicación.'),
      h('p', { class: 'muted small' }, 'El código no incluye la contraseña.'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { void navigator.clipboard?.writeText(payload); toast('Datos copiados', { kind: 'ok' }); } }, 'Copiar los datos')),
    [{ label: 'Cerrar', value: null, kind: 'primary' }]);
  };

  const linked = (): (HTMLElement | null)[] => {
    const c = mgr.config!;
    const name = c.provider === 'gdrive' ? 'Google Drive' : 'WebDAV';
    const device = h('input', { class: 'input input-sm', value: c.deviceName, 'aria-label': 'Nombre de este dispositivo' });
    device.addEventListener('change', () => void run(() => api.SyncSetDeviceName(device.value)));
    return [
      h('div', { class: `sy-status ${mgr.lastError ? 'is-error' : ''}` },
        h('span', { html: icon(mgr.lastError ? 'alert' : mgr.state === 'syncing' ? 'refresh' : 'cloudCheck', 20), class: mgr.state === 'syncing' ? 'is-spinning' : '' }),
        h('div', {}, h('strong', {}, `Vinculado con ${name}`),
          h('div', { class: 'muted small' }, c.provider === 'webdav' ? `${c.url} · ${c.user}` : 'Cuenta de Google'),
          h('div', { class: 'small', 'aria-live': 'polite' }, mgr.state === 'syncing' ? `Sincronizando… ${mgr.progress}` : `Última sincronización: ${relativeTimeText(c.lastSync)}`))),
      mgr.lastError ? h('div', { class: 'ag-banner is-inline' }, h('span', { class: 'ag-banner-ic', html: icon('alert', 16) }), h('div', {}, h('p', {}, mgr.lastError))) : null,
      field('Nombre de este dispositivo', device, 'Sale en las versiones de conflicto del historial.'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-sm btn-primary', disabled: busy || mgr.state === 'syncing', onclick: () => void run(async () => { await mgr.run('manual', { manual: true }); }) }, h('span', { html: icon('refresh', 14) }), 'Sincronizar ahora'),
        h('button', { type: 'button', class: 'btn btn-sm', disabled: busy, onclick: () => void run(() => api.SyncTestStored(), 'Conexión correcta') }, 'Probar conexión'),
        c.provider === 'webdav' ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => void showQr() }, h('span', { html: icon('qr', 14) }), 'Vincular otro dispositivo') : null,
        h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost', disabled: busy, onclick: () => void unlink() }, 'Desvincular')),
      c.provider === 'gdrive' ? h('p', { class: 'muted small' }, 'Para vincular otro dispositivo, inicia sesión con la misma cuenta de Google.') : null,
    ];
  };

  const unlink = async () => {
    if (!await confirmDialog('¿Desvincular la nube?', 'No se borra nada, ni aquí ni en la nube. Este dispositivo dejará de sincronizarse hasta que lo vincules otra vez.', 'Desvincular', true)) return;
    await run(async () => { await api.SyncForgetSecret(); await api.SyncUnlink(); }, 'Nube desvinculada');
  };

  function render() { body.replaceChildren(...(mgr.linked ? linked() : unlinked()).filter((x): x is HTMLElement => !!x)); }
  render();
  const off = mgr.onChange(() => { if (!busy) render(); });
  await modal('Sincronización', body, [{ label: 'Cerrar', value: null, kind: 'primary' }], { className: 'ag-modal sy-modal' });
  off();
}
