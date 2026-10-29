// Controlador de Gastos. El mes es el eje (‹ Octubre ›) y hay tres pestañas:
// Resumen (cuánto llevas y a qué ritmo), Movimientos y Presupuestos. Mismo
// contrato que app.agenda: mount, show, hide, reload y newMovement.
import type { App } from '../app';
import { api } from '../api';
import { on } from '../bus';
import { h, confirmDialog } from '../ui/dom';
import { icon } from '../ui/icons';
import { todayISO } from '../agenda/dates';
import type { Filter, Movement, Summary } from './model';
import { fmtMoney } from './model';
import { categoryTotals, monthBounds, monthTitle, shiftMonth } from './calc';
import { progressBar } from './charts';
import { GastosState } from './state';
import { renderMovements } from './list';
import { movementDialog } from './editor';
import { gastosSettingsDialog } from './settings';
import { renderSummary } from './summary';
import { renderBudget } from './budget';
import './gastos.css';

export type Tab = 'summary' | 'movs' | 'budget';
const TAB_KEY = 'folio-gastos-tab';
const FILTER_KEY = 'folio-gastos-filter';

function loadFilter(): Filter {
  try {
    const f = JSON.parse(localStorage.getItem(FILTER_KEY) || '{}');
    return f && typeof f === 'object' ? { ...f, from: undefined, to: undefined } : {};
  } catch { return {}; }
}

export class GastosView {
  state = new GastosState();
  root = h('section', { id: 'gastos', class: 'gastos', 'aria-label': 'Gastos', hidden: true });
  sidebar = h('div', { class: 'gx-side' });
  /** Filtros de la lista (el mes lo pone la cabecera). */
  filter: Filter = loadFilter();
  /** La lista muestra el mes visible o todo el historial. */
  scope: 'month' | 'all' = 'month';
  /** Día elegido en el calendario del resumen: la lista muestra solo ese día. */
  day = '';
  month = todayISO().slice(0, 7);
  tab: Tab = 'summary';
  monthMovs: Movement[] = [];
  prevMovs: Movement[] = [];
  listMovs: Movement[] = [];
  /** Todo el historial, para la evolución semanal, mensual y anual. */
  allMovs: Movement[] = [];
  summary: Summary | null = null;
  selection = new Set<string>();
  get mobile() { return document.body.classList.contains('is-mobile'); }
  get currency() { return this.state.settings?.currency ?? 'EUR'; }
  get isCurrentMonth() { return this.month === this.state.today.slice(0, 7); }
  /** Límites del mes visible (para quien necesite el rango). */
  get rangeTo() { return monthBounds(this.month)[1]; }

  private body = h('div', { class: 'gx-body' });
  private monthLabel = h('button', { type: 'button', class: 'gx-month', title: 'Volver al mes actual' });
  private todayBtn = h('button', { type: 'button', class: 'btn btn-sm btn-ghost gx-today' }, 'Hoy');
  private tabsSeg = h('div', { class: 'seg gx-tabs', role: 'tablist', 'aria-label': 'Secciones de Gastos' });
  private selbar = h('div', { class: 'gx-selbar', role: 'toolbar', 'aria-label': 'Movimientos seleccionados', hidden: true });
  private started = false;
  private loadToken = 0;
  private pending: Promise<void> | null = null;

  constructor(readonly app: App) {
    try {
      const t = localStorage.getItem(TAB_KEY);
      if (t === 'summary' || t === 'movs' || t === 'budget') this.tab = t;
    } catch { /* */ }
  }

  async mount(container: HTMLElement) {
    if (this.started) return;
    this.started = true;
    if (!this.root.isConnected) container.append(this.root);
    await this.state.load();
    this.month = this.state.today.slice(0, 7);
    this.buildHead();
    on('gastos:changed', () => void this.reload());
    await this.reload();
  }

  show() {
    this.root.hidden = false;
    if (this.started) void this.reload();
  }

  hide() { this.root.hidden = true; }

  // ---------- Cabecera ----------

  private buildHead() {
    const prev = h('button', { type: 'button', class: 'icon-btn', title: 'Mes anterior', 'aria-label': 'Mes anterior', html: icon('chevronLeft', 18), onclick: () => this.stepMonth(-1) });
    const next = h('button', { type: 'button', class: 'icon-btn', title: 'Mes siguiente', 'aria-label': 'Mes siguiente', html: icon('chevronRight', 18), onclick: () => this.stepMonth(1) });
    const goToday = () => { this.month = this.state.today.slice(0, 7); this.day = ''; void this.reload(); };
    this.monthLabel.onclick = goToday;
    this.todayBtn.onclick = goToday;
    const nav = h('div', { class: 'gx-month-nav' }, prev, this.monthLabel, next, this.todayBtn);

    const settingsBtn = h('button', { type: 'button', class: 'icon-btn', title: 'Ajustes de Gastos', 'aria-label': 'Ajustes de Gastos', html: icon('settings', 17), onclick: () => void gastosSettingsDialog(this) });
    const addBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => this.newMovement() }, h('span', { html: icon('plus', 15) }), 'Añadir');
    this.drawTabs();

    // En el móvil, el título y Ajustes ya están en la barra superior (los de Gastos, en Más)
    const head = this.mobile
      ? h('header', { class: 'gx-head' },
        h('div', { class: 'gx-head-row' }, nav),
        h('div', { class: 'gx-head-row' }, this.tabsSeg))
      : h('header', { class: 'gx-head' },
        h('div', { class: 'gx-head-row' }, nav, h('div', { class: 'spacer' }), this.tabsSeg, h('div', { class: 'spacer' }), settingsBtn, addBtn));
    this.root.append(head, this.body, this.selbar);
  }

  private drawTabs() {
    const tabs: [Tab, string][] = [['summary', 'Resumen'], ['movs', 'Movimientos'], ['budget', 'Presupuestos']];
    this.tabsSeg.replaceChildren(...tabs.map(([t, l]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(this.tab === t), class: `seg-btn ${this.tab === t ? 'on' : ''}`, onclick: () => this.setTab(t),
    }, l)));
  }

  setTab(t: Tab) {
    this.tab = t;
    try { localStorage.setItem(TAB_KEY, t); } catch { /* */ }
    this.selection.clear();
    this.drawTabs();
    this.renderBody();
    this.updateSelbar();
    this.body.scrollTop = 0;
  }

  private stepMonth(dir: number) {
    this.month = shiftMonth(this.month, dir);
    this.day = '';
    void this.reload();
  }

  // ---------- Datos ----------

  setFilter(f: Filter) {
    this.filter = f;
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch { /* */ }
    void this.reload();
  }

  setScope(s: 'month' | 'all') { this.scope = s; this.day = ''; void this.reload(); }

  /** Abre la lista con solo esa categoría. */
  openCategory(id: string) {
    this.day = '';
    this.filter = { ...this.filter, categoryIds: [id], kind: undefined };
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(this.filter)); } catch { /* */ }
    this.tab = 'movs';
    this.drawTabs();
    void this.reload();
  }

  /** Abre la lista con solo los movimientos de ese día. */
  pickDay(date: string) {
    this.day = date;
    this.scope = 'month';
    this.setTab('movs');
  }

  clearDay() { this.day = ''; this.renderBody(); }

  reload(): Promise<void> {
    this.pending ??= new Promise<void>((resolve) => queueMicrotask(() => { this.pending = null; void this.doReload().then(resolve); }));
    return this.pending;
  }

  private async doReload() {
    if (!this.started) return;
    const token = ++this.loadToken;
    await this.state.load();
    const [from, to] = monthBounds(this.month);
    const [pf, pt] = monthBounds(shiftMonth(this.month, -1));
    const listFilter: Filter = { ...this.filter, from: this.scope === 'month' ? from : '', to: this.scope === 'month' ? to : '' };
    const [monthMovs, prevMovs, listMovs, allMovs, summary] = await Promise.all([
      this.state.query({ from, to }),
      this.state.query({ from: pf, to: pt }),
      this.state.query(listFilter),
      this.state.query({}),
      api.GastosSummary({ from, to }),
    ]);
    if (token !== this.loadToken) return;
    Object.assign(this, { monthMovs, prevMovs, listMovs, allMovs, summary });
    this.selection.clear();
    this.monthLabel.textContent = monthTitle(this.month, this.state.today);
    this.todayBtn.hidden = this.isCurrentMonth;
    this.renderSidebar();
    this.renderBody();
    this.updateSelbar();
  }

  private renderSidebar() {
    if (this.mobile) return;
    const totals = categoryTotals(this.monthMovs);
    const budget = new Map((this.summary?.budget ?? []).map((b) => [b.categoryId, b]));
    const selected = new Set(this.filter.categoryIds ?? []);
    const rows = this.state.categories.map((c) => {
      const b = budget.get(c.id);
      const spent = totals.get(c.id)?.cents ?? 0;
      return h('button', {
        type: 'button', class: `gx-side-cat ${selected.has(c.id) && this.tab === 'movs' ? 'is-on' : ''}`, onclick: () => this.openCategory(c.id),
        title: b ? `${fmtMoney(spent, this.currency)} de ${fmtMoney(b.limitCents, this.currency)}` : undefined,
      },
      h('span', { class: 'gx-side-top' },
        h('span', { class: 'gx-side-dot', style: { '--c': c.color } }),
        h('span', { class: 'gx-side-name' }, c.name),
        h('span', { class: 'gx-side-total' }, spent ? fmtMoney(spent, this.currency) : '—')),
      b ? progressBar(b.ratio, undefined, c.color) : null);
    });
    this.sidebar.replaceChildren(
      h('div', { class: 'sb-title' }, h('span', {}, 'Categorías', h('span', { class: 'muted small' }, ` · ${monthTitle(this.month, this.state.today).toLowerCase()}`))),
      h('div', { class: 'gx-side-list' }, ...rows));
  }

  renderBody() {
    if (this.tab === 'summary') renderSummary(this, this.body);
    else if (this.tab === 'movs') renderMovements(this, this.body);
    else renderBudget(this, this.body);
  }

  // ---------- Selección ----------

  toggleSelect(id: string) {
    if (this.selection.has(id)) this.selection.delete(id); else this.selection.add(id);
    this.renderBody();
    this.updateSelbar();
  }

  private updateSelbar() {
    const n = this.selection.size;
    this.selbar.hidden = n === 0;
    if (!n) return;
    this.selbar.replaceChildren(
      h('span', { class: 'gx-selbar-count' }, n === 1 ? '1 movimiento seleccionado' : `${n} movimientos seleccionados`),
      h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost', onclick: () => void this.deleteSelected() },
        h('span', { html: icon('trash', 14) }), 'Eliminar'),
      h('div', { class: 'spacer' }),
      h('button', { type: 'button', class: 'icon-btn', title: 'Quitar selección', 'aria-label': 'Quitar selección', html: icon('x', 15), onclick: () => { this.selection.clear(); this.renderBody(); this.updateSelbar(); } }));
  }

  private async deleteSelected() {
    const ids = [...this.selection];
    if (!ids.length) return;
    if (!await confirmDialog('Eliminar movimientos', `¿Borrar ${ids.length} ${ids.length === 1 ? 'movimiento' : 'movimientos'}? Se puede deshacer.`, 'Eliminar', true)) return;
    await this.state.deleteMovements(ids, `${ids.length} ${ids.length === 1 ? 'movimiento eliminado' : 'movimientos eliminados'}`);
    await this.reload();
  }

  // ---------- Acciones ----------

  newMovement(kind?: 'expense' | 'income') {
    // En un mes pasado, el movimiento nuevo cae en ese mes (su último día)
    const date = this.isCurrentMonth || this.month > this.state.today.slice(0, 7) ? undefined : monthBounds(this.month)[1];
    void movementDialog(this, { kind, date });
  }

  openMovement(m: Movement) { void movementDialog(this, { movement: m }); }
}
