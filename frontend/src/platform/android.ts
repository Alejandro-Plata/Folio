// Backend de Android: cada función de `Backend` llama al núcleo Go (plugin
// FolioCore) con los argumentos en JSON; las que necesitan diálogos del
// sistema se sustituyen por versiones de Android (archivos, PDF, dictado).
import type { Backend } from '../api';
import { androidOverrides } from './android-overrides';
import { FolioCore } from './plugins';

const listeners = new Map<string, Set<(...a: any[]) => void>>();

export function createAndroidBackend(): Backend {
  // Todo lo que no se sustituye pasa tal cual al núcleo Go
  const core = new Proxy({} as Backend, {
    get: (_t, name) => {
      if (typeof name !== 'string' || name === 'then') return undefined;
      return async (...args: unknown[]) => {
        const r = await FolioCore.call({ method: name, args: JSON.stringify(args) });
        return r.result === '' ? undefined : JSON.parse(r.result);
      };
    },
  });
  // Los eventos del núcleo (sincronización…) llegan por el plugin
  void FolioCore.addListener('event', (e) => {
    const data = e.payload ? JSON.parse(e.payload) : [];
    listeners.get(e.name)?.forEach((cb) => cb(...(Array.isArray(data) ? data : [data])));
  });
  // Las funciones sustituidas se buscan primero; el resto cae en el Proxy
  return Object.assign(Object.create(core), androidOverrides(core)) as Backend;
}

export function onAndroidEvent(name: string, cb: (...a: any[]) => void): () => void {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name)!.add(cb);
  return () => { listeners.get(name)?.delete(cb); };
}
