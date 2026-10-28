// Gráficas de Gastos, en SVG y HTML a mano (patrón de agenda/stats.ts): ritmo
// de gasto del mes, calendario de calor, evolución mensual y barra de progreso.
import { h } from '../ui/dom';
import { MONTHS_SHORT, WEEKDAYS_LETTER, weekday, longDate } from '../agenda/dates';
import type { MonthPoint } from './model';
import { fmtMoney, monthName } from './model';

const ns = 'http://www.w3.org/2000/svg';
function el(tag: string, attrs: Record<string, string | number>, text?: string) {
  const e = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text) e.textContent = text;
  return e;
}

/** «1,2 k€» para los ejes; por debajo de mil, el importe entero. */
export function abbrev(cents: number, currency: string): string {
  const sym = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency;
  return Math.abs(cents) >= 100000 ? `${(cents / 100000).toFixed(1).replace('.', ',')} k${sym}` : `${Math.round(cents / 100)} ${sym}`;
}

/**
 * Gasto acumulado del mes (línea continua, hasta hoy) frente al del mes anterior
 * (punteada). La distancia entre las dos es lo que se lee de un vistazo.
 */
export function paceChart(cur: number[], prev: number[], days: number, currency: string, compact = false): HTMLElement {
  // Más estrecha en el móvil: así los textos de los ejes no se encogen al escalar
  const W = compact ? 360 : 980, H = compact ? 150 : 190, pad = { l: 8, r: 52, t: 14, b: 22 };
  const top = Math.max(100, ...cur, ...prev) * 1.08;
  const x = (day: number) => pad.l + ((day - 1) / Math.max(1, days - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const path = (pts: number[]) => pts.map((v, i) => `${i ? 'L' : 'M'}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = cur.length ? cur[cur.length - 1] : 0;

  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'ag-chart gx-pace', role: 'img',
    'aria-label': `Gasto acumulado: ${fmtMoney(last, currency)} este mes${prev.length ? `, ${fmtMoney(prev[Math.min(prev.length, Math.max(1, cur.length)) - 1], currency)} el mes anterior a estas alturas` : ''}`,
  });
  for (const f of [0, 0.5, 1]) {
    const v = (top / 1.08) * f;
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'ag-grid' }));
    if (f) svg.append(el('text', { x: W - pad.r + 6, y: y(v) + 4, class: 'ag-axis' }, abbrev(v, currency)));
  }
  for (const d of [1, 8, 15, 22, days]) svg.append(el('text', { x: x(d), y: H - 5, class: 'ag-axis', 'text-anchor': d === 1 ? 'start' : d === days ? 'end' : 'middle' }, String(d)));
  if (prev.length) svg.append(el('path', { d: path(prev.slice(0, days)), class: 'gx-pace-prev' }));
  if (cur.length) {
    svg.append(el('path', { d: `${path(cur)} L${x(cur.length)},${y(0)} L${x(1)},${y(0)} Z`, class: 'gx-pace-area' }));
    svg.append(el('path', { d: path(cur), class: 'gx-pace-line' }));
    svg.append(el('circle', { cx: x(cur.length), cy: y(last), r: 4.5, class: 'gx-pace-dot' }));
  }
  return h('div', { class: 'ag-chart-wrap gx-pace-wrap' }, svg as unknown as HTMLElement);
}

/** Calendario del mes: cada día, más oscuro cuanto más se gastó. */
export function calendarHeat(month: string, spent: number[], income: number[], today: string, currency: string, onPick: (date: string) => void): HTMLElement {
  const first = `${month}-01`;
  const max = Math.max(1, ...spent);
  const grid = h('div', { class: 'gx-cal', role: 'grid', 'aria-label': `Gasto por día en ${monthName(month)}` },
    ...WEEKDAYS_LETTER.map((l) => h('span', { class: 'gx-cal-wd', 'aria-hidden': 'true' }, l)));
  for (let i = 1; i < weekday(first); i++) grid.append(h('span', { class: 'gx-cal-pad' }));
  spent.forEach((cents, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    const future = date > today;
    // Raíz cuadrada: un solo gasto grande no deja todos los demás días en blanco
    const level = cents ? 0.18 + 0.82 * Math.sqrt(cents / max) : 0;
    grid.append(h('button', {
      type: 'button', class: `gx-cal-day ${date === today ? 'is-today' : ''} ${future ? 'is-future' : ''} ${level > 0.62 ? 'is-hot' : ''}`,
      style: { '--i': level.toFixed(3) }, disabled: future,
      'aria-label': `${longDate(date, false)}: ${cents ? `${fmtMoney(cents, currency)} gastados` : 'sin gastos'}${income[i] ? `, ingresos ${fmtMoney(income[i], currency)}` : ''}`,
      title: `${longDate(date, false)} · ${cents ? fmtMoney(cents, currency) : 'sin gastos'}`,
      onclick: () => onPick(date),
    },
    h('span', { class: 'gx-cal-n' }, String(i + 1)),
    cents ? h('span', { class: 'gx-cal-amt' }, abbrev(cents, currency)) : null,
    income[i] ? h('span', { class: 'gx-cal-inc', 'aria-hidden': 'true' }) : null));
  });
  return grid;
}

/** Columnas de gasto e ingreso por mes; el mes elegido, resaltado. */
export function monthlyTrend(points: MonthPoint[], currency: string, current: string, compact = false): HTMLElement {
  if (!points.length) return h('p', { class: 'muted small' }, 'Sin datos suficientes.');
  const W = compact ? 360 : 460, H = 160, pad = { l: 44, r: 8, t: 10, b: 22 };
  const n = points.length;
  const top = Math.max(100, ...points.map((p) => Math.max(p.expense, p.income)));
  const groupW = (W - pad.l - pad.r) / n;
  const barW = Math.min(22, Math.max(3, groupW / 2 - 4));
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ag-chart', role: 'img', 'aria-label': `Ingresos y gastos de los últimos ${n} meses` });
  for (let i = 0; i <= 2; i++) {
    const v = (top * i) / 2;
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'ag-grid' }));
    svg.append(el('text', { x: pad.l - 6, y: y(v) + 4, class: 'ag-axis', 'text-anchor': 'end' }, abbrev(v, currency)));
  }
  points.forEach((p, i) => {
    const cx = pad.l + i * groupW + groupW / 2;
    const g = el('g', { class: `gx-trend-g ${p.month === current ? 'is-current' : ''}` });
    for (const [v, cls, dx, label] of [[p.expense, 'gx-trend-exp', -barW - 2, 'gastos'], [p.income, 'gx-trend-inc', 2, 'ingresos']] as const) {
      const bh = Math.max(v ? 2 : 0, y(0) - y(v));
      const r = el('rect', { x: cx + dx, y: y(0) - bh, width: barW, height: bh, rx: 3, class: cls });
      r.append(el('title', {}, `${monthName(p.month)} de ${p.month.slice(0, 4)}: ${label} ${fmtMoney(v, currency)}`));
      g.append(r);
    }
    g.append(el('text', { x: cx, y: H - 5, class: 'ag-axis gx-trend-label', 'text-anchor': 'middle' }, MONTHS_SHORT[Number(p.month.slice(5, 7)) - 1]));
    svg.append(g);
  });
  const legend = h('div', { class: 'gx-legend' },
    h('span', {}, h('span', { class: 'gx-sw gx-sw-exp' }), 'Gastos'),
    h('span', {}, h('span', { class: 'gx-sw gx-sw-inc' }), 'Ingresos'));
  return h('div', {}, h('div', { class: 'ag-chart-wrap' }, svg as unknown as HTMLElement), legend);
}

/** Barra de progreso: verde, ámbar desde el 80 % y roja al pasarse; la marca es el ritmo ideal de hoy. */
export function progressBar(ratio: number, pace?: number, color?: string): HTMLElement {
  const cls = ratio >= 1 ? 'is-over' : ratio >= 0.8 ? 'is-warn' : 'is-ok';
  return h('div', { class: `gx-meter ${cls}`, role: 'presentation' },
    h('span', { class: 'gx-meter-fill', style: { width: `${Math.min(100, Math.max(0, ratio * 100))}%`, ...(color && cls === 'is-ok' ? { '--c': color } : {}) } }),
    pace !== undefined && pace > 0 && pace < 1 ? h('span', { class: 'gx-meter-pace', style: { left: `${pace * 100}%` }, title: 'Ritmo ideal a día de hoy' }) : null);
}
