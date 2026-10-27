// Dónde se ejecuta Folio y qué puede hacer cada plataforma.
export type PlatformId = 'desktop' | 'android' | 'web';

declare global {
  interface Window { Capacitor?: { isNativePlatform(): boolean; getPlatform(): string } }
}

export const platform: PlatformId = window.go?.main?.App ? 'desktop'
  : window.Capacitor?.isNativePlatform?.() && window.Capacitor.getPlatform() === 'android' ? 'android'
    : 'web';

export const isDesktop = platform === 'desktop';
export const isAndroid = platform === 'android';

/** Interfaz móvil: en Android siempre; en el navegador, con «?mobile» en la dirección (para probar). */
export function wantsMobileUI(): boolean {
  return isAndroid || new URLSearchParams(location.search).has('mobile');
}
