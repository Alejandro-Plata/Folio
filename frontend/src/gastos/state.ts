// Estado de Gastos en la interfaz: categorías, presupuestos, ajustes y
// movimientos del periodo visible. Las operaciones llaman al backend y avisan
// de los cambios por el bus, con «Deshacer» como en la agenda.
import { api } from '../api';
import { emit } from '../bus';
import { toast } from '../ui/dom';
import type { Budget, Category, Filter, Movement, Settings } from './model';

export class GastosState {
  today = '';
  categories: Category[] = [];
  budgets: Budget[] = [];
  settings!: Settings;
  private loaded = false;

  get ready() { return this.loaded; }

  async load() {
    const d = await api.GastosInit();
    this.today = d.today;
    this.categories = d.categories ?? [];
    this.budgets = d.budgets ?? [];
    this.settings = d.settings;
    this.loaded = true;
  }

  category(id: string | undefined): Category | undefined {
    return id ? this.categories.find((c) => c.id === id) : undefined;
  }

  async query(f: Filter): Promise<Movement[]> {
    return (await api.GastosQuery(f)) ?? [];
  }

  /** Ejecuta una operación, avisa del cambio y muestra los errores. */
  private async mutate<T>(op: () => Promise<T>, message?: string, undoable = true): Promise<T | undefined> {
    try {
      const r = await op();
      emit('gastos:changed');
      if (message) toast(message, { kind: 'ok', ms: 3500, action: undoable ? { label: 'Deshacer', run: () => void this.undo() } : undefined });
      return r;
    } catch (e) {
      toast(String(e).replace(/^Error:\s*/, ''), { kind: 'error', ms: 6000 });
      return undefined;
    }
  }

  saveMovement(m: Movement, message?: string) {
    return this.mutate(() => api.GastosSave(m), message);
  }

  deleteMovements(ids: string[], message?: string) {
    return this.mutate(() => api.GastosDelete(ids), message);
  }

  async undo() {
    try {
      const ok = await api.GastosUndo();
      if (!ok) { toast('No hay nada que deshacer en Gastos'); return; }
      emit('gastos:changed');
      toast('Deshecho', { ms: 1800 });
    } catch (e) { toast(String(e), { kind: 'error' }); }
  }

  async saveCategory(c: Category) {
    const r = await this.mutate(() => api.GastosSaveCategory(c), undefined, false);
    if (r) await this.load();
    return r;
  }

  async deleteCategory(id: string) {
    const r = await this.mutate(() => api.GastosDeleteCategory(id), undefined, false);
    if (r !== undefined) await this.load();
    return r;
  }

  async setBudget(b: Budget) {
    const r = await this.mutate(() => api.GastosSetBudget(b), undefined, false);
    if (r !== undefined) await this.load();
    return r;
  }

  async saveSettings(v: Settings) {
    const r = await this.mutate(() => api.GastosSaveSettings(v), undefined, false);
    if (r !== undefined) this.settings = v;
    return r;
  }
}
