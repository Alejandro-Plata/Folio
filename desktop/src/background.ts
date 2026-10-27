// Segundo plano: al cerrar la ventana, Folio sigue abierto (oculto) para poder
// avisar de las tareas; un icono en la bandeja del sistema lo vuelve a mostrar o
// lo cierra del todo. También puede abrirse al iniciar sesión, sin ventana.
//
// Son preferencias de este equipo (no se sincronizan): se guardan en
// escritorio.json, junto a los datos de la ventana.
//
// En GNOME la bandeja solo se ve con la extensión AppIndicator; sin ella, abrir
// Folio otra vez desde el menú trae la ventana oculta.
import { app, Menu, nativeImage, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface DesktopPrefs {
  /** Cerrar la ventana la oculta en lugar de salir. */
  background: boolean;
  /** Abrir Folio, sin ventana, al iniciar sesión. */
  openAtLogin: boolean;
}

const isWin = process.platform === 'win32';
const HIDDEN_ARG = '--oculto';
const prefsFile = () => path.join(app.getPath('userData'), 'escritorio.json');

/** Arrancado al iniciar sesión: se abre sin mostrar la ventana. */
export const startHidden = process.argv.includes(HIDDEN_ARG);

export function loadPrefs(): DesktopPrefs {
  try {
    const p = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
    return { background: !!p.background, openAtLogin: !!p.openAtLogin };
  } catch {
    return { background: false, openAtLogin: false };
  }
}

export function savePrefs(p: DesktopPrefs) {
  fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
  fs.writeFileSync(prefsFile(), JSON.stringify(p, null, 2));
  setOpenAtLogin(p.openAtLogin);
}

/** Inicio de sesión: en Windows, el registro (lo gestiona Electron); en Linux, ~/.config/autostart. */
function setOpenAtLogin(on: boolean) {
  if (isWin) {
    app.setLoginItemSettings({ openAtLogin: on, args: [HIDDEN_ARG] });
    return;
  }
  const dir = path.join(process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config'), 'autostart');
  const file = path.join(dir, 'folio.desktop');
  if (!on) { fs.rmSync(file, { force: true }); return; }
  // El lanzador (FOLIO_LAUNCHER) sobrevive a las actualizaciones; el ejecutable de dentro cambia de carpeta
  const exe = process.env.FOLIO_LAUNCHER || process.execPath;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, [
    '[Desktop Entry]', 'Type=Application', 'Name=Folio', 'Comment=Avisos de la agenda',
    `Exec="${exe}" ${HIDDEN_ARG}`, 'Icon=folio', 'X-GNOME-Autostart-enabled=true', 'NoDisplay=true', '',
  ].join('\n'));
}

let tray: Tray | null = null;

/** Muestra u oculta el icono de la bandeja. */
export function setTray(on: boolean, icon: string, actions: { show: () => void; agenda: () => void; quit: () => void }) {
  if (!on) { tray?.destroy(); tray = null; return; }
  if (tray) return;
  const img = nativeImage.createFromPath(icon).resize({ width: isWin ? 16 : 22, height: isWin ? 16 : 22 });
  tray = new Tray(img);
  tray.setToolTip('Folio');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Folio', click: actions.show },
    { label: 'Agenda', click: actions.agenda },
    { type: 'separator' },
    { label: 'Salir de Folio', click: actions.quit },
  ]));
  tray.on('click', actions.show);
}
