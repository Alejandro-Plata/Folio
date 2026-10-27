// Catálogo de fuentes. Las que llevan `pkg` van incluidas en Folio (licencia
// SIL OFL): se ven igual en Linux y en Windows y se incrustan al exportar, así
// que el PDF usa exactamente la misma letra que el editor. Las demás son del
// sistema; si faltan se usan sus equivalentes métricos (Carlito, Liberation…).
//
// De las incluidas solo se empaqueta el subconjunto latino (español, catalán,
// gallego, euskera, francés, portugués, alemán…): 1,7 MB para las veinte.
import type { JSONContent } from '@tiptap/core';
import { blobToBase64 } from './editor/editor';

export const FONT_GROUPS = ['Sin serifa', 'Con serifa', 'Lectura fácil', 'Manuscrita', 'Monoespaciada'] as const;
export type FontGroup = (typeof FONT_GROUPS)[number];

export interface FontDef {
  /** Nombre visible; también el que recibe Word. */
  name: string;
  stack: string;
  group: FontGroup;
  /** Paquete de @fontsource incluido en la app. */
  pkg?: string;
  /** Rango de pesos de las fuentes variables. */
  weight?: string;
}

const SANS = 'sans-serif';
const sys = (name: string, group: FontGroup, stack: string): FontDef => ({ name, group, stack });
const own = (name: string, group: FontGroup, pkg: string, fallback: string, weight?: string): FontDef =>
  ({ name, group, pkg, weight, stack: `'${name}', ${fallback}` });

export const FONTS: FontDef[] = [
  sys('Inter', 'Sin serifa', "'Inter Variable', Inter, 'Segoe UI', Roboto, Cantarell, sans-serif"),
  sys('Calibri', 'Sin serifa', "Calibri, Carlito, 'Segoe UI', sans-serif"),
  sys('Arial', 'Sin serifa', "Arial, 'Liberation Sans', Helvetica, sans-serif"),
  sys('Verdana', 'Sin serifa', "Verdana, 'DejaVu Sans', sans-serif"),
  own('Roboto', 'Sin serifa', '@fontsource-variable/roboto', SANS, '100 900'),
  own('Open Sans', 'Sin serifa', '@fontsource-variable/open-sans', SANS, '300 800'),
  own('Lato', 'Sin serifa', '@fontsource/lato', SANS),
  own('Source Sans 3', 'Sin serifa', '@fontsource-variable/source-sans-3', SANS, '200 900'),
  own('Nunito', 'Sin serifa', '@fontsource-variable/nunito', SANS, '200 1000'),
  own('Montserrat', 'Sin serifa', '@fontsource-variable/montserrat', SANS, '100 900'),

  sys('Times New Roman', 'Con serifa', "'Times New Roman', 'Liberation Serif', Times, serif"),
  sys('Georgia', 'Con serifa', "Georgia, 'Gelasio', serif"),
  sys('Cambria', 'Con serifa', 'Cambria, Caladea, Georgia, serif'),
  sys('Garamond', 'Con serifa', "Garamond, 'EB Garamond', 'Times New Roman', serif"),
  own('Merriweather', 'Con serifa', '@fontsource-variable/merriweather', 'serif', '300 900'),
  own('Lora', 'Con serifa', '@fontsource-variable/lora', 'serif', '400 700'),
  own('Literata', 'Con serifa', '@fontsource-variable/literata', 'serif', '200 900'),
  own('Crimson Pro', 'Con serifa', '@fontsource-variable/crimson-pro', 'serif', '200 900'),
  own('Libre Baskerville', 'Con serifa', '@fontsource/libre-baskerville', 'serif'),
  own('Playfair Display', 'Con serifa', '@fontsource-variable/playfair-display', 'serif', '400 900'),
  own('Roboto Slab', 'Con serifa', '@fontsource-variable/roboto-slab', 'serif', '100 900'),

  own('Atkinson Hyperlegible', 'Lectura fácil', '@fontsource/atkinson-hyperlegible', SANS),
  own('Lexend', 'Lectura fácil', '@fontsource-variable/lexend', SANS, '100 900'),
  own('Andika', 'Lectura fácil', '@fontsource/andika', SANS),

  sys('Comic Sans MS', 'Manuscrita', "'Comic Sans MS', 'Comic Neue', 'Comic Relief', cursive"),
  own('Patrick Hand', 'Manuscrita', '@fontsource/patrick-hand', 'cursive'),
  own('Caveat', 'Manuscrita', '@fontsource-variable/caveat', 'cursive', '400 700'),
  own('Dancing Script', 'Manuscrita', '@fontsource-variable/dancing-script', 'cursive', '400 700'),

  sys('Courier New', 'Monoespaciada', "'Courier New', 'Liberation Mono', monospace"),
  own('JetBrains Mono', 'Monoespaciada', '@fontsource-variable/jetbrains-mono', 'monospace', '100 800'),
];

/** Primera familia de un valor de font-family, sin comillas. */
export function primaryFamily(value: string) {
  return value.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
}

/** Fuente del catálogo a partir de su nombre o de un font-family (p. ej. el de una marca de texto). */
export function findFont(value: string | undefined | null): FontDef | undefined {
  if (!value) return undefined;
  const first = primaryFamily(value);
  return FONTS.find((f) => f.name === value || f.stack === value || f.name === first || primaryFamily(f.stack) === first);
}

export function fontStack(name: string) {
  return findFont(name)?.stack ?? `'${name}', sans-serif`;
}

// ---------- Archivos y @font-face ----------

/** Mismos rangos que usa Google Fonts para el subconjunto latino. */
export const LATIN_RANGE = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

const FILES = import.meta.glob('../node_modules/@fontsource{,-variable}/*/files/*-latin-{wght,400,700}-{normal,italic}.woff2', {
  query: '?url', import: 'default', eager: true,
}) as Record<string, string>;

interface FontFile { url: string; weight: string; style: string }

function filesOf(f: FontDef): FontFile[] {
  if (!f.pkg) return [];
  const prefix = `../node_modules/${f.pkg}/files/`;
  return Object.entries(FILES).flatMap(([path, url]) => {
    const m = path.startsWith(prefix) && /-latin-(wght|400|700)-(normal|italic)\.woff2$/.exec(path);
    return m ? [{ url, weight: m[1] === 'wght' ? f.weight ?? '400' : m[1], style: m[2] }] : [];
  });
}

const faceCSS = (name: string, file: FontFile, src: string, display: string) =>
  `@font-face{font-family:'${name}';font-style:${file.style};font-display:${display};font-weight:${file.weight};src:url(${src}) format('woff2');unicode-range:${LATIN_RANGE}}`;

/** Declara en la interfaz las fuentes incluidas. El navegador solo descarga las que se usan. */
export function installFontFaces() {
  const css = FONTS.flatMap((f) => filesOf(f).map((file) => faceCSS(f.name, file, file.url, 'swap'))).join('\n');
  const style = document.createElement('style');
  style.dataset.fonts = 'folio';
  style.textContent = css;
  document.head.append(style);
}

/** Fuentes incluidas que usa un documento: la del documento, las marcas de texto y la de código. */
export function bundledFontsUsed(content: JSONContent, docFont: string): FontDef[] {
  const used = new Set<FontDef | undefined>([findFont(docFont)]);
  let code = false;
  const walk = (n: JSONContent) => {
    if (n.type === 'codeBlock') code = true;
    for (const m of n.marks ?? []) {
      if (m.type === 'code') code = true;
      if (m.type === 'textStyle' && m.attrs?.fontFamily) used.add(findFont(m.attrs.fontFamily as string));
    }
    n.content?.forEach(walk);
  };
  walk(content);
  if (code) used.add(findFont('JetBrains Mono'));
  return [...used].filter((f): f is FontDef => !!f?.pkg);
}

const dataURLs = new Map<string, Promise<string>>();
function dataURL(url: string) {
  let p = dataURLs.get(url);
  if (!p) {
    p = fetch(url).then((r) => r.blob()).then(async (b) => `data:font/woff2;base64,${await blobToBase64(b)}`);
    dataURLs.set(url, p);
  }
  return p;
}

/** @font-face con las fuentes incrustadas, para el HTML que se imprime o se convierte a PDF. */
export async function embeddedFontFaces(fonts: FontDef[]): Promise<string> {
  const faces = await Promise.all(fonts.flatMap((f) => filesOf(f).map(async (file) => faceCSS(f.name, file, await dataURL(file.url), 'block'))));
  return faces.join('');
}
