// Arranque específico de Android: PDF compartidos con Folio, teclado, barra de
// estado y guardado al pasar a segundo plano (Android no avisa de un «cierre»).
import { App as CapApp } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';
import { StatusBar, Style } from '@capacitor/status-bar';
import type { App } from '../app';
import { dropPdfs } from '../ui/pdfmerge';
import { FolioFiles } from './plugins';

export function initAndroid(app: App) {
  // «Compartir con Folio» desde otras apps: abre «Unir PDF» con esos archivos
  const consumeShared = async () => {
    try {
      const { files } = await FolioFiles.consumeShared();
      if (files.length) await dropPdfs(app, files.map((f) => f.path));
    } catch (e) { console.error(e); }
  };
  void consumeShared();
  void CapApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void consumeShared(); else void app.flush();
  });

  // Con el teclado abierto se ocultan la barra de navegación y el botón flotante
  void Keyboard.addListener('keyboardWillShow', () => document.body.classList.add('keyboard-open'));
  void Keyboard.addListener('keyboardDidHide', () => document.body.classList.remove('keyboard-open'));
}

/** Iconos de la barra de estado claros u oscuros según el tema. */
export function updateStatusBar(dark: boolean) {
  void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => { /* sin barra de estado */ });
}
