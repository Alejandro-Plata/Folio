// Folito: asistente de la agenda con un modelo de lenguaje pequeño que corre en
// el propio equipo (ver internal/desktop/folito.go). Se abre con su botón en la
// esquina de la agenda; se le escribe como a una persona («el dentista me lo han
// pasado al viernes por la tarde») y propone acciones que se aplican con un clic.
//
// El modelo no calcula fechas: devuelve un JSON con el esquema de abajo y las
// fechas en español («el viernes a las 18»), que luego interpreta el mismo
// analizador por reglas de la barra rápida. Así un modelo muy pequeño basta.
import { api, onEvent, type FolitoInfo } from '../api';
import { h, toast } from '../ui/dom';
import { icon } from '../ui/icons';
import { WEEKDAYS, MONTHS, addDays, duration, relativeDate, timeLabel, toDate, weekday } from './dates';
import { fold } from './time';
import { parse } from './parse';
import { parseCommand, type Command } from './commands';
import { applyOrder, draftToTask, findTargets, type Order } from './orders';
import { remindLabel } from '../platform/reminders';
import type { Task } from './model';
import type { AgendaView } from './view';

/** Icono de Folito: una hoja de Folio con cara. Colores fijos, se ve igual en claro y en oscuro. */
export const FOLITO_SVG = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <path d="M12 5h17l10 10v24a5 5 0 0 1-5 5H12a5 5 0 0 1-5-5V10a5 5 0 0 1 5-5z" fill="#2f80e4"/>
  <path d="M29 5v7a3 3 0 0 0 3 3h7z" fill="#a9cdf6"/>
  <g class="folito-eyes" fill="#fff"><ellipse cx="17.5" cy="25" rx="2.5" ry="3.3"/><ellipse cx="28" cy="25" rx="2.5" ry="3.3"/></g>
  <path d="M18.2 32.6q4.6 3.6 9.2 0" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  <path d="M42 2.5l1.2 2.8 2.8 1.2-2.8 1.2L42 10.5l-1.2-2.8L38 6.5l2.8-1.2z" fill="#f5b83d"/>
</svg>`;

const ACTIONS = ['crear', 'mover', 'borrar', 'hecha', 'avisar', 'consultar'] as const;
type ActionType = (typeof ACTIONS)[number];
interface Action { type: ActionType; title?: string; task?: string; when?: string; duration?: string; remind?: string }

const SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    actions: {
      type: 'array', maxItems: 5,
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...ACTIONS] },
          title: { type: 'string' }, task: { type: 'string' }, when: { type: 'string' },
          duration: { type: 'string' }, remind: { type: 'string' },
        },
        required: ['type'],
      },
    },
  },
  required: ['reply', 'actions'],
};

/** Una acción propuesta, ya interpretada y lista para aplicar. */
interface Proposal { cmd: Command; targets: Task[]; done?: boolean }

export class Folito {
  readonly button: HTMLButtonElement;
  private panel = h('section', { class: 'folito-panel', role: 'dialog', 'aria-label': 'Folito, asistente de la agenda', hidden: true });
  private log = h('div', { class: 'folito-log', 'aria-live': 'polite' });
  private input = h('textarea', { class: 'folito-input', rows: 1, placeholder: 'Escribe lo que necesitas…', 'aria-label': 'Mensaje para Folito' });
  private send = h('button', { type: 'button', class: 'folito-send', title: 'Enviar (Intro)', 'aria-label': 'Enviar', html: icon('arrowUp', 16) });
  private body = h('div', { class: 'folito-body' });
  private busy = false;
  private info: FolitoInfo | null = null;

  constructor(private view: AgendaView) {
    this.button = h('button', {
      type: 'button', class: 'folito-fab', title: 'Folito, asistente de la agenda', 'aria-haspopup': 'dialog',
      onclick: () => this.toggle(),
    }, h('span', { class: 'folito-fab-ic', html: FOLITO_SVG }), h('span', { class: 'folito-fab-label' }, 'Folito'));
    this.panel.append(
      h('header', { class: 'folito-head' },
        h('span', { class: 'folito-head-ic', html: FOLITO_SVG }),
        h('div', { class: 'folito-head-text' }, h('strong', {}, 'Folito'), h('span', {}, 'Asistente de la agenda · funciona en tu equipo')),
        h('button', { type: 'button', class: 'icon-btn', title: 'Cerrar (Esc)', 'aria-label': 'Cerrar', html: icon('x', 16), onclick: () => this.close() })),
      this.body);
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void this.ask(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    this.input.addEventListener('input', () => { this.input.style.height = 'auto'; this.input.style.height = `${Math.min(120, this.input.scrollHeight)}px`; });
    this.send.addEventListener('click', () => void this.ask());
    onEvent('folito:download', (done: number, total: number) => this.progress(done, total));
  }

  mount(root: HTMLElement) { root.append(this.button, this.panel); }

  toggle() { if (this.panel.hidden) void this.open(); else this.close(); }

  async open() {
    this.panel.hidden = false;
    this.button.classList.add('is-open');
    this.button.setAttribute('aria-expanded', 'true');
    this.info = await api.FolitoStatus().catch(() => null);
    this.render();
  }

  close() {
    this.panel.hidden = true;
    this.button.classList.remove('is-open');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.focus();
  }

  // ---------- Estados: sin motor, sin modelo, listo ----------

  private render() {
    const i = this.info;
    if (!i || !i.engineReady) {
      this.body.replaceChildren(h('div', { class: 'folito-setup' },
        h('p', {}, 'Esta instalación de Folio no incluye el motor de Folito.'),
        h('p', { class: 'muted small' }, 'Mientras tanto, la barra «Añadir» también entiende órdenes: «¿qué tengo mañana?», «mueve inglés al viernes».')));
      return;
    }
    if (!i.modelReady) {
      const mb = Math.round(i.modelSize / 1e6);
      this.body.replaceChildren(h('div', { class: 'folito-setup' },
        h('p', {}, 'Folito entiende frases normales y las convierte en tareas, cambios y avisos de tu agenda.'),
        h('p', { class: 'muted small' }, `Funciona en tu equipo, sin conexión ni cuentas: lo que escribes no sale de aquí. Necesita descargar su modelo una vez (${mb.toLocaleString('es-ES')} MB).`),
        h('div', { class: 'folito-progress', hidden: !i.downloading }, h('span')),
        h('div', { class: 'btn-row' },
          i.downloading
            ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => void api.FolitoCancelDownload() }, 'Cancelar')
            : h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => void this.download() }, h('span', { html: icon('download', 15) }), 'Descargar Folito'))));
      return;
    }
    if (!this.log.childElementCount) {
      this.say(this.bubble('folito',
        h('p', {}, '¡Hola! Dime qué quieres apuntar, cambiar o consultar.'),
        h('div', { class: 'folito-examples' }, ...[
          'Mañana tengo dentista a las 10, avísame media hora antes',
          'La reunión del jueves se pasa al viernes a las 12',
          '¿Qué tengo esta semana?',
        ].map((ex) => h('button', { type: 'button', class: 'folito-example', onclick: () => { this.input.value = ex; void this.ask(); } }, ex)))));
    }
    this.body.replaceChildren(this.log, h('div', { class: 'folito-compose' }, this.input, this.send));
    setTimeout(() => this.input.focus(), 30);
  }

  private async download() {
    this.info = { ...this.info!, downloading: true };
    this.render();
    try {
      await api.FolitoDownload();
      toast('Folito está listo', { kind: 'ok' });
    } catch (e) {
      toast(String((e as Error)?.message ?? e), { kind: 'error', ms: 6000 });
    }
    this.info = await api.FolitoStatus().catch(() => null);
    this.render();
  }

  private progress(done: number, total: number) {
    const bar = this.body.querySelector<HTMLElement>('.folito-progress');
    if (!bar) return;
    bar.hidden = false;
    (bar.firstElementChild as HTMLElement).style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
    bar.title = `${Math.round(done / 1e6)} de ${Math.round(total / 1e6)} MB`;
  }

  // ---------- Conversación ----------

  private bubble(who: 'me' | 'folito', ...c: (Node | string | null)[]) {
    return h('div', { class: `folito-msg is-${who}` },
      who === 'folito' ? h('span', { class: 'folito-avatar', html: FOLITO_SVG }) : null,
      h('div', { class: 'folito-bubble' }, ...c));
  }

  private say(el: HTMLElement) {
    this.log.append(el);
    this.log.scrollTop = this.log.scrollHeight;
  }

  private async ask() {
    const text = this.input.value.trim();
    if (!text || this.busy) return;
    this.busy = true;
    this.input.value = '';
    this.input.style.height = 'auto';
    this.say(this.bubble('me', text));
    const t0 = performance.now();
    const secs = h('span', { class: 'muted small' });
    const thinking = this.bubble('folito', h('span', { class: 'folito-dots', 'aria-label': 'Pensando' }, h('i'), h('i'), h('i')), secs);
    thinking.classList.add('is-thinking');
    this.say(thinking);
    const tick = setInterval(() => { secs.textContent = ` ${Math.round((performance.now() - t0) / 1000)} s`; }, 1000);
    try {
      const raw = await api.FolitoAsk({ system: await this.systemPrompt(), user: text, schema: SCHEMA });
      const out = JSON.parse(raw) as { reply?: string; actions?: Action[] };
      const proposals = await this.interpret(out.actions ?? []);
      thinking.replaceWith(this.answer(out.reply || (proposals.length ? 'Esto es lo que propongo:' : 'No he entendido qué hacer. ¿Puedes decirlo de otra forma?'), proposals));
    } catch (e) {
      thinking.replaceWith(this.bubble('folito', h('p', {}, `No he podido responder: ${String((e as Error)?.message ?? e)}`)));
    } finally {
      clearInterval(tick);
      this.busy = false;
      this.log.scrollTop = this.log.scrollHeight;
      this.input.focus();
    }
  }

  /** Instrucciones: el día de hoy, las acciones posibles, ejemplos y las tareas próximas. */
  private async systemPrompt(): Promise<string> {
    const st = this.view.state;
    const today = st.today;
    const d = toDate(today);
    const upcoming = await st.range(today, addDays(today, 14)).catch(() => [] as Task[]);
    const names = [...new Set(upcoming.map((t) => t.title))].slice(0, 30);
    return [
      'Eres Folito, el asistente de la agenda de Folio. Conviertes lo que pide el usuario en acciones sobre su agenda.',
      `Hoy es ${WEEKDAYS[weekday(today) - 1]} ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}.`,
      'Acciones (campo "type"):',
      '- crear: tarea nueva. "title": nombre corto, sin fecha ni hora. "when": fecha y hora en español, como las diría una persona ("mañana a las 10", "el viernes de 9 a 11", "cada martes a las 17"). "duration" opcional ("45 min"). "remind" opcional ("10 minutos antes", "a la hora", "el día antes").',
      '- mover: cambiar una tarea existente. "task": palabras de su título. "when": el nuevo momento.',
      '- borrar: "task".',
      '- hecha: marcar como hecha. "task".',
      '- avisar: poner un aviso a una tarea existente. "task" y "remind".',
      '- consultar: ver la agenda. "when": "hoy", "mañana", "el jueves", "esta semana".',
      '"reply": una frase breve en español que diga lo que vas a hacer. Si falta algo imprescindible, pregúntalo en "reply" y deja "actions" vacío.',
      'Ejemplos:',
      'Usuario: el martes a las 5 tengo tutoría con la familia de Lucía, avísame 15 min antes',
      '{"reply":"Apunto la tutoría del martes a las 17:00 con aviso 15 minutos antes.","actions":[{"type":"crear","title":"Tutoría con la familia de Lucía","when":"el martes a las 17","remind":"15 minutos antes"}]}',
      'Usuario: el dentista me lo han cambiado al viernes por la tarde a las 6',
      '{"reply":"Muevo el dentista al viernes a las 18:00.","actions":[{"type":"mover","task":"dentista","when":"el viernes a las 18"}]}',
      'Usuario: ya he terminado el repaso del tema 3 y cancela la reunión de mañana',
      '{"reply":"Marco el repaso como hecho y quito la reunión de mañana.","actions":[{"type":"hecha","task":"repaso tema 3"},{"type":"borrar","task":"reunión","when":"mañana"}]}',
      names.length ? `Tareas de los próximos días: ${names.join('; ')}.` : 'No hay tareas en los próximos días.',
    ].join('\n');
  }

  /** Convierte las acciones del modelo en órdenes de la agenda, con las fechas leídas por reglas. */
  private async interpret(actions: Action[]): Promise<Proposal[]> {
    const st = this.view.state;
    const out: Proposal[] = [];
    for (const a of actions.slice(0, 5)) {
      if (!a || !ACTIONS.includes(a.type)) continue;
      const when = (a.when ?? '').trim();
      let cmd: Command | null = null;
      if (a.type === 'crear') {
        const d = parse(`${when}${a.duration ? ` durante ${a.duration}` : ''}`, st.today, st.types);
        d.title = (a.title ?? '').trim() || d.title;
        if (a.remind) d.remind = remindMinutes(a.remind);
        cmd = { kind: 'create', drafts: [d] };
      } else if (a.type === 'consultar') {
        cmd = parseCommand(`qué tengo ${when || 'hoy'}`, st.today, st.types);
      } else {
        const task = fold(a.task ?? '').trim();
        if (!task) continue;
        const on = a.type !== 'mover' && when ? parse(when, st.today, st.types).date : undefined;
        if (a.type === 'mover') {
          const c = parseCommand(`mueve ${task} a ${when}`, st.today, st.types);
          cmd = c && c.kind === 'move' ? { ...c, query: task } : null;
        } else if (a.type === 'borrar') cmd = { kind: 'delete', query: task, on };
        else if (a.type === 'hecha') cmd = { kind: 'done', query: task, on };
        else cmd = { kind: 'remind', query: task, on, minutes: remindMinutes(a.remind ?? '') };
      }
      if (!cmd) continue;
      out.push({ cmd, targets: cmd.kind === 'create' ? [] : await findTargets(st, cmd as Order) });
    }
    return out;
  }

  private answer(reply: string, proposals: Proposal[]) {
    const cards = proposals.map((p) => this.card(p));
    const applicable = proposals.filter((p) => canApply(p));
    const all = applicable.length > 1 ? h('button', {
      type: 'button', class: 'btn btn-sm btn-primary folito-all', onclick: async (e: MouseEvent) => {
        (e.currentTarget as HTMLButtonElement).disabled = true;
        for (const [i, p] of proposals.entries()) if (canApply(p) && !p.done) await this.apply(p, cards[i]);
      },
    }, 'Aplicar todo') : null;
    return this.bubble('folito', h('p', {}, reply), ...cards, all);
  }

  private card(p: Proposal): HTMLElement {
    const st = this.view.state;
    const cmd = p.cmd;
    const pill = (ic: string, text: string) => h('span', { class: 'ag-pill' }, h('span', { html: icon(ic, 12) }), text);
    let head: string, ic: string, main: (Node | null)[];
    if (cmd.kind === 'create') {
      const t = draftToTask(st, cmd.drafts[0]);
      const type = st.type(t.typeId);
      head = 'Crear'; ic = 'plus';
      main = [h('strong', {}, t.title), h('div', { class: 'ag-pills' },
        pill('calendar', relativeDate(t.date, st.today)),
        t.start ? pill('clock', `${timeLabel(t.start)}${t.minutes ? ` · ${duration(t.minutes)}` : ''}`) : null,
        t.remind != null ? pill('bell', remindLabel(t.remind, !t.start)) : null,
        pill(type.icon, type.name))];
    } else if (cmd.kind === 'query') {
      head = cmd.label || relativeDate(cmd.from, st.today); ic = 'calendar';
      main = p.targets.length
        ? p.targets.slice(0, 6).map((t) => h('div', { class: 'folito-line' }, h('span', { class: 'muted' }, `${cmd.from === cmd.to ? '' : `${relativeDate(t.date, st.today)} · `}${t.start ? timeLabel(t.start) : 'Todo el día'}`), ' ', t.title))
        : [h('span', { class: 'muted' }, 'Nada previsto.')];
    } else {
      const t = p.targets[0];
      head = { move: 'Mover', delete: 'Borrar', done: 'Marcar como hecha', remind: 'Poner aviso' }[cmd.kind]; ic = { move: 'calendar', delete: 'trash', done: 'check', remind: 'bell' }[cmd.kind];
      const dest = cmd.kind === 'move' ? `→ ${cmd.date ? relativeDate(cmd.date, st.today) : 'mismo día'}${cmd.start ? ` · ${timeLabel(cmd.start)}` : ''}` : cmd.kind === 'remind' ? remindLabel(cmd.minutes) : '';
      main = t
        ? [h('strong', {}, t.title), h('span', { class: 'muted small' }, `${relativeDate(t.date, st.today)}${t.start ? ` · ${timeLabel(t.start)}` : ''}${dest ? `  ${dest}` : ''}`)]
        : [h('span', { class: 'muted' }, `No encuentro «${cmd.query}» en tu agenda.`)];
    }
    const el = h('div', { class: 'folito-card' },
      h('div', { class: 'folito-card-head' }, h('span', { html: icon(ic, 13) }), head),
      h('div', { class: 'folito-card-main' }, ...main));
    if (canApply(p)) {
      el.append(h('button', {
        type: 'button', class: `btn btn-sm ${cmd.kind === 'delete' ? 'btn-danger' : ''} folito-apply`,
        onclick: () => void this.apply(p, el),
      }, cmd.kind === 'query' ? 'Ver' : cmd.kind === 'create' ? 'Crear' : 'Aplicar'));
    }
    return el;
  }

  private async apply(p: Proposal, el: HTMLElement) {
    if (p.done) return;
    const cmd = p.cmd;
    try {
      if (cmd.kind === 'create') {
        const t = draftToTask(this.view.state, cmd.drafts[0]);
        await this.view.state.saveTasks([t], `Creada: ${t.title} · ${relativeDate(t.date, this.view.state.today)}`);
      } else await applyOrder(this.view, cmd, p.targets[0]);
      if (cmd.kind === 'query') return;
      p.done = true;
      el.classList.add('is-done');
      el.querySelector('.folito-apply')?.replaceWith(h('span', { class: 'folito-ok', html: icon('check', 14), title: 'Hecho' }));
    } catch (e) {
      toast(String((e as Error)?.message ?? e), { kind: 'error' });
    }
  }
}

function canApply(p: Proposal) {
  const c = p.cmd;
  if (c.kind === 'create' || c.kind === 'query') return true;
  if (c.kind === 'move' && !c.date && !c.start) return false;
  return p.targets.length > 0;
}

/** «10 minutos antes», «a la hora», «el día antes» → minutos. */
function remindMinutes(text: string): number {
  const f = fold(text);
  if (!f || /a la hora|al empezar|en punto/.test(f)) return 0;
  const d = parse(`avisame ${/antes/.test(f) ? f : `${f} antes`}`, '2000-01-01', []);
  return d.remind ?? 0;
}
