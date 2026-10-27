// Ventana de escritorio de Folio (Linux y Windows) con Electron. Se usa
// Chromium porque, a diferencia de WebKitGTK, sigue la frecuencia del monitor
// (100, 120, 144 Hz…) al desplazarse.
//
// Reparto del trabajo:
//  - El núcleo es folio-core (Go), un proceso aparte que habla por stdin/stdout
//    (ver core.ts). Toda función de la interfaz que no esté en HOST va tal cual.
//  - Aquí van los diálogos del sistema, abrir archivos y vínculos, el PDF
//    (printToPDF de Chromium), la ventana y el cierre ordenado.
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, net, protocol, screen, session, shell, type FileFilter } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Core } from './core';

const isWin = process.platform === 'win32';
const resources = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
const distDir = app.isPackaged ? path.join(app.getAppPath(), 'dist') : path.resolve(__dirname, '../../frontend/dist');
const corePath = process.env.FOLIO_CORE || path.join(resources, isWin ? 'folio-core.exe' : 'folio-core');

// Datos de la ventana (caché, almacenamiento local) junto a los ajustes de Folio, en su propia carpeta
app.setName('Folio');
app.setPath('userData', path.join(app.getPath('appData'), 'Folio', 'ventana'));

// Una sola ventana: abrir Folio otra vez trae al frente la que ya está abierta
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'folio', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

let win: BrowserWindow | null = null;
let allowClose = false;
const tempFiles: string[] = [];
const core = new Core(corePath, (name, data) => send(name, data));

function send(name: string, data: unknown[]) {
  win?.webContents.send('folio:event', name, data);
}

// ---------- Funciones que necesitan la ventana ----------

const filters = (name: string, ext: string[]): FileFilter[] => [{ name, extensions: ext }];

async function saveTo(title: string, defaultName: string, f: FileFilter[]): Promise<string> {
  // Pruebas automáticas: se guarda en esa carpeta sin preguntar
  if (process.env.FOLIO_TEST_SAVE_DIR) return path.join(process.env.FOLIO_TEST_SAVE_DIR, defaultName);
  const r = await dialog.showSaveDialog(win!, { title, defaultPath: path.join(app.getPath('documents'), defaultName), filters: f });
  if (r.canceled || !r.filePath) return '';
  const ext = f[0]?.extensions[0];
  return ext && ext !== '*' && !r.filePath.toLowerCase().endsWith(`.${ext}`) ? `${r.filePath}.${ext}` : r.filePath;
}

async function openFiles(title: string, f: FileFilter[], multi = false): Promise<string[]> {
  const r = await dialog.showOpenDialog(win!, { title, filters: f, properties: multi ? ['openFile', 'multiSelections'] : ['openFile'] });
  return r.canceled ? [] : r.filePaths;
}

/** Imprime a PDF el HTML de exportación (con las imágenes ya en rutas file://). */
async function renderPdf(html: string, out: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'folio-pdf-'));
  const src = path.join(dir, 'doc.html');
  await fs.writeFile(src, html);
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: true, offscreen: false } });
  try {
    await pdfWin.loadFile(src);
    // Fuentes incrustadas y ecuaciones listas antes de imprimir
    await pdfWin.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => r(1))))');
    const pdf = await pdfWin.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false, generateDocumentOutline: true, generateTaggedPDF: true });
    await fs.writeFile(out, pdf);
  } finally {
    pdfWin.destroy();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const safeName = (s: string) => (s || 'Documento').replace(/[\\/:*?"<>|]/g, '-').trim() || 'Documento';

/** Funciones de la interfaz que se resuelven aquí (las demás van al núcleo). */
const HOST: Record<string, (...a: any[]) => Promise<unknown> | unknown> = {
  async ExportDocx(id: string, opt: { studentVersion?: boolean }) {
    const doc = await core.call('GetDoc', [id]) as { meta: { title: string } };
    const out = await saveTo('Exportar a Word', `${safeName(doc.meta.title)}${opt.studentVersion ? ' (alumno)' : ''}.docx`, filters('Documento de Word', ['docx']));
    if (out) await core.call('ExportDocxTo', [id, opt, out]);
    return out;
  },
  async SaveTextFile(name: string, content: string, filterName: string, pattern: string) {
    const ext = pattern.replace(/^\*\./, '').split(';')[0] || '*';
    const out = await saveTo('Exportar', name, filters(filterName, [ext]));
    if (out) await core.call('WriteTextFile', [out, content]);
    return out;
  },
  async ExportPDF(title: string, html: string) {
    const out = await saveTo('Exportar a PDF', `${safeName(title)}.pdf`, filters('PDF', ['pdf']));
    if (!out) return '';
    await renderPdf(await core.call('LocalizeAssets', [html]) as string, out);
    return out;
  },
  async OpenImportFile() {
    const [p] = await openFiles('Importar documento', filters('Documentos', ['docx', 'md', 'markdown', 'html', 'htm', 'txt']));
    return p ? core.call('ImportFromPath', [p]) : null;
  },
  async ChooseNoteFiles() {
    const paths = await openFiles('Añadir apuntes', [
      ...filters('Apuntes', ['pdf', 'docx', 'doc', 'odt', 'pptx', 'ppt', 'odp', 'rtf', 'txt', 'md', 'epub', 'png', 'jpg', 'jpeg']),
      ...filters('Todos los archivos', ['*']),
    ], true);
    return paths.map((p) => ({ path: p, name: path.basename(p) }));
  },
  async ChooseWorkspace() {
    const current = await core.call('Workspace', []) as string;
    const r = await dialog.showOpenDialog(win!, { title: 'Carpeta de documentos', defaultPath: current, properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return '';
    await core.call('SwitchWorkspace', [r.filePaths[0]]);
    return r.filePaths[0];
  },
  async ChoosePdfs() {
    const paths = await openFiles('Elegir PDF', filters('PDF', ['pdf']), true);
    return paths.length ? core.call('PdfInfo', [paths]) : null;
  },
  async RenderPdfTemp(title: string, html: string) {
    const dir = path.join(os.tmpdir(), 'folio-merge');
    await fs.mkdir(dir, { recursive: true });
    const out = path.join(dir, `${safeName(title)}-${tempFiles.length}.pdf`);
    await renderPdf(await core.call('LocalizeAssets', [html]) as string, out);
    tempFiles.push(out);
    const [f] = await core.call('PdfInfo', [[out]]) as { name: string }[];
    return { ...f, name: title };
  },
  async MergePdfs(items: { name: string }[], opt: { bookmarks: boolean; open: boolean }) {
    if (items.length < 2) throw new Error('Elige al menos dos archivos para unir.');
    const out = await saveTo('Guardar PDF unido', `${safeName(items[0].name)} (unido).pdf`, filters('PDF', ['pdf']));
    if (!out) return '';
    await core.call('MergePdfsTo', [items, out, opt.bookmarks]);
    if (opt.open) void shell.openPath(out);
    return out;
  },
  OpenURL(url: string) { if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url); },
  RevealFile(p: string) { shell.showItemInFolder(p); },
  async OpenWorkspaceFolder() { await shell.openPath(await core.call('Workspace', []) as string); },
  async OpenTopicFile(rel: string) {
    const p = await core.call('AgendaTopicFilePath', [rel]) as string;
    if (!p) throw new Error('Ruta de apuntes no válida.');
    const err = await shell.openPath(p);
    if (err) throw new Error(err);
  },
  ConfirmClose() { allowClose = true; win?.close(); },
  async UpdateInstall() {
    await core.call('UpdateInstall', []);
    allowClose = true;
    // En Linux el lanzador ya es la versión nueva: se abre en cuanto esta suelta el bloqueo
    const launcher = process.env.FOLIO_LAUNCHER;
    if (!isWin && launcher) spawn('sh', ['-c', 'sleep 1; exec "$0"', launcher], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 200);
  },
};

ipcMain.handle('folio:call', async (_e, method: string, args: unknown[]) => {
  const own = HOST[method];
  return own ? own(...args) : core.call(method, args);
});
ipcMain.handle('folio:isMaximized', () => !!win?.isMaximized());
ipcMain.on('folio:window', (_e, action: string, arg?: string) => {
  if (!win) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'toggleMaximize') { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
  else if (action === 'close') win.close();
  else if (action === 'title' && typeof arg === 'string') win.setTitle(arg);
});

// ---------- Ventana ----------

function createWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 760, minHeight: 520,
    frame: false, show: false, title: 'Folio',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#191919' : '#ffffff',
    icon: isWin ? undefined : path.join(resources, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  // En pantallas pequeñas (portátiles de 13-14") la ventana no cabría entera
  if (area.width < 1360 || area.height < 970) win.maximize();
  win.once('ready-to-show', () => win?.show());
  void win.loadURL('folio://app/index.html');

  const wc = win.webContents;
  wc.setVisualZoomLevelLimits(1, 1);
  // Los vínculos se abren en el navegador, nunca dentro de Folio
  wc.setWindowOpenHandler(({ url }) => { if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (!url.startsWith('folio://')) { e.preventDefault(); if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url); } });
  wc.on('context-menu', (_e, p) => contextMenu(p));
  if (process.env.FOLIO_DEVTOOLS) wc.openDevTools({ mode: 'detach' });

  // Antes de cerrar, la interfaz guarda lo pendiente y confirma (ConfirmClose); si no responde en 3 s, se cierra igual
  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    send('app:before-close', []);
    setTimeout(() => { allowClose = true; win?.close(); }, 3000);
  });
  win.on('closed', () => { win = null; });
}

function contextMenu(p: Electron.ContextMenuParams) {
  const t: Electron.MenuItemConstructorOptions[] = [];
  if (p.misspelledWord) {
    for (const s of p.dictionarySuggestions.slice(0, 6)) t.push({ label: s, click: () => win?.webContents.replaceMisspelling(s) });
    if (!p.dictionarySuggestions.length) t.push({ label: 'Sin sugerencias', enabled: false });
    t.push({ label: 'Añadir al diccionario', click: () => session.defaultSession.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: 'separator' });
  }
  if (p.isEditable) {
    t.push({ role: 'cut', label: 'Cortar', enabled: p.editFlags.canCut }, { role: 'copy', label: 'Copiar', enabled: p.editFlags.canCopy },
      { role: 'paste', label: 'Pegar', enabled: p.editFlags.canPaste }, { type: 'separator' }, { role: 'selectAll', label: 'Seleccionar todo' });
  } else if (p.selectionText.trim()) {
    t.push({ role: 'copy', label: 'Copiar' });
  }
  if (/^https?:/i.test(p.linkURL)) {
    if (t.length) t.push({ type: 'separator' });
    t.push({ label: 'Abrir vínculo', click: () => void shell.openExternal(p.linkURL) }, { label: 'Copiar vínculo', click: () => clipboard.writeText(p.linkURL) });
  }
  if (t.length) Menu.buildFromTemplate(t).popup({ window: win ?? undefined });
}

/** folio://app/… sirve la interfaz; folio://app/files/… las imágenes de los documentos. */
function registerProtocol() {
  protocol.handle('folio', async (req) => {
    const pathname = decodeURIComponent(new URL(req.url).pathname);
    if (pathname.startsWith('/files/')) {
      try {
        const file = await core.call('AssetPath', [pathname]) as string;
        return net.fetch(pathToFileURL(file).toString());
      } catch { return new Response('', { status: 404 }); }
    }
    const file = path.join(distDir, path.normalize(pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(distDir)) return new Response('', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  // Ortografía en español (en Windows usa el corrector del sistema)
  if (!isWin) session.defaultSession.setSpellCheckerLanguages(['es-ES']);
  core.start();
  registerProtocol();
  createWindow();
}).catch((e) => { dialog.showErrorBox('Folio', String(e)); app.quit(); });

app.on('window-all-closed', () => app.quit());
app.on('will-quit', (e) => {
  if (core.stopped) return;
  e.preventDefault();
  void core.stop().finally(async () => {
    await Promise.all(tempFiles.map((f) => fs.rm(f, { force: true })));
    app.quit();
  });
});
