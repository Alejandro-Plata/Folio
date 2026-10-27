// Empaqueta Folio para el escritorio con Electron, sin herramientas de Windows
// ni Wine: descarga el Electron de cada sistema, mete la interfaz y el núcleo
// Go, y deja la carpeta lista en build/desktop/<sistema>/Folio.
//
//   node package.mjs <linux|win32> <versión> [whisper-cli]
//
// Linux: además crea build/bin/folio, un lanzador autoextraíble (un solo
// archivo) que se instala en ~/.local/bin y se actualiza sustituyéndolo.
// Windows: el instalador lo hace makensis con build/windows/installer.
import { downloadArtifact } from '@electron/get';
import { createPackage } from '@electron/asar';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [platform, version, whisper] = process.argv.slice(2);
if (!['linux', 'win32'].includes(platform) || !/^\d+\.\d+\.\d+/.test(version ?? '')) {
  console.error('Uso: node package.mjs <linux|win32> <versión> [whisper-cli]');
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const isWin = platform === 'win32';
const electronVersion = JSON.parse(fs.readFileSync(path.join(here, 'node_modules/electron/package.json'), 'utf8')).version;
const out = path.join(root, 'build/desktop', platform, 'Folio');
const res = path.join(out, 'resources');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

// 1. Electron de ese sistema (se guarda en la caché de @electron/get)
const zip = await downloadArtifact({ version: electronVersion, artifactName: 'electron', platform, arch: 'x64' });
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
// unzip en Linux; en Windows, el tar del sistema (bsdtar) también abre .zip
if (process.platform === 'win32') run('tar', ['-xf', zip, '-C', out]); else run('unzip', ['-q', zip, '-d', out]);
fs.renameSync(path.join(out, isWin ? 'electron.exe' : 'electron'), path.join(out, isWin ? 'Folio.exe' : 'folio'));
fs.rmSync(path.join(res, 'default_app.asar'), { force: true });

// 2. La app: proceso principal, preload e interfaz, en resources/app.asar
const stage = fs.mkdtempSync(path.join(root, 'build/desktop/app-'));
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
  name: 'folio', productName: 'Folio', version, main: 'out/main.js', desktopName: 'folio.desktop',
}, null, 2));
fs.cpSync(path.join(here, 'out'), path.join(stage, 'out'), { recursive: true });
fs.cpSync(path.join(root, 'frontend/dist'), path.join(stage, 'dist'), { recursive: true });
await createPackage(stage, path.join(res, 'app.asar'));
fs.rmSync(stage, { recursive: true, force: true });

// 3. El núcleo Go (sin cgo: se compila para cualquier sistema desde aquí)
run('go', ['build', '-trimpath', '-ldflags', `-s -w -X main.Version=${version}`, '-o', path.join(res, isWin ? 'folio-core.exe' : 'folio-core'), './cmd/folio-core'],
  { cwd: root, env: { ...process.env, CGO_ENABLED: '0', GOOS: isWin ? 'windows' : 'linux', GOARCH: 'amd64' } });
// Motor de dictado: junto al núcleo, que es quien lo busca
if (whisper && fs.existsSync(whisper)) fs.copyFileSync(whisper, path.join(res, isWin ? 'whisper-cli.exe' : 'whisper-cli'));
if (!isWin) fs.copyFileSync(path.join(root, 'build/appicon.png'), path.join(res, 'icon.png'));

// 4. Windows: icono y datos del ejecutable (resedit, sin rcedit ni Wine)
if (isWin) {
  const ResEdit = await import('resedit');
  const exePath = path.join(out, 'Folio.exe');
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const rs = ResEdit.NtExecutableResource.from(exe);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(root, 'build/windows/icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(rs.entries);
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(rs.entries, groups[0]?.id ?? 1, groups[0]?.lang ?? 1033, ico.icons.map((i) => i.data));
  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(rs.entries);
  const [maj, min, pat] = version.split(/[.-]/).map((n) => Number(n) || 0);
  vi.setFileVersion(maj, min, pat, 0, 1033);
  vi.setProductVersion(maj, min, pat, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: 'Folio', ProductName: 'Folio', CompanyName: 'Folio', OriginalFilename: 'Folio.exe', InternalName: 'Folio',
    LegalCopyright: '© 2026', FileVersion: version, ProductVersion: version,
  });
  vi.outputToResourceEntries(rs.entries);
  rs.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
}

// 5. Linux: lanzador autoextraíble (un solo archivo ejecutable)
if (!isWin) {
  const bin = path.join(root, 'build/bin');
  fs.mkdirSync(bin, { recursive: true });
  const tgz = path.join(root, 'build/desktop/linux/folio.tar.gz');
  run('tar', ['-czf', tgz, '-C', out, '.']);
  const header = fs.readFileSync(path.join(here, 'launcher.sh'), 'utf8').replaceAll('@VERSION@', version);
  const launcher = path.join(bin, 'folio');
  fs.writeFileSync(launcher, header);
  fs.appendFileSync(launcher, fs.readFileSync(tgz));
  fs.chmodSync(launcher, 0o755);
  fs.rmSync(tgz);
  console.log(`Lanzador: ${launcher} (${(fs.statSync(launcher).size / 1048576).toFixed(0)} MB)`);
}
console.log(`Folio ${version} (${platform}) en ${out}`);
