// Funciones de `Backend` que en escritorio abren diálogos del sistema y en
// Android usan el selector de archivos, «Guardar como…» y la impresión del sistema.
import type { Backend } from '../api';
import type { ExportOptions, MergeItem, MergeOptions } from '../types';
import type { SyncConfig } from '../types';
import { FolioAuth, FolioFiles, FolioPrint, FolioSecrets } from './plugins';
import { App as CapApp } from '@capacitor/app';

const MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf', html: 'text/html', md: 'text/markdown', csv: 'text/csv', txt: 'text/plain',
  doc: 'application/msword', odt: 'application/vnd.oasis.opendocument.text', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint', epub: 'application/epub+zip', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', rtf: 'application/rtf',
};
const IMPORT_MIMES = [MIME.docx, 'text/markdown', 'text/html', 'text/plain', 'application/octet-stream'];

const mimeOf = (name: string) => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

/** Papel y orientación del documento abierto (para generar el PDF). */
function pageOfOpenDoc(): { paper: string; landscape: boolean } {
  const setup = (window as any).folio?.doc?.setup;
  return { paper: setup?.paper ?? 'A4', landscape: setup?.orientation === 'landscape' };
}

export function androidOverrides(core: Backend): Partial<Backend> {
  // Los métodos del núcleo que solo existen por ruta no están en el tipo de escritorio
  const c = core as Backend & { ExportDocxTo(id: string, o: ExportOptions, path: string): Promise<void> };

  /** Escribe con `write` en un archivo temporal y deja elegir dónde guardarlo. */
  const saveVia = async (name: string, write: (path: string) => Promise<void>): Promise<string> => {
    const { path } = await FolioFiles.tempPath({ name });
    await write(path);
    const { saved } = await FolioFiles.saveAs({ path, name, mimeType: mimeOf(name) });
    return saved ? name : '';
  };

  // ---------- Sincronización: las credenciales viven en el almacén cifrado de Android ----------
  const secretKey = (cfg: SyncConfig) => (cfg.provider === 'gdrive' ? 'gdrive' : `webdav:${cfg.url}|${cfg.user}`);
  /** Contraseña (WebDAV) o token de acceso de Google; Google lo renueva en silencio tras la primera vez. */
  const secretFor = async (cfg: SyncConfig): Promise<string> => {
    if (cfg.provider === 'gdrive') return (await FolioAuth.googleToken()).token;
    const { value } = await FolioSecrets.get({ key: secretKey(cfg) });
    if (!value) throw new Error('Falta la contraseña de la nube; vuelve a vincularla en Ajustes.');
    return value;
  };
  const currentConfig = async () => (await core.SyncStatus()).config;

  return {
    async SyncSetSecret(secret) {
      await FolioSecrets.set({ key: secretKey(await currentConfig()), value: secret });
    },
    async SyncForgetSecret() {
      await FolioSecrets.remove({ key: secretKey(await currentConfig()) });
    },
    async SyncTestStored() {
      const cfg = await currentConfig();
      await core.SyncTest(cfg, await secretFor(cfg));
    },
    async SyncRun() {
      const cfg = await currentConfig();
      if (!cfg.provider) throw new Error('No hay ninguna nube vinculada');
      return (core as any).SyncNow(await secretFor(cfg));
    },
    async SyncLinkGoogle() {
      await FolioAuth.googleToken(); // abre la pantalla de permisos de Google si hace falta
      await core.SyncConfigure({ provider: 'gdrive' });
    },

    async ExportDocx(id, opt) {
      const doc = await core.GetDoc(id);
      const name = `${doc.meta.title || 'Documento'}${opt.studentVersion ? ' (alumno)' : ''}.docx`.replace(/[\\/:*?"<>|]/g, '-');
      return saveVia(name, (p) => c.ExportDocxTo(id, opt, p));
    },

    SaveTextFile: (name, content) => saveVia(name, (p) => (core as any).WriteTextFile(p, content)),

    async OpenImportFile() {
      const { files } = await FolioFiles.pick({ mimeTypes: IMPORT_MIMES });
      return files.length ? (core as any).ImportFromPath(files[0].path) : null;
    },

    /** Google: se abre en el navegador y Android devuelve es.folio.app://auth-callback?code=… */
    async SocialSignInGoogle() {
      const url = await (core as any).SocialGoogleURL('es.folio.app://auth-callback');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { void sub.then((h) => h.remove()); reject(new Error('Se agotó el tiempo esperando a Google')); }, 5 * 60_000);
        const sub = CapApp.addListener('appUrlOpen', async ({ url: back }) => {
          if (!back.startsWith('es.folio.app://auth-callback')) return;
          clearTimeout(timer);
          void sub.then((h) => h.remove());
          const q = new URL(back).searchParams;
          const code = q.get('code');
          if (!code) { reject(new Error(q.get('error_description') || 'No se ha completado el inicio de sesión con Google')); return; }
          try { resolve(await (core as any).SocialGoogleFinish(code)); } catch (e) { reject(e); }
        });
        void FolioFiles.openUrl({ url });
      });
    },

    async UpdateInstall() {
      const path = await (core as any).UpdateDownload();
      // Android pide confirmar la instalación (y, la primera vez, permitir esta fuente)
      await FolioFiles.open({ path, mimeType: 'application/vnd.android.package-archive' });
    },

    async ChooseNoteFiles() {
      const { files } = await FolioFiles.pick({ mimeTypes: ['*/*'], multiple: true });
      return files.map((f) => ({ path: f.path, name: f.name }));
    },

    async OpenTopicFile(rel: string) {
      const path = await (core as any).AgendaTopicFilePath(rel);
      if (path) await FolioFiles.open({ path, mimeType: mimeOf(path) });
    },

    async ChoosePdfs() {
      const { files } = await FolioFiles.pick({ mimeTypes: [MIME.pdf], multiple: true });
      return files.length ? core.PdfInfo(files.map((f) => f.path)) : [];
    },

    async MergePdfs(items: MergeItem[], opt: MergeOptions) {
      const name = `${(items[0]?.name || 'PDF').replace(/[\\/:*?"<>|]/g, '-')} (unido).pdf`;
      const { path } = await FolioFiles.tempPath({ name });
      await (core as any).MergePdfsTo(items, path, opt.bookmarks);
      const { saved } = await FolioFiles.saveAs({ path, name, mimeType: MIME.pdf });
      if (saved && opt.open) await FolioFiles.open({ path, mimeType: MIME.pdf });
      return saved ? name : '';
    },

    ExportPDF: (title, html) => saveVia(`${title || 'Documento'}.pdf`.replace(/[\\/:*?"<>|]/g, '-'),
      (p) => FolioPrint.toPdf({ html, path: p, ...pageOfOpenDoc() })),

    async RenderPdfTemp(title, html) {
      const { path } = await FolioFiles.tempPath({ name: `${Date.now()}.pdf` });
      await FolioPrint.toPdf({ html, path, ...pageOfOpenDoc() });
      const [info] = await core.PdfInfo([path]);
      return { ...info, name: title };
    },

    async ChooseWorkspace() {
      throw new Error('En Android los documentos se guardan dentro de la app; usa la sincronización para tenerlos en otros equipos.');
    },
    async OpenWorkspaceFolder() { /* no existe en Android */ },
    async RevealFile() { /* no existe en Android */ },
    async OpenURL(url) { await FolioFiles.openUrl({ url }); },
    async ConfirmClose() { /* Android no cierra la app: la guarda al pasar a segundo plano */ },
  };
}
