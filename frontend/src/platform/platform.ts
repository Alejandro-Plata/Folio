// Dónde se ejecuta Folio y qué puede hacer cada plataforma.
export type PlatformId = 'desktop' | 'android' | 'web';

/** Puente de la ventana de escritorio (Electron, desktop/src/preload.ts). */
export interface FolioDesktop {
  platform: string;
  call(method: string, args: unknown[]): Promise<unknown>;
  on(name: string, cb: (...a: any[]) => void): () => void;
  window: { minimize(): void; toggleMaximize(): void; close(): void; setTitle(t: string): void; isMaximized(): Promise<boolean> };
  pathForFile(f: File): string;
}

declare global {
  interface Window {
    Capacitor?: { isNativePlatform(): boolean; getPlatform(): string };
    folioDesktop?: FolioDesktop;
  }
}

export const platform: PlatformId = window.folioDesktop ? 'desktop'
  : window.Capacitor?.isNativePlatform?.() && window.Capacitor.getPlatform() === 'android' ? 'android'
    : 'web';

export const isDesktop = platform === 'desktop';
export const isAndroid = platform === 'android';

/** Interfaz móvil: en Android siempre; en el navegador, con «?mobile» en la dirección (para probar). */
export function wantsMobileUI(): boolean {
  return isAndroid || new URLSearchParams(location.search).has('mobile');
}
