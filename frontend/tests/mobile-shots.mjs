// Recorre la interfaz móvil con un navegador (Chrome del sistema), guarda una
// captura de cada pantalla en tests/out/ y comprueba que no hay desplazamiento
// horizontal y que los controles tocables miden al menos 44 px.
//
//   npm run dev            (en otra terminal)
//   node tests/mobile-shots.mjs [http://localhost:5173] [anchos separados por comas]
//
// Variables: CHROME_PATH (por defecto /usr/bin/google-chrome).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:5173';
const WIDTHS = (process.argv[3] || '393,360').split(',').map(Number);
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' });
let problems = 0;
const report = (what, items) => { if (items.length) { problems += items.length; console.log(`  ✗ ${what}:`, items.slice(0, 12).join(' · ')); } };

for (const scheme of ['light', 'dark']) {
  for (const width of WIDTHS) {
    const tag = `${width}-${scheme}`;
    console.log(`\n== ${tag}`);
    const ctx = await browser.newContext({ viewport: { width, height: 851 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => { problems++; console.log('  ✗ error de la página:', e.message); });
    await p.goto(`${BASE}/?mobile`);
    await p.waitForFunction(() => document.body.classList.contains('ready'));
    await p.evaluate(() => [...document.querySelectorAll('.tour-card button')].find((b) => b.textContent === 'Ahora no')?.click());

    const check = async (name) => {
      await p.waitForTimeout(450);
      await p.screenshot({ path: `${OUT}${tag}-${name}.png` });
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      if (overflow) { problems++; console.log(`  ✗ ${name}: hay desplazamiento horizontal`); }
      const small = await p.evaluate(() => [...document.querySelectorAll('button, [role=button], a[href], input:not([type=hidden]), select, textarea')]
        .filter((e) => e.offsetParent !== null && !e.closest('.tour-card, [hidden]'))
        .map((e) => ({ r: e.getBoundingClientRect(), e }))
        .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44))
        // Exentos: casillas de «hecha» y chips (la fila entera es tocable), puntos del año y bloques de la rejilla horaria (su altura es su duración; la vista Lista es la alternativa)
        // Contenido del documento: los vínculos del texto se tocan como texto y el icono de los cuadros amplía su zona táctil con ::after
        .filter(({ e }) => !(e.matches('a[href]') && e.closest('.doc-body')) && !e.closest('.doc-body .callout-icon'))
        .filter(({ e }) => !e.closest('.ag-yday, .ag-ymonth-grid') && !e.classList.contains('ag-done') && !e.classList.contains('ag-chip') && !e.closest('.ag-block') && !(e.type === 'checkbox' && e.closest('label')))
        .map(({ e, r }) => `${e.getAttribute('aria-label') || e.title || e.textContent.trim().slice(0, 18) || e.className} (${Math.round(r.width)}×${Math.round(r.height)})`));
      report(`${name}: controles menores de 44 px`, small);
    };

    await check('01-documentos');
    await p.tap('.m-row-btn'); await check('02-editor');
    await p.tap('.doc-body p'); await check('03-escribiendo');
    await p.tap('.m-fb[aria-label^="Estilos"]'); await check('04-hoja-formato'); await p.keyboard.press('Escape');
    await p.waitForTimeout(250);
    await p.tap('.m-fb[aria-label="Insertar"]'); await check('05-hoja-insertar'); await p.keyboard.press('Escape');
    await p.waitForTimeout(250);
    await p.tap('.m-appbar button[aria-label="Más acciones"]'); await check('06-menu-editor'); await p.keyboard.press('Escape');
    await p.waitForTimeout(250);
    await p.tap('.m-back'); await p.waitForTimeout(300);
    await p.tap('.m-nav-btn:nth-child(2)');
    await p.evaluate(async () => { await folio.agenda.state.setTopics(Array.from({ length: 20 }, (_, i) => ({ id: '', number: i + 1, title: `Tema ${i + 1}`, weight: 1, studyMinutes: 0 })), true); await folio.agenda.reload(); });
    await check('07-agenda-lista');
    for (const [i, name] of [[2, 'dia'], [3, '3dias'], [4, 'mes'], [5, 'anio']]) { await p.tap(`.ag-view:nth-child(${i})`); await check(`08-agenda-${name}`); }
    await p.tap('.ag-view:nth-child(1)');
    await p.tap('.m-fab'); await p.fill('.ag-quick-input', 'mañana de 9 a 11 estudio tema 1'); await check('09-agenda-barra-rapida'); await p.keyboard.press('Escape');
    await p.waitForTimeout(250);
    await p.tap('.ag-list .ag-chip'); await check('10-agenda-tarea'); await p.keyboard.press('Escape');
    await p.waitForTimeout(250);
    await p.tap('.m-nav-btn:nth-child(3)'); await check('14-gastos-resumen');
    await p.tap('.gx-tabs .seg-btn:nth-child(2)'); await check('14b-gastos-movimientos');
    await p.tap('.gx-tabs .seg-btn:nth-child(3)'); await check('14c-gastos-presupuestos');
    await p.tap('.gx-tabs .seg-btn:nth-child(1)');
    await p.tap('.m-fab'); await check('14d-gastos-nuevo'); await p.keyboard.press('Escape');
    await p.waitForTimeout(250);
    await p.tap('.m-nav-btn:nth-child(4)'); await p.fill('.m-search-screen .m-search', 'atajos'); await check('11-buscar');
    await p.tap('.m-nav-btn:nth-child(5)'); await check('12-mas');
    await p.evaluate(async () => { const m = await import('/src/sync/syncsettings.ts'); m.syncDialog(folio); });
    await check('13-sincronizacion'); await p.keyboard.press('Escape');
    await ctx.close();
  }
}
await browser.close();
console.log(problems ? `\n${problems} problemas` : '\nTodo en orden');
process.exit(problems ? 1 : 0);
