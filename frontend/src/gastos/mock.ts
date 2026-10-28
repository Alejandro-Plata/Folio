// Gastos simulado en localStorage para desarrollar la interfaz en el navegador
// (npm run dev). Imita el comportamiento del paquete Go internal/gastos: mismo
// algoritmo de resumen, misma validación.
import type {
  Budget, BudgetLine, Category, CategoryTotal, Filter, GastosInitData, Movement, MonthPoint, Settings, Summary,
} from './model';
import { DEFAULT_CATEGORIES } from './model';
import { addDays, todayISO } from '../agenda/dates';

const KEY = 'folio-mock-gastos-v1';

interface DB { movements: Record<string, Movement>; categories: Category[]; budgets: Budget[]; settings: Settings }

function defaultSettings(): Settings { return { currency: 'EUR', openingCents: 0, openingDate: '' }; }

const id = () => Math.random().toString(16).slice(2, 18).padEnd(16, '0');
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** 30 movimientos de ejemplo en los últimos 3 meses, para desarrollar. */
function sampleMovements(): Record<string, Movement> {
  const today = todayISO();
  const out: Record<string, Movement> = {};
  const add = (m: Omit<Movement, 'id' | 'updated'>) => {
    const movId = id();
    out[movId] = { ...m, id: movId, updated: new Date().toISOString() };
  };
  for (let i = 0; i < 3; i++) add({ kind: 'income', date: addDays(today, -i * 30).slice(0, 8) + '01', name: 'Nómina', method: 'monthly', amountCents: 150000 });
  const expenses: [string, string, number][] = [
    ['compra', 'Supermercado', 4500], ['compra', 'Frutería', 1800], ['compra', 'Supermercado', 5200],
    ['ocio', 'Cine', 1200], ['ocio', 'Restaurante', 3500], ['ocio', 'Conciertos', 6000],
    ['comunes', 'Comunidad', 4000], ['luz', 'Factura luz', 5500], ['agua', 'Factura agua', 2200],
    ['gas', 'Factura gas', 3800], ['estudio', 'Libros', 2500], ['gimnasio', 'Cuota mensual', 3000],
  ];
  let day = 1;
  for (let i = 0; i < 27; i++) {
    const [categoryId, name, baseAmount] = expenses[i % expenses.length];
    day += 2 + (i % 3);
    add({ kind: 'expense', date: addDays(today, -day), name, categoryId, amountCents: baseAmount + (i % 5) * 150 });
  }
  return out;
}

let db: DB = load();
const undo: string[] = [];

function load(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return { movements: sampleMovements(), categories: clone(DEFAULT_CATEGORIES), budgets: [], settings: defaultSettings() };
}
function persist() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* */ } }
function checkpoint() { undo.push(JSON.stringify(db)); if (undo.length > 50) undo.shift(); }

function monthOf(date: string): string { return date.length >= 7 ? date.slice(0, 7) : 'sin-fecha'; }

function addMonthsYM(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function range(from?: string, to?: string): Movement[] {
  return Object.values(db.movements).filter((m) => (!from || m.date >= from) && (!to || m.date <= to));
}

function sortMovements(list: Movement[]): Movement[] {
  return list.sort((a, b) => b.date.localeCompare(a.date) || (b.updated ?? '').localeCompare(a.updated ?? '') || b.id.localeCompare(a.id));
}

function normalize(m: Movement): Movement {
  if (m.kind !== 'expense' && m.kind !== 'income') throw new Error('tipo de movimiento no válido');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date)) throw new Error(`fecha no válida: "${m.date}"`);
  if (!(m.amountCents > 0)) throw new Error('el importe tiene que ser mayor que cero');
  const name = m.name?.trim();
  if (!name) throw new Error('el movimiento necesita un nombre');
  let categoryId = m.categoryId;
  if (m.kind === 'expense') {
    if (!categoryId) throw new Error('el gasto necesita una categoría');
    if (!db.categories.some((c) => c.id === categoryId)) throw new Error('categoría no encontrada');
  } else categoryId = undefined;
  return { ...m, name, categoryId, updated: new Date().toISOString() };
}

function save(m: Movement): Movement {
  if (m.id && !db.movements[m.id]) throw new Error('movimiento no encontrado');
  const n = normalize(m);
  n.id = n.id || id();
  db.movements[n.id] = n;
  return n;
}

function remove(ids: string[]) { for (const x of ids) delete db.movements[x]; }

function query(f: Filter): Movement[] {
  const list = sortMovements(range(f.from, f.to));
  const catSet = new Set(f.categoryIds ?? []);
  const methodSet = new Set(f.methods ?? []);
  const q = fold((f.query ?? '').trim());
  const out = list.filter((m) => {
    if (f.kind && m.kind !== f.kind) return false;
    if (catSet.size && !catSet.has(m.categoryId ?? '')) return false;
    if (methodSet.size && !methodSet.has(m.method ?? '')) return false;
    if (f.minCents && m.amountCents < f.minCents) return false;
    if (f.maxCents && m.amountCents > f.maxCents) return false;
    if (q && !fold(m.name).includes(q) && !fold(m.counterparty ?? '').includes(q) && !fold(m.concept ?? '').includes(q)) return false;
    return true;
  });
  if (f.sort === 'amount') out.sort((a, b) => b.amountCents - a.amountCents);
  return out;
}

function summarize(f: Filter, today: string): Summary {
  const all = sortMovements(range());
  const out: Summary = { balanceCents: db.settings.openingCents, incomeCents: 0, expenseCents: 0, byCategory: null, top: null, trend: null, budget: null };

  for (const m of all) {
    if (db.settings.openingDate && m.date < db.settings.openingDate) continue;
    if (m.date > today) continue;
    out.balanceCents += m.kind === 'income' ? m.amountCents : -m.amountCents;
  }

  const filtered = query(f);
  const catTotals = new Map<string, CategoryTotal>();
  for (const m of filtered) {
    if (m.kind === 'income') { out.incomeCents += m.amountCents; continue; }
    out.expenseCents += m.amountCents;
    const key = m.categoryId ?? '';
    const ct = catTotals.get(key) ?? { categoryId: key, cents: 0, count: 0, share: 0 };
    ct.cents += m.amountCents;
    ct.count++;
    catTotals.set(key, ct);
  }
  const byCategory = [...catTotals.values()];
  for (const ct of byCategory) ct.share = out.expenseCents > 0 ? ct.cents / out.expenseCents : 0;
  byCategory.sort((a, b) => b.cents - a.cents);
  out.byCategory = byCategory.length ? byCategory : null;

  const top = filtered.filter((m) => m.kind === 'expense').sort((a, b) => b.amountCents - a.amountCents).slice(0, 10);
  out.top = top.length ? top : null;

  const endMonth = (f.to && f.to.length >= 7 ? f.to : today).slice(0, 7);
  const startMonth = addMonthsYM(endMonth, -11);
  const byMonth = new Map<string, MonthPoint>();
  for (const m of all) {
    const mo = monthOf(m.date);
    if (mo < startMonth || mo > endMonth) continue;
    const mp = byMonth.get(mo) ?? { month: mo, expense: 0, income: 0 };
    if (m.kind === 'income') mp.income += m.amountCents; else mp.expense += m.amountCents;
    byMonth.set(mo, mp);
  }
  const trend: MonthPoint[] = [];
  for (let mo = startMonth; mo <= endMonth; mo = addMonthsYM(mo, 1)) trend.push(byMonth.get(mo) ?? { month: mo, expense: 0, income: 0 });
  out.trend = trend;

  const budgetMonth = endMonth;
  const spent = new Map<string, number>();
  for (const m of all) {
    if (m.kind === 'expense' && monthOf(m.date) === budgetMonth) spent.set(m.categoryId ?? '', (spent.get(m.categoryId ?? '') ?? 0) + m.amountCents);
  }
  const specific = new Map<string, Budget>();
  const wildcard = new Map<string, Budget>();
  for (const b of db.budgets) {
    if (b.month === budgetMonth) specific.set(b.categoryId, b);
    else if (b.month === '*') wildcard.set(b.categoryId, b);
  }
  const catIds = new Set([...specific.keys(), ...wildcard.keys()]);
  const budget: BudgetLine[] = [];
  for (const catId of [...catIds].sort()) {
    const b = (specific.get(catId) ?? wildcard.get(catId))!;
    const sp = spent.get(catId) ?? 0;
    budget.push({ categoryId: catId, limitCents: b.limitCents, spentCents: sp, ratio: b.limitCents > 0 ? sp / b.limitCents : 0 });
  }
  out.budget = budget.length ? budget : null;

  return out;
}

function saveCategory(c: Category): Category {
  const name = c.name?.trim();
  if (!name) throw new Error('la categoría necesita un nombre');
  const idx = c.id ? db.categories.findIndex((x) => x.id === c.id) : -1;
  if (idx >= 0) {
    const out = { ...c, name, fixed: db.categories[idx].fixed };
    db.categories[idx] = out;
    return out;
  }
  const out = { ...c, id: c.id || id(), name, fixed: false };
  db.categories.push(out);
  return out;
}

function deleteCategory(categoryId: string) {
  const cat = db.categories.find((c) => c.id === categoryId);
  if (!cat) throw new Error('categoría no encontrada');
  if (cat.fixed) throw new Error('las categorías de serie no se pueden borrar');
  if (Object.values(db.movements).some((m) => m.categoryId === categoryId)) throw new Error('la categoría tiene movimientos: no se puede borrar');
  db.categories = db.categories.filter((c) => c.id !== categoryId);
}

function setBudget(b: Budget) {
  if (!b.categoryId || !b.month) throw new Error('el presupuesto necesita categoría y mes');
  const idx = db.budgets.findIndex((x) => x.month === b.month && x.categoryId === b.categoryId);
  if (b.limitCents === 0) {
    if (idx >= 0) db.budgets.splice(idx, 1);
    return;
  }
  const saved = { ...b, id: `${b.month}|${b.categoryId}` };
  if (idx >= 0) db.budgets[idx] = saved; else db.budgets.push(saved);
}

/** Métodos de Gastos del backend simulado (mismos nombres que en Go). */
export function gastosMock() {
  return {
    async GastosInit(): Promise<GastosInitData> { return clone({ today: todayISO(), categories: db.categories, budgets: db.budgets, settings: db.settings }); },
    async GastosRange(from: string, to: string): Promise<Movement[]> { return clone(sortMovements(range(from, to))); },
    async GastosQuery(f: Filter): Promise<Movement[]> { return clone(query(f)); },
    async GastosSummary(f: Filter): Promise<Summary> { return clone(summarize(f, todayISO())); },
    async GastosSave(m: Movement): Promise<Movement> { checkpoint(); const r = save(clone(m)); persist(); return clone(r); },
    async GastosDelete(ids: string[]): Promise<void> { checkpoint(); remove(ids); persist(); },
    async GastosUndo(): Promise<boolean> { const s = undo.pop(); if (!s) return false; db = JSON.parse(s); persist(); return true; },
    async GastosSaveCategory(c: Category): Promise<Category> { const r = saveCategory(clone(c)); persist(); return clone(r); },
    async GastosDeleteCategory(categoryId: string): Promise<void> { deleteCategory(categoryId); persist(); },
    async GastosSetBudget(b: Budget): Promise<void> { setBudget(clone(b)); persist(); },
    async GastosSaveSettings(v: Settings): Promise<void> { db.settings = clone(v); persist(); },
  };
}

export type GastosBackend = ReturnType<typeof gastosMock>;
