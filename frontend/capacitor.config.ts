import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'es.folio.app',
  appName: 'Folio',
  webDir: 'dist',
  android: { allowMixedContent: false, webContentsDebuggingEnabled: true },
  plugins: {
    Keyboard: { resize: 'native', resizeOnFullScreen: true },
    StatusBar: { overlaysWebView: true },
  },
};
export default config;
