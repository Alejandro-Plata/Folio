// Riel vertical de espacios (Documentos, Agenda, Gastos) y accesos globales a
// Ajustes y Cuenta. Sustituye a las pestañas .sb-modes del panel lateral.
import type { App } from '../app';
import { h } from './dom';
import { icon } from './icons';
import * as dialogs from './dialogs';

export type Mode = 'docs' | 'agenda' | 'gastos';

export class Rail {
  private el = document.getElementById('rail')!;
  private btns = new Map<Mode, HTMLButtonElement>();

  constructor(private app: App) {
    this.build();
  }

  private build() {
    const app = this.app;
    const modeBtn = (m: Mode, ic: string, label: string, key: string) => {
      const b = h('button', {
        type: 'button', class: 'rail-btn', 'aria-label': label, title: `${label} (${key})`,
        onclick: () => void app.setMode(m),
      }, h('span', { html: icon(ic, 20) })) as HTMLButtonElement;
      this.btns.set(m, b);
      return b;
    };
    const actionBtn = (ic: string, label: string, run: () => void) => h('button', {
      type: 'button', class: 'rail-btn', 'aria-label': label, title: label, onclick: run,
    }, h('span', { html: icon(ic, 20) }));

    this.el.append(
      modeBtn('docs', 'docs', 'Documentos', 'Ctrl+Mayús+1'),
      modeBtn('agenda', 'calendar', 'Agenda', 'Ctrl+Mayús+2'),
      modeBtn('gastos', 'wallet', 'Gastos', 'Ctrl+Mayús+3'),
      h('div', { class: 'spacer' }),
      actionBtn('settings', 'Ajustes', () => dialogs.settingsDialog(app)),
      actionBtn('user', 'Cuenta', () => void import('../social/account').then((m) => m.accountDialog(app))),
    );
    this.setActive(app.mode);
  }

  setActive(mode: Mode) {
    this.btns.forEach((b, m) => b.classList.toggle('on', m === mode));
  }
}
