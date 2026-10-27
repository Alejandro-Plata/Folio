// Puente entre la interfaz y el proceso principal. La interfaz solo ve
// window.folioDesktop: llamar a funciones, recibir eventos y la ventana.
import { contextBridge, ipcRenderer, webUtils } from 'electron';

const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
ipcRenderer.on('folio:event', (_e, name: string, data: unknown[]) => {
  listeners.get(name)?.forEach((cb) => cb(...(Array.isArray(data) ? data : [data])));
});

contextBridge.exposeInMainWorld('folioDesktop', {
  platform: process.platform,
  call: (method: string, args: unknown[]) => ipcRenderer.invoke('folio:call', method, args),
  on(name: string, cb: (...a: unknown[]) => void) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name)!.add(cb);
    return () => { listeners.get(name)?.delete(cb); };
  },
  window: {
    minimize: () => ipcRenderer.send('folio:window', 'minimize'),
    toggleMaximize: () => ipcRenderer.send('folio:window', 'toggleMaximize'),
    close: () => ipcRenderer.send('folio:window', 'close'),
    setTitle: (t: string) => ipcRenderer.send('folio:window', 'title', t),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('folio:isMaximized'),
  },
  /** Ruta en disco de un archivo soltado sobre la ventana. */
  pathForFile: (f: File) => webUtils.getPathForFile(f),
});
