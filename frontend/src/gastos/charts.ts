// Gráficas de Gastos, en SVG y HTML a mano (patrón de agenda/stats.ts): ritmo
// de gasto del mes, calendario de calor, evolución por periodos y barra de progreso.
import { h } from '../ui/dom';
import { WEEKDAYS_LETTER, weekday, longDate } from '../agenda/dates';
import type { PeriodPoint } from './calc';
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

/**
 * Evolución por periodos: arriba, el saldo al cerrar cada uno (línea); abajo,
 * ingresos y gastos (columnas). El periodo elegido, resaltado.
 */
export function evolutionChart(points: PeriodPoint[], currency: string, currentKey: string, compact = false): HTMLElement {
  if (!points.length) return h('p', { class: 'muted small' }, 'Sin datos suficientes.');
  const W = compact ? 360 : 980, H = compact ? 250 : 270, pad = { l: 8, r: 52, t: 22, b: 22 };
  const n = points.length;
  const groupW = (W - pad.l - pad.r) / n;
  const cx = (i: number) => pad.l + i * groupW + groupW / 2;

  const lineTop = pad.t, lineBot = Math.round(H * 0.4);
  const bal = points.map((p) => p.balance).filter((v): v is number => v !== null);
  const lo = Math.min(0, ...bal), hi = Math.max(100, ...bal);
  const yl = (v: number) => lineTop + (1 - (v - lo) / (hi - lo)) * (lineBot - lineTop);

  const barTop = lineBot + 34, barBot = H - pad.b;
  const topBar = Math.max(100, ...points.flatMap((p) => [p.income, p.expense]));
  const yb = (v: number) => barTop + (1 - v / topBar) * (barBot - barTop);
  const barW = Math.min(22, Math.max(3, groupW / 2 - 4));

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ag-chart gx-evo', role: 'img', 'aria-label': `Saldo, ingresos y gastos de los últimos ${n} periodos` });
  svg.append(el('text', { x: pad.l, y: lineTop - 8, class: 'ag-axis gx-evo-cap' }, 'Saldo'));
  for (const v of lo < 0 ? [lo, 0, hi] : [0, hi]) {
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: yl(v), y2: yl(v), class: v === 0 && lo < 0 ? 'ag-grid gx-evo-zero' : 'ag-grid' }));
    svg.append(el('text', { x: W - pad.r + 6, y: yl(v) + 4, class: 'ag-axis' }, abbrev(v, currency)));
  }
  svg.append(el('text', { x: pad.l, y: barTop - 8, class: 'ag-axis gx-evo-cap' }, 'Ingresos y gastos'));
  for (const v of [0, topBar]) {
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: yb(v), y2: yb(v), class: 'ag-grid' }));
    if (v) svg.append(el('text', { x: W - pad.r + 6, y: yb(v) + 4, class: 'ag-axis' }, abbrev(v, currency)));
  }

  // Tramos de la línea: se corta donde no hay saldo (antes del inicial o en el futuro)
  let d = '';
  points.forEach((p, i) => {
    if (p.balance === null) return;
    d += `${i && points[i - 1].balance !== null ? 'L' : 'M'}${cx(i).toFixed(1)},${yl(p.balance).toFixed(1)}`;
  });
  if (d) svg.append(el('path', { d, class: 'gx-evo-line' }));

  const maxLen = Math.max(...points.map((p) => p.label.length));
  const every = Math.max(1, Math.ceil((maxLen * 6.4 + 8) / groupW));
  points.forEach((p, i) => {
    const current = p.key === currentKey;
    const g = el('g', { class: `gx-trend-g ${current ? 'is-current' : ''}` });
    for (const [v, cls, dx] of [[p.expense, 'gx-trend-exp', -barW - 2], [p.income, 'gx-trend-inc', 2]] as const) {
      const bh = Math.max(v ? 2 : 0, yb(0) - yb(v));
      g.append(el('rect', { x: cx(i) + dx, y: yb(0) - bh, width: barW, height: bh, rx: 3, class: cls }));
    }
    if (p.balance !== null) g.append(el('circle', { cx: cx(i), cy: yl(p.balance), r: current ? 5 : 3, class: 'gx-evo-dot' }));
    if ((n - 1 - i) % every === 0) g.append(el('text', { x: cx(i), y: H - 5, class: 'ag-axis gx-trend-label', 'text-anchor': 'middle' }, p.label));
    const hit = el('rect', { x: cx(i) - groupW / 2, y: 0, width: groupW, height: H, class: 'gx-evo-hit' });
    hit.append(el('title', {}, `${p.title}: ingresos ${fmtMoney(p.income, currency)}, gastos ${fmtMoney(p.expense, currency)}${p.balance !== null ? `, saldo ${fmtMoney(p.balance, currency)}` : ''}`));
    g.append(hit);
    svg.append(g);
  });
  const legend = h('div', { class: 'gx-legend' },
    h('span', {}, h('span', { class: 'gx-sw gx-sw-line' }), 'Saldo'),
    h('span', {}, h('span', { class: 'gx-sw gx-sw-inc' }), 'Ingresos'),
    h('span', {}, h('span', { class: 'gx-sw gx-sw-exp' }), 'Gastos'));
  return h('div', {}, h('div', { class: 'ag-chart-wrap' }, svg as unknown as HTMLElement), legend);
}

/** Barra de progreso: verde, ámbar desde el 80 % y roja al pasarse; la marca es el ritmo ideal de hoy. */
export function progressBar(ratio: number, pace?: number, color?: string): HTMLElement {
  const cls = ratio >= 1 ? 'is-over' : ratio >= 0.8 ? 'is-warn' : 'is-ok';
  return h('div', { class: `gx-meter ${cls}`, role: 'presentation' },
    h('span', { class: 'gx-meter-fill', style: { width: `${Math.min(100, Math.max(0, ratio * 100))}%`, ...(color && cls === 'is-ok' ? { '--c': color } : {}) } }),
    pace !== undefined && pace > 0 && pace < 1 ? h('span', { class: 'gx-meter-pace', style: { left: `${pace * 100}%` }, title: 'Ritmo ideal a día de hoy' }) : null);
}
