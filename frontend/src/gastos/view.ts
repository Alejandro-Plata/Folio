// Controlador de Gastos: cabecera con el periodo y los filtros, tarjeta de
// saldo, pestañas (Movimientos, con Resumen y Presupuesto pendientes de la
// fase siguiente) y la lista de movimientos. Mismo contrato que app.agenda.
import type { App } from '../app';
import { api } from '../api';
import { on } from '../bus';
import { h, confirmDialog } from '../ui/dom';
import { icon } from '../ui/icons';
import { addDays, addMonths, endOfMonth, longDate, startOfMonth, startOfWeek, todayISO } from '../agenda/dates';
import type { Filter, Movement, Summary } from './model';
import { fmtMoney } from './model';
import { GastosState } from './state';
import { renderList } from './list';
import { movementDialog } from './editor';
import { filtersDialog, activeFilterCount } from './filters';
import { gastosSettingsDialog } from './settings';
import { renderSummary } from './summary';
import { renderBudget } from './budget';
import './gastos.css';

type Period = 'week' | 'month' | 'all' | 'custom';
const PERIOD_KEY = 'folio-gastos-period';
const FILTER_KEY = 'folio-gastos-filter';

function loadFilter(): Filter {
  try {
    const f = JSON.parse(localStorage.getItem(FILTER_KEY) || '{}');
    return f && typeof f === 'object' ? f : {};
  } catch { return {}; }
}

export class GastosView {
  state = new GastosState();
  root = h('section', { id: 'gastos', class: 'gastos', 'aria-label': 'Gastos', hidden: true });
  sidebar = h('div', { class: 'gx-side' });
  filter: Filter = loadFilter();
  period: Period = 'month';
  cursor = todayISO();
  customFrom = '';
  customTo = '';
  tab: 'movs' | 'summary' | 'budget' = 'movs';
  movements: Movement[] = [];
  summary: Summary | null = null;
  /** Límites del periodo visible, calculados en el último reload (vacíos si es «General»). */
  rangeFrom = '';
  rangeTo = '';
  selection = new Set<string>();
  get mobile() { return document.body.classList.contains('is-mobile'); }

  private body = h('div', { class: 'gx-body' });
  private balanceEl = h('div', { class: 'gx-balance' });
  private periodSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Periodo' });
  private periodNav = h('div', { class: 'gx-period-nav' });
  private customBox = h('div', { class: 'ag-inline', hidden: true });
  private periodLabel = h('span', { class: 'gx-period-label' });
  private filterBtn = h('button', { type: 'button', class: 'btn btn-sm btn-ghost' });
  private tabsSeg = h('div', { class: 'seg gx-tabs' });
  private selbar = h('div', { class: 'gx-selbar', role: 'toolbar', 'aria-label': 'Movimientos seleccionados', hidden: true });
  private started = false;
  private loadToken = 0;
  private pending: Promise<void> | null = null;

  constructor(readonly app: App) {
    try {
      const saved = localStorage.getItem(PERIOD_KEY);
      if (saved === 'week' || saved === 'month' || saved === 'all') this.period = saved;
    } catch { /* */ }
  }

  async mount(container: HTMLElement) {
    if (this.started) return;
    this.started = true;
    if (!this.root.isConnected) container.append(this.root);
    await this.state.load();
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
    const periods: [Period, string][] = [['week', 'Semana'], ['month', 'Mes'], ['all', 'General'], ['custom', 'Personalizado']];
    const drawPeriodSeg = () => this.periodSeg.replaceChildren(...periods.map(([p, l]) => h('button', {
      type: 'button', class: `seg-btn ${this.period === p ? 'on' : ''}`, onclick: () => { this.period = p; this.persistPeriod(); void this.reload(); },
    }, l)));
    drawPeriodSeg();
    this.redrawPeriodSeg = drawPeriodSeg;

    const prev = h('button', { type: 'button', class: 'icon-btn', title: 'Periodo anterior', 'aria-label': 'Periodo anterior', html: icon('chevronLeft', 16), onclick: () => this.stepPeriod(-1) });
    const next = h('button', { type: 'button', class: 'icon-btn', title: 'Periodo siguiente', 'aria-label': 'Periodo siguiente', html: icon('chevronRight', 16), onclick: () => this.stepPeriod(1) });
    this.periodNav.replaceChildren(prev, this.periodLabel, next);

    const fromInput = h('input', { class: 'input input-sm', type: 'date' });
    const toInput = h('input', { class: 'input input-sm', type: 'date' });
    fromInput.addEventListener('change', () => { this.customFrom = fromInput.value; void this.reload(); });
    toInput.addEventListener('change', () => { this.customTo = toInput.value; void this.reload(); });
    this.customBox.replaceChildren(fromInput, h('span', { 'aria-hidden': 'true' }, '–'), toInput);
    this.syncCustomInputs = () => { fromInput.value = this.customFrom; toInput.value = this.customTo; };

    this.filterBtn.replaceChildren(h('span', { html: icon('filter', 15) }), 'Filtros');
    this.filterBtn.onclick = () => void filtersDialog(this);

    const addBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => this.newMovement() }, h('span', { html: icon('plus', 15) }), 'Añadir');
    const settingsBtn = h('button', { type: 'button', class: 'icon-btn', title: 'Ajustes de Gastos', 'aria-label': 'Ajustes de Gastos', html: icon('settings', 16), onclick: () => void gastosSettingsDialog(this) });

    const tabs: ['movs' | 'summary' | 'budget', string][] = [['movs', 'Movimientos'], ['summary', 'Resumen'], ['budget', 'Presupuesto']];
    const drawTabs = () => this.tabsSeg.replaceChildren(...tabs.map(([t, l]) => h('button', {
      type: 'button', class: `seg-btn ${this.tab === t ? 'on' : ''}`, onclick: () => { this.tab = t; drawTabs(); this.renderBody(); },
    }, l)));
    drawTabs();

    const row1 = this.mobile ? null : h('div', { class: 'gx-head-row' },
      h('h2', { class: 'gx-title' }, 'Gastos'), h('div', { class: 'spacer' }), settingsBtn, addBtn);
    const row2 = h('div', { class: 'gx-head-row' }, this.periodSeg, this.periodNav, this.customBox, h('div', { class: 'spacer' }), this.filterBtn);
    const row3 = h('div', { class: 'gx-head-row' }, this.tabsSeg);
    const head = h('header', { class: 'gx-head' }, row1, row2, row3);
    this.root.append(head, this.balanceEl, this.body, this.selbar);
  }

  private redrawPeriodSeg = () => { /* se reemplaza en buildHead */ };
  private syncCustomInputs = () => { /* se reemplaza en buildHead */ };

  private bounds(): [string, string] {
    if (this.period === 'week') return [startOfWeek(this.cursor), addDays(startOfWeek(this.cursor), 6)];
    if (this.period === 'month') return [startOfMonth(this.cursor), endOfMonth(this.cursor)];
    if (this.period === 'custom') return [this.customFrom || this.state.today, this.customTo || this.state.today];
    return ['', ''];
  }

  private stepPeriod(dir: number) {
    if (this.period === 'week') this.cursor = addDays(this.cursor, dir * 7);
    else if (this.period === 'month') this.cursor = addMonths(this.cursor, dir);
    else return;
    void this.reload();
  }

  private persistPeriod() { try { localStorage.setItem(PERIOD_KEY, this.period); } catch { /* */ } }

  private updateHead() {
    this.redrawPeriodSeg();
    this.customBox.hidden = this.period !== 'custom';
    if (this.period === 'custom' && !this.customFrom) { this.customFrom = startOfMonth(this.state.today); this.customTo = this.state.today; }
    this.syncCustomInputs();
    this.periodNav.hidden = this.period === 'all' || this.period === 'custom';
    const [from, to] = this.bounds();
    this.periodLabel.textContent = this.period === 'all' ? '' : this.period === 'week' ? `${longDate(from, false)} – ${longDate(to, false)}` : this.period === 'month' ? longDate(from, false).replace(/^\S+\s/, '') : '';
    const n = activeFilterCount(this.filter);
    this.filterBtn.replaceChildren(h('span', { html: icon('filter', 15) }), `Filtros${n ? ` (${n})` : ''}`);
  }

  // ---------- Datos ----------

  setFilter(f: Filter) {
    this.filter = f;
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch { /* */ }
    void this.reload();
  }

  reload(): Promise<void> {
    this.pending ??= new Promise<void>((resolve) => queueMicrotask(() => { this.pending = null; void this.doReload().then(resolve); }));
    return this.pending;
  }

  private async doReload() {
    if (!this.started) return;
    const token = ++this.loadToken;
    await this.state.load();
    this.updateHead();
    const [from, to] = this.bounds();
    this.rangeFrom = from;
    this.rangeTo = to;
    const filter: Filter = { ...this.filter, from, to };
    const monthFilter: Filter = { from: startOfMonth(this.state.today), to: endOfMonth(this.state.today) };
    const [movements, summary, monthSummary] = await Promise.all([
      this.state.query(filter),
      api.GastosSummary(filter),
      api.GastosSummary(monthFilter),
    ]);
    if (token !== this.loadToken) return;
    this.movements = movements;
    this.summary = summary;
    this.selection.clear();
    this.renderBalance();
    this.renderSidebar(monthSummary);
    this.renderBody();
    this.updateSelbar();
  }

  private renderBalance() {
    const s = this.summary;
    if (!s) { this.balanceEl.replaceChildren(); return; }
    const cur = this.state.settings.currency;
    this.balanceEl.replaceChildren(
      h('div', { class: `gx-balance-amount ${s.balanceCents < 0 ? 'is-neg' : ''}` }, fmtMoney(s.balanceCents, cur)),
      h('div', { class: 'gx-balance-sub' }, `Ingresos +${fmtMoney(s.incomeCents, cur)} · Gastos −${fmtMoney(s.expenseCents, cur)}`));
  }

  private renderSidebar(monthSummary: Summary) {
    if (this.mobile) return;
    const totals = new Map((monthSummary.byCategory ?? []).map((c) => [c.categoryId, c.cents]));
    const selected = new Set(this.filter.categoryIds ?? []);
    const cur = this.state.settings.currency;
    const rows = this.state.categories.map((c) => h('button', {
      type: 'button', class: `gx-side-cat ${selected.has(c.id) ? 'is-on' : ''}`,
      onclick: () => {
        const ids = new Set(this.filter.categoryIds ?? []);
        if (ids.has(c.id)) ids.delete(c.id); else ids.add(c.id);
        this.setFilter({ ...this.filter, categoryIds: ids.size ? [...ids] : undefined });
      },
    },
    h('span', { class: 'gx-side-dot', style: { '--c': c.color } }),
    h('span', { class: 'gx-side-name' }, c.name),
    h('span', { class: 'gx-side-total' }, totals.has(c.id) ? fmtMoney(totals.get(c.id)!, cur) : '—')));
    this.sidebar.replaceChildren(
      h('div', { class: 'sb-title' }, h('span', {}, 'Categorías', h('span', { class: 'muted small' }, ' este mes'))),
      h('div', { class: 'gx-side-list' }, ...rows),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost gx-side-settings', onclick: () => void gastosSettingsDialog(this) },
        h('span', { html: icon('settings', 14) }), 'Ajustes de Gastos'));
  }

  private bodyToken = 0;

  private renderBody() {
    const token = ++this.bodyToken;
    if (this.tab === 'movs') { renderList(this, this.body, this.movements); return; }
    if (this.tab === 'summary') { void renderSummary(this, this.body, () => token === this.bodyToken); return; }
    renderBudget(this, this.body);
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
        h('span', { html: icon('trash', 14) }), 'Eliminar seleccionados'),
      h('div', { class: 'spacer' }),
      h('button', { type: 'button', class: 'icon-btn', title: 'Quitar selección', 'aria-label': 'Quitar selección', html: icon('x', 15), onclick: () => { this.selection.clear(); this.renderBody(); this.updateSelbar(); } }));
  }

  private async deleteSelected() {
    const ids = [...this.selection];
    if (!ids.length) return;
    if (!await confirmDialog('Eliminar movimientos', `¿Borrar ${ids.length} ${ids.length === 1 ? 'movimiento' : 'movimientos'}? Se puede deshacer.`, 'Eliminar', true)) return;
    await this.state.deleteMovements(ids, `${ids.length} ${ids.length === 1 ? 'movimiento' : 'movimientos'} eliminados`);
    await this.reload();
  }

  // ---------- Acciones ----------

  newMovement(kind?: 'expense' | 'income') { void movementDialog(this, { kind }); }

  openMovement(m: Movement) { void movementDialog(this, { movement: m }); }
}
