export interface Meta {
  id: string;
  title: string;
  icon: string;
  parentId: string;
  order: number;
  favorite: boolean;
  trashed: boolean;
  created: string;
  updated: string;
  words: number;
}

export interface PageSetup {
  paper: 'A4' | 'Letter' | 'A5' | 'Legal';
  orientation: 'portrait' | 'landscape';
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  header: string;
  footer: string;
  pageNumbers: boolean;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}

export interface Doc {
  meta: Meta;
  setup: PageSetup;
  content: any;
}

export interface Settings {
  workspace: string;
  theme: 'system' | 'light' | 'dark';
  zoom: number;
  /** Zoom «ajustar al ancho»: la hoja se reduce si no cabe (nunca pasa del 100 %). */
  zoomFit?: boolean;
  sidebarOpen: boolean;
  sidebarWidth: number;
  authorName: string;
  autoVersionMinutes: number;
  lastDoc: string;
  spellcheck: boolean;
  smartQuotes: boolean;
  pageView: boolean;
  showMarks: boolean;
  ribbon: boolean;
  keymap: 'es' | 'en';
  /** Aviso de anclar a la barra de tareas (Windows) ya mostrado. */
  pinTipShown?: boolean;
  /** Tutorial guiado visto (o descartado). */
  tourDone?: boolean;
  /** Versión del «Manual de Folio» ya instalada en el espacio de trabajo. */
  manualVersion?: number;
  /** Valores predeterminados de Exportar e Imprimir. */
  exportFormat?: ExportFormat;
  exportNoTitle?: boolean;
  exportStudent?: boolean;
  /** Página de los documentos nuevos (sin definir = la predeterminada). */
  docSetup?: PageSetup | null;
  /** Nube vinculada (solo se cambia con las funciones Sync*). */
  sync?: SyncConfig;
}

/** Nube vinculada. Las credenciales no están aquí: las guarda cada plataforma en su almacén seguro. */
export interface SyncConfig {
  provider: '' | 'webdav' | 'gdrive';
  url: string;
  user: string;
  deviceId: string;
  deviceName: string;
  lastSync: string;
  lastError: string;
}

export interface SyncStatus { config: SyncConfig; linked: boolean; running: boolean }

export interface SyncResult {
  skipped: boolean;
  uploaded: number;
  downloaded: number;
  merged: number;
  deletedLocal: number;
  deletedRemote: number;
  changed: boolean;
  docsChanged: string[] | null;
  agendaChanged: boolean;
  conflicts: number;
  errors: string[] | null;
  at: string;
}

export interface InitData {
  settings: Settings;
  docs: Meta[];
  version: string;
  workspace: string;
  os: string;
}

export interface SaveResult {
  updated: string;
  versionCreated: boolean;
}

export interface SearchHit {
  id: string;
  title: string;
  icon: string;
  snippet: string;
}

export interface Version {
  id: string;
  created: string;
  label: string;
  kind: 'created' | 'auto' | 'manual' | 'backup';
  hash: string;
  title: string;
  words: number;
  size: number;
  setup: PageSetup;
}

export interface VersionData extends Version {
  content: any;
  text: string;
}

export interface MetaPatch {
  title?: string;
  icon?: string;
  parentId?: string;
  order?: number;
  favorite?: boolean;
}

export type ExportFormat = 'docx' | 'pdf' | 'html' | 'md';

export interface ExportOptions {
  studentVersion: boolean;
  includeTitle: boolean;
}

/** PDF elegido para «Unir PDF». */
export interface PdfFile {
  path: string;
  name: string;
  pages: number;
  /** Por qué no se puede usar (dañado, con contraseña…). */
  error?: string;
}

export interface MergeItem { path: string; name: string; pages: string }
export interface MergeOptions { bookmarks: boolean; open: boolean }

export interface ImportedFile {
  name: string;
  ext: string;
  data: string;
}

/** Última versión publicada frente a la instalada. */
export interface UpdateInfo {
  configured: boolean;
  current: string;
  latest: string;
  available: boolean;
  notes: string;
  page: string;
  asset: string;
  size: number;
  published: string;
}

// ---------- Cuenta y círculos (Supabase) ----------

export interface Profile { id: string; name: string; email: string; color: string }
export interface CircleMember { user_id: string; role: 'owner' | 'member'; joined_at: string; profiles: Profile }
export interface Circle {
  id: string;
  name: string;
  kind: 'friends' | 'couple';
  color: string;
  owner: string;
  created_at: string;
  circle_members: CircleMember[];
}
export interface SharedEvent {
  id?: string;
  circle_id: string;
  created_by?: string;
  title: string;
  notes: string;
  date: string;
  start: string | null;
  minutes: number;
  proposal_id?: string | null;
  updated_at?: string;
}
export interface DateOption { id?: string; proposal_id?: string; date: string; start: string | null; minutes: number; proposed_by?: string; created_at?: string }
export interface DateProposal {
  id: string;
  circle_id: string;
  proposed_by: string;
  title: string;
  notes: string;
  status: 'open' | 'accepted' | 'declined' | 'cancelled';
  event_id: string | null;
  responded_by: string | null;
  created_at: string;
  updated_at: string;
  date_options: DateOption[];
}
export interface SocialSnapshot {
  configured: boolean;
  signedIn: boolean;
  user?: { id: string; email: string };
  profile?: Profile;
  circles: Circle[] | null;
  events: SharedEvent[] | null;
  proposals: DateProposal[] | null;
  lastSync: string;
  error?: string;
}
