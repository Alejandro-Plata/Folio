// Compila el proceso principal y el preload de la ventana (TypeScript → out/).
import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'], sourcemap: false, minify: false, logLevel: 'warning' };
await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'out/main.js' });
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'out/preload.js' });
console.log('desktop: out/main.js y out/preload.js');
