// Tipos de Gastos (espejo de internal/gastos en Go). Los importes siempre van
// en céntimos (number entero): nunca en coma flotante.
import { MONTHS } from '../agenda/dates';

export type Kind = 'expense' | 'income';
export type Method = '' | 'monthly' | 'bizum' | 'transfer' | 'cash' | 'card';

export interface Category {
  id: string;
  name: string;
  color: string;
  /** Clave de ui/icons.ts. */
  icon: string;
  /** Las 8 de serie no se pueden borrar. */
  fixed: boolean;
}

export interface Movement {
  id: string;
  kind: Kind;
  /** AAAA-MM-DD. */
  date: string;
  /** Gasto: nombre; ingreso: descripción. */
  name: string;
  /** Obligatoria en gastos; vacía en ingresos. */
  categoryId?: string;
  amountCents: number;
  method?: Method;
  /** Emisor (ingreso) o destinatario (gasto por transferencia o Bizum). */
  counterparty?: string;
  concept?: string;
  /** RFC3339; lo pone el backend. */
  updated?: string;
}

export interface Budget {
  /** month+"|"+categoryId; solo para que la sincronización pueda fusionar la lista. */
  id?: string;
  /** AAAA-MM, o "*" = todos los meses. */
  month: string;
  categoryId: string;
  limitCents: number;
}

export interface Settings {
  currency: string;
  /** Saldo inicial, en céntimos. */
  openingCents: number;
  /** AAAA-MM-DD. */
  openingDate: string;
}

export interface GastosInitData {
  today: string;
  categories: Category[];
  budgets: Budget[];
  settings: Settings;
}

export interface Filter {
  from?: string;
  to?: string;
  /** "" = ambos. */
  kind?: Kind | '';
  categoryIds?: string[];
  methods?: Method[];
  /** En name, counterparty y concept, sin distinguir mayúsculas ni tildes. */
  query?: string;
  minCents?: number;
  /** 0 = sin máximo. */
  maxCents?: number;
  sort?: 'date' | 'amount';
}

export interface CategoryTotal {
  categoryId: string;
  cents: number;
  count: number;
  share: number;
}

export interface MonthPoint {
  month: string;
  expense: number;
  income: number;
}

export interface BudgetLine {
  categoryId: string;
  limitCents: number;
  spentCents: number;
  /** spent/limit. */
  ratio: number;
}

export interface Summary {
  /** openingCents + Σingresos − Σgastos (desde openingDate hasta hoy, incluido). */
  balanceCents: number;
  /** Del periodo filtrado. */
  incomeCents: number;
  expenseCents: number;
  /** Gastos, de mayor a menor. */
  byCategory: CategoryTotal[] | null;
  /** 10 gastos de mayor importe del periodo. */
  top: Movement[] | null;
  /** Los últimos 12 meses, terminando en el mes de «to» (o en el actual). */
  trend: MonthPoint[] | null;
  /** Mes de «to» (o el actual). */
  budget: BudgetLine[] | null;
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'compra', name: 'Compra', color: '#2f74c0', icon: 'wallet', fixed: true },
  { id: 'ocio', name: 'Ocio', color: '#7552c4', icon: 'music', fixed: true },
  { id: 'comunes', name: 'Gastos comunes', color: '#a87700', icon: 'home', fixed: true },
  { id: 'luz', name: 'Luz', color: '#e0a400', icon: 'sun', fixed: true },
  { id: 'agua', name: 'Agua', color: '#1f9bb5', icon: 'cloud', fixed: true },
  { id: 'gas', name: 'Gas', color: '#d0652b', icon: 'flame', fixed: true },
  { id: 'estudio', name: 'Estudio', color: '#2e8b4e', icon: 'graduation', fixed: true },
  { id: 'gimnasio', name: 'Gimnasio', color: '#c33b3b', icon: 'activity', fixed: true },
];

/** «1.234,56 €» con la moneda indicada. */
export function fmtMoney(cents: number, cur = 'EUR'): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: cur }).format(cents / 100);
}

/** Nombre del mes de un «AAAA-MM» («octubre»). */
export function monthName(month: string): string {
  return MONTHS[Number(month.slice(5, 7)) - 1];
}

/** Interpreta «12,50», «12.50» o «12» como céntimos; null si no es un importe válido. */
export function parseMoney(s: string): number | null {
  const t = s.trim().replace(/[^\d,.-]/g, '');
  if (!t) return null;
  const normalized = /,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}
