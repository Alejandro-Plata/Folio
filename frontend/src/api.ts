// Puente con el backend en Go (bindings de Wails). Si se abre la interfaz en un
// navegador normal (npm run dev) se usa un backend simulado en localStorage para
// poder desarrollar y probar la UI sin compilar la app.
import type {
  Doc, ExportOptions, ImportedFile, InitData, Meta, MetaPatch, PageSetup, SaveResult,
  SearchHit, Settings, Version, VersionData, PdfFile, MergeItem, MergeOptions, SyncConfig, SyncStatus, SyncResult, UpdateInfo, SocialSnapshot, DateOption } from './types';

import { agendaMock, mockFileNames, mockFileURLs, type AgendaBackend } from './agenda/mock';
import { socialMock } from './social/mock';
import { platform } from './platform/platform';
import { createAndroidBackend, onAndroidEvent } from './platform/android';

export interface Backend extends AgendaBackend {
  Init(): Promise<InitData>;
  SaveSettings(s: Settings): Promise<void>;
  ListDocs(): Promise<Meta[]>;
  GetDoc(id: string): Promise<Doc>;
  CreateDoc(r: { parentId: string; title: string; icon: string; content: string; text: string; setup: PageSetup | null }): Promise<Meta>;
  SaveDoc(id: string, content: string, text: string, words: number): Promise<SaveResult>;
  UpdateMeta(id: string, p: MetaPatch): Promise<Meta>;
  SetSetup(id: string, s: PageSetup): Promise<void>;
  TrashDoc(id: string): Promise<void>;
  RestoreDoc(id: string): Promise<void>;
  DeleteDoc(id: string): Promise<void>;
  EmptyTrash(): Promise<void>;
  DuplicateDoc(id: string): Promise<Meta>;
  Search(q: string): Promise<SearchHit[]>;
  ListVersions(id: string): Promise<Version[]>;
  GetVersion(id: string, vid: string): Promise<VersionData>;
  CreateVersion(id: string, label: string): Promise<Version>;
  RestoreVersion(id: string, vid: string): Promise<Doc>;
  RenameVersion(id: string, vid: string, label: string): Promise<void>;
  DeleteVersion(id: string, vid: string): Promise<void>;
  SaveImage(docId: string, name: string, b64: string): Promise<string>;
  ExportDocx(id: string, opt: ExportOptions): Promise<string>;
  ExportPDF(title: string, html: string): Promise<string>;
  SaveTextFile(name: string, content: string, filterName: string, pattern: string): Promise<string>;
  OpenImportFile(): Promise<ImportedFile | null>;
  ChooseWorkspace(): Promise<string>;
  OpenWorkspaceFolder(): Promise<void>;
  RevealFile(path: string): Promise<void>;
  OpenURL(url: string): Promise<void>;
  ConfirmClose(): Promise<void>;
  ChoosePdfs(): Promise<PdfFile[] | null>;
  ChooseNoteFiles(): Promise<{ path: string; name: string }[] | null>;
  OpenTopicFile(rel: string): Promise<void>;
  UpdateCheck(): Promise<UpdateInfo>;
  /** Descarga, verifica e instala la versión nueva (en escritorio cierra Folio). */
  UpdateInstall(): Promise<void>;
  PdfInfo(paths: string[]): Promise<PdfFile[]>;
  RenderPdfTemp(title: string, html: string): Promise<PdfFile>;
  MergePdfs(items: MergeItem[], opt: MergeOptions): Promise<string>;
  // Sincronización en la nube. SyncRun usa la credencial que guarda cada plataforma.
  SyncStatus(): Promise<SyncStatus>;
  SyncConfigure(cfg: Partial<SyncConfig>): Promise<SyncConfig>;
  SyncSetDeviceName(name: string): Promise<void>;
  SyncUnlink(): Promise<void>;
  SyncTest(cfg: Partial<SyncConfig>, secret: string): Promise<void>;
  SyncTestStored(): Promise<void>;
  SyncSetSecret(secret: string): Promise<void>;
  SyncForgetSecret(): Promise<void>;
  SyncRun(): Promise<SyncResult>;
  SyncLinkGoogle(): Promise<void>;
  // Versiones por ruta del núcleo (cada plataforma pone su diálogo)
  ExportDocxTo(id: string, opt: ExportOptions, path: string): Promise<void>;
  WriteTextFile(path: string, content: string): Promise<void>;
  ImportFromPath(path: string): Promise<ImportedFile>;
  MergePdfsTo(items: MergeItem[], out: string, bookmarks: boolean): Promise<void>;
  // Cuenta, círculos y citas
  SocialStatus(): Promise<SocialSnapshot>;
  SocialRestore(): Promise<SocialSnapshot>;
  SocialRefresh(): Promise<SocialSnapshot>;
  SocialSignIn(email: string, password: string): Promise<SocialSnapshot>;
  SocialSignUp(email: string, password: string, name: string): Promise<{ needsConfirm: boolean; snapshot: SocialSnapshot }>;
  SocialRecover(email: string): Promise<void>;
  SocialSignInGoogle(): Promise<SocialSnapshot>;
  SocialSignOut(): Promise<void>;
  SocialUpdateProfile(name: string, color: string): Promise<SocialSnapshot>;
  SocialDeleteAccount(): Promise<void>;
  SocialCreateCircle(name: string, kind: string, color: string): Promise<SocialSnapshot>;
  SocialUpdateCircle(id: string, name: string, color: string): Promise<SocialSnapshot>;
  SocialDeleteCircle(id: string): Promise<SocialSnapshot>;
  SocialInvite(circleId: string): Promise<string>;
  SocialJoin(code: string): Promise<SocialSnapshot>;
  SocialLeave(circleId: string): Promise<SocialSnapshot>;
  SocialRemoveMember(circleId: string, userId: string): Promise<SocialSnapshot>;
  SocialProposeDate(circleId: string, title: string, notes: string, options: DateOption[]): Promise<SocialSnapshot>;
  SocialCounter(proposalId: string, options: DateOption[]): Promise<SocialSnapshot>;
  SocialAccept(optionId: string): Promise<SocialSnapshot>;
  SocialCloseProposal(proposalId: string, status: 'declined' | 'cancelled'): Promise<SocialSnapshot>;
}

export const isNative = platform !== 'web';

/**
 * Escritorio: cada función va por el puente de la ventana. El proceso principal
 * resuelve las que necesitan diálogos del sistema y pasa el resto al núcleo Go.
 */
function createDesktopBackend(): Backend {
  const bridge = window.folioDesktop!;
  return new Proxy({} as Backend, {
    get: (_t, name) => (typeof name !== 'string' || name === 'then') ? undefined : (...args: unknown[]) => bridge.call(name, args),
  });
}

export const api: Backend = platform === 'desktop' ? createDesktopBackend()
  : platform === 'android' ? createAndroidBackend()
    : createMockBackend();

/** Escucha un evento del backend; devuelve la función para dejar de escuchar. */
export function onEvent(name: string, cb: (...a: any[]) => void): (() => void) | undefined {
  if (platform === 'android') return onAndroidEvent(name, cb);
  return window.folioDesktop?.on(name, cb);
}

export function setWindowTitle(t: string) {
  window.folioDesktop?.window.setTitle(t);
  document.title = t;
}

// ---------------------------------------------------------------------------
// Backend simulado (solo desarrollo en navegador)
// ---------------------------------------------------------------------------
function createMockBackend(): Backend {
  const agenda = agendaMock();
  const KEY = 'folio-mock-v1';
  type MockDoc = { meta: Meta; setup: PageSetup; content: string; text: string; versions: VersionData[]; images: Record<string, string> };
  const load = (): Record<string, MockDoc> => {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
  };
  let db = load();
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* lleno */ } };
  let settings: Settings = {
    workspace: '(navegador)', theme: 'system', zoom: 1, zoomFit: true, sidebarOpen: true, sidebarWidth: 260, authorName: '',
    autoVersionMinutes: 10, lastDoc: '', spellcheck: true, smartQuotes: true, pageView: true, showMarks: false, ribbon: true, keymap: 'es',
  };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY + '-settings') || '{}')); } catch { /* */ }
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  const now = () => new Date().toISOString();
  const defaultSetup = (): PageSetup => ({
    paper: 'A4', orientation: 'portrait', marginTop: 25, marginBottom: 25, marginLeft: 25, marginRight: 25,
    header: '', footer: '', pageNumbers: true, fontFamily: 'Inter', fontSize: 11, lineHeight: 1.5,
  });
  const get = (id: string) => { const d = db[id]; if (!d) throw new Error('documento no encontrado'); return d; };
  const snap = (d: MockDoc, kind: Version['kind'], label: string) => {
    const last = d.versions[d.versions.length - 1];
    if (kind === 'auto' && last && last.content === d.content) return last;
    const v: VersionData = {
      id: rid(), created: now(), label, kind, hash: String(d.content.length), title: d.meta.title, words: d.meta.words,
      size: d.content.length, setup: { ...d.setup }, content: d.content, text: d.text,
    };
    d.versions.push(v);
    return v;
  };
  const descendants = (id: string): string[] =>
    Object.values(db).filter((d) => d.meta.parentId === id).flatMap((d) => [d.meta.id, ...descendants(d.meta.id)]);
  const strip = ({ content, text, ...v }: VersionData): Version => (void content, void text, v);
  const download = (name: string, blob: Blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return {
    async Init() {
      return { settings, docs: await this.ListDocs(), version: 'dev', workspace: '(navegador)', os: 'browser' };
    },
    async SaveSettings(s) { settings = s; localStorage.setItem(KEY + '-settings', JSON.stringify(s)); },
    async ListDocs() {
      return Object.values(db).map((d) => d.meta).sort((a, b) => a.order - b.order);
    },
    async GetDoc(id) {
      const d = get(id);
      return { meta: d.meta, setup: d.setup, content: JSON.parse(d.content) };
    },
    async CreateDoc(r) {
      const id = rid();
      const siblings = Object.values(db).filter((d) => d.meta.parentId === r.parentId);
      const meta: Meta = {
        id, title: r.title, icon: r.icon, parentId: r.parentId, order: siblings.length + 1, favorite: false,
        trashed: false, created: now(), updated: now(), words: r.text.split(/\s+/).filter(Boolean).length,
      };
      db[id] = {
        meta, setup: r.setup ?? defaultSetup(), content: r.content || '{"type":"doc","content":[{"type":"paragraph"}]}',
        text: r.text, versions: [], images: {},
      };
      snap(db[id], 'created', 'Documento creado');
      persist();
      return meta;
    },
    async SaveDoc(id, content, text, words) {
      const d = get(id);
      d.content = content; d.text = text; d.meta.words = words; d.meta.updated = now();
      const last = d.versions[d.versions.length - 1];
      let versionCreated = false;
      if (!last || Date.now() - Date.parse(last.created) > settings.autoVersionMinutes * 60000) {
        snap(d, 'auto', ''); versionCreated = true;
      }
      persist();
      return { updated: d.meta.updated, versionCreated };
    },
    async UpdateMeta(id, p) {
      const d = get(id);
      Object.assign(d.meta, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
      persist();
      return d.meta;
    },
    async SetSetup(id, s) { get(id).setup = s; persist(); },
    async TrashDoc(id) { for (const x of [id, ...descendants(id)]) db[x].meta.trashed = true; persist(); },
    async RestoreDoc(id) {
      const d = get(id);
      if (d.meta.parentId && (!db[d.meta.parentId] || db[d.meta.parentId].meta.trashed)) d.meta.parentId = '';
      for (const x of [id, ...descendants(id)]) db[x].meta.trashed = false;
      persist();
    },
    async DeleteDoc(id) { for (const x of [...descendants(id), id]) delete db[x]; persist(); },
    async EmptyTrash() { for (const d of Object.values(db)) if (d.meta.trashed) delete db[d.meta.id]; persist(); },
    async DuplicateDoc(id) {
      const d = get(id);
      return this.CreateDoc({ parentId: d.meta.parentId, title: d.meta.title + ' (copia)', icon: d.meta.icon, content: d.content, text: d.text, setup: d.setup });
    },
    async Search(q) {
      const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const terms = fold(q).split(/\s+/).filter(Boolean);
      return Object.values(db)
        .filter((d) => !d.meta.trashed && terms.every((t) => fold(d.meta.title + ' ' + d.text).includes(t)))
        .map((d) => ({ id: d.meta.id, title: d.meta.title, icon: d.meta.icon, snippet: d.text.slice(0, 140) }));
    },
    async ListVersions(id) { return get(id).versions.map(strip).reverse(); },
    async GetVersion(id, vid) {
      const v = get(id).versions.find((x) => x.id === vid);
      if (!v) throw new Error('versión no encontrada');
      return { ...v, content: JSON.parse(v.content) };
    },
    async CreateVersion(id, label) { const v = strip(snap(get(id), 'manual', label || 'Versión guardada')); persist(); return v; },
    async RestoreVersion(id, vid) {
      const d = get(id);
      const v = d.versions.find((x) => x.id === vid)!;
      snap(d, 'backup', 'Antes de restaurar');
      d.content = v.content; d.text = v.text; d.setup = v.setup; d.meta.title = v.title || d.meta.title;
      snap(d, 'manual', 'Restaurada');
      persist();
      return this.GetDoc(id);
    },
    async RenameVersion(id, vid, label) {
      const v = get(id).versions.find((x) => x.id === vid);
      if (v) { v.label = label; if (v.kind === 'auto') v.kind = 'manual'; }
      persist();
    },
    async DeleteVersion(id, vid) { const d = get(id); d.versions = d.versions.filter((v) => v.id !== vid); persist(); },
    async SaveImage(_docId, name, b64) {
      const ext = name.split('.').pop()?.toLowerCase() || 'png';
      return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${b64}`;
    },
    async ExportDocx() { throw new Error('La exportación a Word necesita la aplicación de escritorio.'); },
    async ExportPDF() { throw new Error('La exportación directa a PDF necesita la aplicación de escritorio. Usa Imprimir.'); },
    async SaveTextFile(name, content) { download(name, new Blob([content], { type: 'text/plain' })); return name; },
    async OpenImportFile() {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.docx,.md,.markdown,.html,.htm,.txt';
        input.onchange = async () => {
          const f = input.files?.[0];
          if (!f) return resolve(null);
          const buf = new Uint8Array(await f.arrayBuffer());
          let bin = '';
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          const dot = f.name.lastIndexOf('.');
          resolve({ name: f.name.slice(0, dot), ext: f.name.slice(dot).toLowerCase(), data: btoa(bin) });
        };
        input.click();
      });
    },
    async ChooseWorkspace() { return ''; },
    async OpenWorkspaceFolder() { /* */ },
    async RevealFile() { /* */ },
    async OpenURL(url) { window.open(url, '_blank', 'noopener'); },
    async ConfirmClose() { /* */ },
    async ChoosePdfs() { return []; },
    async ChooseNoteFiles() {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = () => resolve([...(input.files ?? [])].map((f) => {
          const url = URL.createObjectURL(f);
          mockFileNames.set(url, f.name);
          return { path: url, name: f.name };
        }));
        input.click();
      });
    },
    async UpdateCheck() { return { configured: false, current: 'navegador', latest: '', available: false, notes: '', page: '', asset: '', size: 0, published: '' }; },
    async UpdateInstall() { throw new Error('Las actualizaciones necesitan la aplicación.'); },
    async OpenTopicFile(rel) { const u = mockFileURLs.get(rel); if (u) window.open(u, '_blank', 'noopener'); },
    async PdfInfo(paths) { return paths.map((p) => ({ path: p, name: p, pages: 0, error: 'solo en la aplicación de escritorio' })); },
    async RenderPdfTemp() { throw new Error('Unir PDF necesita la aplicación de escritorio.'); },
    async MergePdfs() { throw new Error('Unir PDF necesita la aplicación de escritorio.'); },
    async SyncStatus() { return { config: { provider: '', url: '', user: '', deviceId: '', deviceName: 'Navegador', lastSync: '', lastError: '' }, linked: false, running: false }; },
    async SyncConfigure() { throw new Error('La sincronización necesita la aplicación.'); },
    async SyncSetDeviceName() { /* */ },
    async SyncUnlink() { /* */ },
    async SyncTest() { throw new Error('La sincronización necesita la aplicación.'); },
    async SyncTestStored() { throw new Error('La sincronización necesita la aplicación.'); },
    async SyncSetSecret() { /* */ },
    async SyncForgetSecret() { /* */ },
    async SyncRun() { throw new Error('La sincronización necesita la aplicación.'); },
    async SyncLinkGoogle() { throw new Error('La sincronización necesita la aplicación.'); },
    async ExportDocxTo() { throw new Error('La exportación a Word necesita la aplicación.'); },
    async WriteTextFile() { throw new Error('Guardar archivos necesita la aplicación.'); },
    async ImportFromPath() { throw new Error('Importar necesita la aplicación.'); },
    async MergePdfsTo() { throw new Error('Unir PDF necesita la aplicación.'); },
    ...agenda,
    ...socialMock(agenda),
  };
}
