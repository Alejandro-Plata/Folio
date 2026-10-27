// Bus de eventos mínimo para que el editor pida cosas a la interfaz
// (abrir el editor de ecuaciones, de notas al pie, etc.) sin depender de ella.
type Handler = (payload: any) => void;
const handlers = new Map<string, Set<Handler>>();

export function on(name: string, h: Handler): () => void {
  if (!handlers.has(name)) handlers.set(name, new Set());
  handlers.get(name)!.add(h);
  return () => handlers.get(name)!.delete(h);
}

export function emit(name: string, payload?: any) {
  handlers.get(name)?.forEach((h) => h(payload));
}
