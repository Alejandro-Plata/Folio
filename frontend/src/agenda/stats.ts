// Progreso del estudio: cifras clave, horas por semana frente al objetivo,
// cobertura del temario, temas más flojos (FSRS), notas de simulacros y
// previsión de cuándo se termina el temario. Se puede exportar a CSV.
import type { App } from '../app';
import { api } from '../api';
import { h, modal, toast } from '../ui/dom';
import type { Session } from './model';
import { addDays, duration, isoWeek, longDate, shortDate, startOfWeek } from './dates';
import type { AgendaView } from './view';

const WEEKS = 12;

export async function statsDialog(view: AgendaView, _app: App) {
  const st = view.state;
  const today = st.today;
  const from = addDays(startOfWeek(today), -7 * (WEEKS - 1));
  const sessions: Session[] = (await api.AgendaSessions(from, today)) ?? [];
  const allSessions: Session[] = (await api.AgendaSessions('', '')) ?? [];
  const retr = (await api.AgendaRetrievability(today)) ?? {};
  const topics = st.topics.filter((t) => !t.archived);

  // Horas por semana
  const weeks: { start: string; minutes: number }[] = [];
  for (let i = 0; i < WEEKS; i++) weeks.push({ start: addDays(from, i * 7), minutes: 0 });
  for (const s of sessions) {
    const i = Math.floor((new Date(s.date).getTime() - new Date(from).getTime()) / (7 * 86400000));
    if (weeks[i]) weeks[i].minutes += s.minutes;
  }
  const s = st.settings;
  let target = 0;
  for (let wd = 1; wd <= 7; wd++) if (!s.restDays.includes(wd)) {
    const w = s.windows[String(wd)];
    const win = w ? Math.max(0, toMin(w.end) - toMin(w.start)) : 0;
    target += s.capacityMode === 'hours' ? (s.capacity[String(wd)] ?? 0) : s.capacityMode === 'window' ? win : Math.min(s.capacity[String(wd)] ?? 0, win || Infinity);
  }
  const thisWeek = weeks[weeks.length - 1].minutes;

  // Racha: días seguidos con estudio hasta hoy (o ayer)
  const days = new Set(allSessions.map((x) => x.date));
  let streak = 0;
  for (let d = days.has(today) ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) streak++;

  const studied = topics.filter((t) => t.studied);
  const reviewed = topics.filter((t) => (t.memory?.Reps ?? 0) >= 2);
  const r = st.lastReport;
  const avgRetention = studied.length ? studied.reduce((n, t) => n + (retr[t.id] ?? 0), 0) / studied.length : 0;

  const tile = (label: string, value: string, sub?: string) =>
    h('div', { class: 'ag-kpi' }, h('span', { class: 'ag-kpi-label' }, label), h('span', { class: 'ag-kpi-value' }, value), sub ? h('span', { class: 'ag-kpi-sub' }, sub) : null);

  const body = h('div', { class: 'ag-stats' },
    h('div', { class: 'ag-kpis' },
      tile('Esta semana', duration(thisWeek), target ? `de ${duration(target)} previstas` : undefined),
      tile('Racha', `${streak} ${streak === 1 ? 'día' : 'días'}`, 'seguidos estudiando'),
      tile('Temario', topics.length ? `${studied.length} / ${topics.length}` : '—', topics.length ? `${reviewed.length} repasados al menos una vez` : 'añade el temario'),
      tile('Retención media', studied.length ? `${Math.round(avgRetention * 100)} %` : '—', 'probabilidad de recordar hoy'),
      tile('Previsión', r?.finishDate ? shortDate(r.finishDate) : r?.unscheduled ? 'No llega' : '—', r?.finishDate ? `terminarás el temario${r.unscheduled ? `, faltan ${r.unscheduled} temas` : ''}` : r?.unscheduled ? `faltan ${duration(r.shortfall)}` : 'planifica para calcularla')),
    h('section', { class: 'ag-chart-box' }, h('h3', {}, 'Horas de estudio por semana'), weekBars(weeks, target)),
    topics.length ? h('section', { class: 'ag-chart-box' }, h('h3', {}, 'Temario'), coverage(topics.length, studied.length, reviewed.length)) : null,
    studied.length ? h('section', { class: 'ag-chart-box' }, h('h3', {}, 'Temas que más conviene repasar'), weakest(studied.map((t) => ({ label: `Tema ${t.number}. ${t.title}`, r: retr[t.id] ?? 0, due: t.memory?.Due?.slice(0, 10) ?? '' })), today)) : null,
    scoresChart(allSessions.filter((x) => typeof x.score === 'number')),
  );
  const res = await modal('Progreso', body, [
    { label: 'Exportar CSV', value: 'csv', kind: 'ghost' },
    { label: 'Cerrar', value: null, kind: 'primary' },
  ], { wide: true, className: 'ag-modal ag-stats-modal' });
  if (res === 'csv') await exportCsv(view, allSessions);
}

/** Barras de una sola serie con la línea del objetivo; tooltip por barra y tabla accesible. */
function weekBars(weeks: { start: string; minutes: number }[], target: number): HTMLElement {
  const W = 640, H = 180, pad = { l: 36, r: 8, t: 12, b: 24 };
  const max = Math.max(target, ...weeks.map((w) => w.minutes), 60);
  const top = Math.ceil(max / 60) * 60;
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / weeks.length;
  const bw = (W - pad.l - pad.r) / weeks.length - 6;
  const y = (m: number) => pad.t + (1 - m / top) * (H - pad.t - pad.b);
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text) e.textContent = text;
    return e;
  };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ag-chart', role: 'img', 'aria-label': `Horas de estudio de las últimas ${weeks.length} semanas` });
  const step = top <= 600 ? 120 : 300;
  for (let m = 0; m <= top; m += step) {
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y(m), y2: y(m), class: 'ag-grid' }));
    svg.append(el('text', { x: pad.l - 6, y: y(m) + 4, class: 'ag-axis', 'text-anchor': 'end' }, `${m / 60} h`));
  }
  const tip = h('div', { class: 'ag-tip', hidden: true });
  weeks.forEach((w, i) => {
    const bh = Math.max(w.minutes ? 2 : 0, y(0) - y(w.minutes));
    const g = el('g', { class: 'ag-bar-g' });
    g.append(el('rect', { x: x(i) + 3, y: y(0) - bh, width: bw, height: bh, rx: Math.min(4, bh / 2), class: 'ag-bar' }));
    // Zona de toque más grande que la barra
    const hit = el('rect', { x: x(i), y: pad.t, width: bw + 6, height: H - pad.t - pad.b, class: 'ag-hit' });
    hit.addEventListener('mouseenter', () => {
      tip.hidden = false;
      tip.textContent = `Semana ${isoWeek(w.start)} (${shortDate(w.start)}): ${duration(w.minutes)}${target ? ` · objetivo ${duration(target)}` : ''}`;
      const box = svg.getBoundingClientRect();
      tip.style.left = `${((x(i) + bw / 2) / W) * box.width}px`;
      tip.style.top = `${(y(w.minutes) / H) * box.height - 8}px`;
    });
    hit.addEventListener('mouseleave', () => { tip.hidden = true; });
    g.append(hit);
    if (i % 2 === weeks.length % 2 || i === weeks.length - 1) svg.append(el('text', { x: x(i) + 3 + bw / 2, y: H - 6, class: 'ag-axis', 'text-anchor': 'middle' }, `S${isoWeek(w.start)}`));
    svg.append(g);
  });
  if (target) {
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y(target), y2: y(target), class: 'ag-target' }));
    svg.append(el('text', { x: W - pad.r, y: y(target) - 5, class: 'ag-axis ag-target-label', 'text-anchor': 'end' }, `objetivo ${duration(target)}`));
  }
  const table = h('table', { class: 'sr-only' }, h('tr', {}, h('th', {}, 'Semana'), h('th', {}, 'Horas')),
    ...weeks.map((w) => h('tr', {}, h('td', {}, `${isoWeek(w.start)} (${shortDate(w.start)})`), h('td', {}, duration(w.minutes)))));
  return h('div', { class: 'ag-chart-wrap' }, svg as unknown as HTMLElement, tip, table);
}

/** Barra apilada única: sin ver / estudiado / repasado, con etiquetas directas. */
function coverage(total: number, studied: number, reviewed: number): HTMLElement {
  const parts = [
    { label: 'Repasados', n: reviewed, cls: 'c3' },
    { label: 'Estudiados una vez', n: studied - reviewed, cls: 'c2' },
    { label: 'Sin ver', n: total - studied, cls: 'c1' },
  ];
  return h('div', { class: 'ag-cov' },
    h('div', { class: 'ag-cov-bar', role: 'img', 'aria-label': parts.map((p) => `${p.label}: ${p.n}`).join(', ') },
      ...parts.filter((p) => p.n).map((p) => h('span', { class: `ag-cov-seg ${p.cls}`, style: { flexGrow: String(p.n) }, title: `${p.label}: ${p.n} de ${total}` }))),
    h('div', { class: 'ag-cov-legend' }, ...parts.map((p) => h('span', { class: 'ag-cov-key' }, h('span', { class: `ag-cov-sw ${p.cls}` }), `${p.label} · ${p.n}`))));
}

function weakest(list: { label: string; r: number; due: string }[], today: string): HTMLElement {
  const rows = list.sort((a, b) => a.r - b.r).slice(0, 8);
  return h('table', { class: 'ag-weak' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Tema'), h('th', {}, 'Recuerdo estimado'), h('th', {}, 'Próximo repaso'))),
    h('tbody', {}, ...rows.map((t) => {
      const pct = Math.round(t.r * 100);
      const state = pct < 70 ? ['is-crit', 'Flojo'] : pct < 85 ? ['is-warn', 'Regular'] : ['is-good', 'Bien'];
      return h('tr', {},
        h('td', {}, t.label),
        h('td', {}, h('span', { class: 'ag-meter' }, h('span', { style: { width: `${pct}%` } })), h('span', { class: `ag-state ${state[0]}` }, `${pct} % · ${state[1]}`)),
        h('td', {}, t.due ? (t.due <= today ? 'Toca ya' : shortDate(t.due)) : '—'));
    })));
}

function scoresChart(scored: Session[]): HTMLElement | null {
  if (scored.length < 2) return scored.length ? h('section', { class: 'ag-chart-box' }, h('h3', {}, 'Notas de los simulacros'), h('p', {}, `${longDate(scored[0].date)}: ${scored[0].score} / 10`)) : null;
  const pts = scored.sort((a, b) => a.date.localeCompare(b.date)).slice(-20);
  const W = 640, H = 150, pad = { l: 30, r: 12, t: 10, b: 22 };
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, pts.length - 1);
  const y = (v: number) => pad.t + (1 - v / 10) * (H - pad.t - pad.b);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.score!)}`).join(' ');
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="ag-chart" role="img" aria-label="Evolución de las notas de los simulacros">
    ${[0, 5, 10].map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="ag-grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" class="ag-axis" text-anchor="end">${v}</text>`).join('')}
    <path d="${path}" class="ag-line"/>
    ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.score!)}" r="4" class="ag-dot"><title>${longDate(p.date)}: ${p.score} / 10</title></circle>`).join('')}
    <text x="${x(pts.length - 1)}" y="${y(pts[pts.length - 1].score!) - 9}" class="ag-axis ag-last" text-anchor="end">${pts[pts.length - 1].score}</text>
  </svg>`;
  return h('section', { class: 'ag-chart-box' }, h('h3', {}, 'Notas de los simulacros'), h('div', { class: 'ag-chart-wrap', html: svg }),
    h('table', { class: 'sr-only' }, ...pts.map((p) => h('tr', {}, h('td', {}, longDate(p.date)), h('td', {}, String(p.score))))));
}

async function exportCsv(view: AgendaView, sessions: Session[]) {
  const st = view.state;
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [['Fecha', 'Inicio', 'Minutos', 'Tipo', 'Tema', 'Valoración', 'Nota', 'Comentario']];
  for (const s of [...sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    const t = st.topic(s.topicId);
    rows.push([s.date, s.start ?? '', String(s.minutes), st.type(s.typeId).name, t ? `Tema ${t.number}. ${t.title}` : '', ['', 'Otra vez', 'Difícil', 'Bien', 'Fácil'][s.rating ?? 0] ?? '', s.score == null ? '' : String(s.score).replace('.', ','), s.note ?? '']);
  }
  // Punto y coma y BOM: Excel en español lo abre bien
  const csv = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
  try {
    const p = await api.SaveTextFile(`Progreso de estudio ${st.today}.csv`, csv, 'CSV (*.csv)', '*.csv');
    if (p) toast('Progreso exportado', { kind: 'ok' });
  } catch (e) { toast(String(e), { kind: 'error' }); }
}

const toMin = (t: string) => { const [a, b] = t.split(':').map(Number); return a * 60 + (b || 0); };
