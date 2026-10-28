// Pantalla «Más» del móvil: lo que en escritorio está en el menú Archivo, el
// panel lateral y los diálogos.
import type { App } from '../app';
import * as dialogs from '../ui/dialogs';
import { on } from '../bus';
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import { pdfMergeDialog } from '../ui/pdfmerge';
import type { MobileShell } from './shell';

export class MoreScreen {
  el = h('section', { class: 'm-screen m-more', 'aria-label': 'Más opciones' });

  constructor(private app: App, private shell: MobileShell) {
    on('social:changed', () => { if (this.el.isConnected && !this.el.hidden) this.render(); });
  }

  render() {
    const app = this.app;
    const row = (ic: string, label: string, sub: string, run: () => void) =>
      h('button', { type: 'button', class: 'm-row m-row-btn', onclick: run },
        h('span', { class: 'm-row-ic', html: icon(ic, 22) }),
        h('span', { class: 'm-row-main' }, h('span', { class: 'm-row-title' }, label), sub ? h('span', { class: 'm-row-sub' }, sub) : null),
        h('span', { class: 'm-row-chev', html: icon('chevronRight', 18), 'aria-hidden': 'true' }));
    /** Estudio vive en la agenda: se pasa a ella y se abre el diálogo. */
    const study = (load: () => Promise<void>) => async () => { await this.shell.go('agenda'); await load(); };
    const t = app.sync;
    this.el.replaceChildren(
      h('div', { class: 'm-section' }, 'Documentos'),
      row('template', 'Plantillas', 'Apuntes, examen, rúbrica…', () => this.shell.docList.newDocSheet()),
      row('upload', 'Importar', '.docx, .md, .html, .txt', () => void dialogs.importDialog(app)),
      row('pdfMerge', 'Unir PDF', 'Juntar varios PDF en uno', () => void pdfMergeDialog(app)),
      row('trash', 'Papelera', 'Recuperar documentos borrados', () => void app.sidebar.trashDialog()),
      h('div', { class: 'm-section' }, 'Estudio'),
      row('layers', 'Temario', 'Temas y apuntes', study(async () => (await import('../agenda/topics')).topicsDialog(app.agenda, app))),
      row('barChart', 'Progreso', 'Horas, racha y temas flojos', study(async () => (await import('../agenda/stats')).statsDialog(app.agenda, app))),
      row('paint', 'Tipos y prioridades', 'Colores, iconos y tramas', study(async () => (await import('../agenda/sidebar')).typesDialog(app.agenda))),
      h('div', { class: 'm-section' }, 'Cuenta y círculos'),
      row(app.social.snap.signedIn ? 'user' : 'logOut', 'Tu cuenta', app.social.snap.signedIn ? (app.social.snap.profile?.name || app.social.snap.user?.email || '') : 'Entra con Google o con tu correo',
        () => void import('../social/account').then((m) => m.accountDialog(app))),
      row('users', 'Círculos', app.social.circles.length ? app.social.circles.map((c) => c.name).join(', ') : 'Amigos o pareja: eventos compartidos',
        () => void import('../social/circles').then((m) => m.circlesDialog(app))),
      ...(app.social.couples.length ? [row('heart', 'Citas', app.social.pending.length ? `${app.social.pending.length} por responder` : 'Proponer días y elegir', () => void import('../social/dates').then((m) => m.datesDialog(app)))] : []),
      h('div', { class: 'm-section' }, 'Aplicación'),
      row(t?.linked ? 'cloudCheck' : 'cloud', 'Sincronización', t?.linked ? 'Vinculada con tu nube' : 'Mismos datos en todos tus dispositivos', () => void import('../sync/syncsettings').then((m) => m.syncDialog(app))),
      row('settings', 'Ajustes', 'Apariencia, exportar, página, versiones', () => void dialogs.settingsDialog(app)),
      row('download', 'Actualizaciones', `Tienes la versión ${app.version}`, () => void import('../ui/updates').then((m) => m.updateDialog(app))),
      row('bookOpen', 'Manual de Folio', 'Todas las funciones explicadas', () => void app.openManual()),
      row('graduation', 'Tutorial de documentos', '', () => void app.startTour()),
      row('calendar', 'Tutorial de la agenda', '', () => void app.startTour('agenda')),
      h('p', { class: 'm-about muted small' }, `Folio ${app.version}`));
  }
}
