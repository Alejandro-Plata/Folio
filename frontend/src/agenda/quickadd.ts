// Barra rápida: se escribe (o se dicta) una frase y se ve qué se ha entendido
// antes de crear nada. Intro crea, Mayús+Intro abre el editor completo.
import type { App } from '../app';
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import { pushBack } from '../platform/back';
import type { Task } from './model';
import { WEEKDAYS_SHORT, duration, relativeDate, timeLabel } from './dates';
import { parseMany, type Draft } from './parse';
import { taskDialog } from './editor';
import { Dictation } from './dictation';
import type { AgendaView } from './view';

export class QuickAdd {
  input = h('input', {
    class: 'ag-quick-input', type: 'text', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'Añadir: «mañana de 9 a 11 estudio tema 4» · «repaso cada martes a las 17»',
    'aria-label': 'Añadir tareas escribiendo una frase', 'aria-describedby': 'ag-quick-help',
  });
  private preview = h('div', { class: 'ag-preview', role: 'region', 'aria-label': 'Lo que se va a crear', 'aria-live': 'polite', hidden: true });
  private mic: HTMLButtonElement;
  el: HTMLElement;
  private drafts: Draft[] = [];
  dictation: Dictation;

  constructor(private view: AgendaView, private app: App) {
    this.dictation = new Dictation(this.app, (text) => this.receive(text));
    this.mic = h('button', {
      type: 'button', class: 'ag-mic', title: 'Dictar (mantén Ctrl+Mayús+Espacio)', 'aria-label': 'Dictar una tarea', html: icon('mic', 16),
      onclick: () => void this.dictation.toggle(this.mic),
    });
    this.el = h('div', { class: 'ag-quick' },
      h('span', { class: 'ag-quick-ic', html: icon('plus', 16), 'aria-hidden': 'true' }),
      this.input, this.mic, this.preview,
      h('span', { id: 'ag-quick-help', class: 'sr-only' }, 'Intro crea lo que se muestra debajo. Mayús e Intro abre el editor completo. Escape cancela.'));
    this.input.addEventListener('input', () => this.update());
    this.input.addEventListener('focus', () => this.update());
    this.input.addEventListener('blur', () => setTimeout(() => { if (!this.el.contains(document.activeElement)) this.preview.hidden = true; }, 150));
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); void (e.shiftKey ? this.edit(0) : this.create()); }
      else if (e.key === 'Escape') { e.preventDefault(); this.clear(); this.input.blur(); }
    });
    // Pulsar para hablar: mantener Ctrl+Mayús+Espacio
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && e.ctrlKey && e.shiftKey && !e.repeat && !this.view.root.hidden) { e.preventDefault(); void this.dictation.start(this.mic, true); }
    });
    window.addEventListener('keyup', (e) => {
      if ((e.code === 'Space' || e.key === 'Control' || e.key === 'Shift') && this.dictation.pushToTalk) void this.dictation.stop();
    });
  }

  focus() { this.input.focus(); this.input.select(); }

  /** Móvil: la barra rápida sube sobre el teclado como una hoja pequeña. */
  openMobile() {
    const body = document.body;
    if (body.classList.contains('m-quick-open')) { this.input.focus(); return; }
    body.classList.add('m-quick-open');
    const off = pushBack(() => close());
    const close = () => {
      off();
      body.classList.remove('m-quick-open');
      this.clear();
      this.input.blur();
      this.closeMobile = null;
    };
    this.closeMobile = close;
    setTimeout(() => this.input.focus(), 50);
  }

  /** Cierra la barra rápida del móvil (tras crear una tarea). */
  closeMobile: (() => void) | null = null;

  /** Dictar mientras se mantiene pulsado el botón flotante. */
  startHold() { void this.dictation.start(this.mic, true); }
  endHold() { void this.dictation.stop(); }

  private clear() { this.input.value = ''; this.drafts = []; this.preview.hidden = true; }

  /** Texto dictado: se pone en la barra y se muestra la vista previa. */
  private receive(text: string) {
    this.input.value = text;
    this.input.focus();
    this.update();
    this.view.announce(text ? `Dictado: ${text}` : 'No se ha entendido nada');
  }

  private update() {
    const text = this.input.value.trim();
    const st = this.view.state;
    this.drafts = text ? parseMany(text, st.today, st.types) : [];
    this.preview.hidden = !this.drafts.length;
    if (!this.drafts.length) return;
    this.preview.replaceChildren(...this.drafts.map((d, i) => this.row(d, i)),
      h('div', { class: 'ag-preview-foot' },
        h('span', { class: 'muted small' }, h('kbd', {}, 'Intro'), ` crear${this.drafts.length > 1 ? ` las ${this.drafts.length}` : ''} · `, h('kbd', {}, 'Mayús+Intro'), ' editar · ', h('kbd', {}, 'Esc'), ' cancelar'),
        h('div', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-sm btn-primary', onmousedown: (e: MouseEvent) => e.preventDefault(), onclick: () => void this.create() }, this.drafts.length > 1 ? `Crear ${this.drafts.length}` : 'Crear')));
  }

  private row(d: Draft, i: number): HTMLElement {
    const st = this.view.state;
    const type = st.type(d.typeId ?? this.defaultType());
    const topic = st.topicByNumber(d.topicNumber);
    const rep = d.repeat
      ? d.repeat.freq === 'daily' ? (d.repeat.interval > 1 ? `cada ${d.repeat.interval} días` : 'todos los días')
        : d.repeat.freq === 'monthly' ? 'cada mes'
          : `${d.repeat.interval > 1 ? `cada ${d.repeat.interval} semanas, ` : 'cada '}${(d.repeat.weekdays ?? []).map((w) => WEEKDAYS_SHORT[w - 1]).join(', ')}`
      : '';
    const pill = (ic: string, text: string) => h('span', { class: 'ag-pill' }, h('span', { html: icon(ic, 12) }), text);
    return h('div', { class: 'ag-preview-row' },
      h('span', { class: `ag-type-dot pat-${type.pattern}`, style: { '--c': type.color }, title: type.name }),
      h('div', { class: 'ag-preview-main' },
        h('strong', {}, d.title || type.name),
        h('div', { class: 'ag-pills' },
          pill('calendar', relativeDate(d.date, st.today)),
          d.start ? pill('clock', `${timeLabel(d.start)}${d.minutes ? ` · ${duration(d.minutes)}` : ''}`) : d.minutes ? pill('clock', duration(d.minutes)) : null,
          rep ? pill('repeat', rep + (d.repeat?.until ? ` hasta ${relativeDate(d.repeat.until, st.today)}` : '')) : null,
          pill(type.icon, type.name),
          topic ? pill('layers', `Tema ${topic.number}`) : d.topicNumber ? pill('alert', `El tema ${d.topicNumber} no está en el temario`) : null)),
      h('button', { type: 'button', class: 'icon-btn', title: 'Editar antes de crear', 'aria-label': `Editar «${d.title}» antes de crear`, html: icon('pencil', 14), onmousedown: (e: MouseEvent) => e.preventDefault(), onclick: () => void this.edit(i) }));
  }

  private defaultType() {
    const st = this.view.state;
    return st.types.find((t) => t.id === 'personal')?.id ?? st.types[st.types.length - 1]?.id ?? '';
  }

  private toTask(d: Draft): Task {
    const st = this.view.state;
    const topic = st.topicByNumber(d.topicNumber);
    const typeId = d.typeId ?? (topic ? 'study' : this.defaultType());
    return {
      id: '', title: d.title || st.type(typeId).name, typeId, date: d.date, start: d.start, minutes: d.minutes, repeat: d.repeat ?? null,
      topicId: topic?.id, docId: topic?.docId, kind: topic ? (typeId === 'review' ? 'review' : typeId === 'mock' ? 'mock' : 'study') : '', done: false,
    };
  }

  private async create() {
    if (!this.drafts.length) { this.update(); if (!this.drafts.length) return; }
    const tasks = this.drafts.map((d) => this.toTask(d));
    const r = await this.view.state.saveTasks(tasks, tasks.length > 1 ? `${tasks.length} tareas creadas` : `Creada: ${tasks[0].title} · ${relativeDate(tasks[0].date, this.view.state.today)}`);
    if (r) {
      this.clear();
      this.closeMobile?.();
      if (tasks.length === 1 && tasks[0].date !== this.view.cursor) this.view.setCursor(tasks[0].date);
    }
  }

  private async edit(i: number) {
    const d = this.drafts[i];
    if (!d) return;
    const t = this.toTask(d);
    this.clear();
    await taskDialog(this.view, this.app, { date: t.date, draft: t });
  }
}
