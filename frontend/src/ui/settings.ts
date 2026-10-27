// Archivo > Ajustes: todas las preferencias en una sola página, junto a Nuevo,
// Exportar e Imprimir. Los cambios se aplican y se guardan al momento.
import type { App } from '../app';
import { defaultSetup } from '../app';
import type { ExportFormat, Settings } from '../types';
import { isAndroid, isDesktop } from '../platform/platform';
import { h, debounce, toast } from './dom';
import { icon } from './icons';
import { api } from '../api';
import * as dialogs from './dialogs';

export type SettingsSection = 'appearance' | 'writing' | 'export' | 'page' | 'storage' | 'background' | 'account' | 'help';

export const EXPORT_FORMATS: { id: ExportFormat; label: string; desc: string; ic: string }[] = [
  { id: 'docx', label: 'Documento de Word', desc: '.docx editable con estilos, notas al pie, comentarios e índice.', ic: 'word' },
  { id: 'pdf', label: 'PDF', desc: 'Listo para imprimir o enviar, con encabezado y números de página.', ic: 'pdf' },
  { id: 'html', label: 'Página web', desc: '.html autónomo con las imágenes incluidas.', ic: 'code' },
  { id: 'md', label: 'Markdown', desc: '.md para otras aplicaciones de notas.', ic: 'markdown' },
];

/** Interruptor de sí/no. */
function toggle(checked: boolean, change: (v: boolean) => void, label: string) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked, 'aria-label': label });
  input.addEventListener('change', () => change(input.checked));
  return h('label', { class: 'switch' }, input, h('span', { class: 'switch-track', 'aria-hidden': 'true' }));
}

/** Control segmentado: una opción de varias, todas a la vista. */
function segmented<T extends string>(options: [T, string, string?][], value: T, change: (v: T) => void, label: string) {
  const el = h('div', { class: 'seg st-seg', role: 'radiogroup', 'aria-label': label });
  const draw = () => {
    el.replaceChildren(...options.map(([v, l, ic]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(v === value), class: `seg-btn ${v === value ? 'on' : ''}`,
      onclick: () => { if (v === value) return; value = v; draw(); change(v); },
    }, ic ? h('span', { html: icon(ic, 14) }) : null, l)));
  };
  draw();
  return el;
}

/** Fila de ajuste: nombre y explicación a la izquierda, control a la derecha. */
function row(title: string, desc: string | null, ...ctrl: (HTMLElement | null)[]) {
  return h('div', { class: 'st-row' },
    h('div', { class: 'st-text' }, h('strong', {}, title), desc ? h('span', {}, desc) : null),
    h('div', { class: 'st-ctrl' }, ...ctrl));
}

export function settingsPage(app: App, main: HTMLElement, opts: {
  close: () => void;
  go: (page: 'export' | 'print') => void;
  section?: SettingsSection;
}) {
  const s = app.settings;
  const save = <K extends keyof Settings>(k: K, v: Settings[K]) => { s[k] = v; app.persistSettings(); saved(); };
  const status = h('span', { class: 'st-saved', 'aria-live': 'polite' });
  const saved = debounce(() => {
    status.replaceChildren(h('span', { html: icon('check', 14) }), 'Guardado');
    status.classList.add('on');
    setTimeout(() => status.classList.remove('on'), 1600);
  }, 250);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => { app.setSetting(k, v); saved(); };
  const btn = (label: string, run: () => void, ic?: string, cls = 'btn btn-sm') =>
    h('button', { type: 'button', class: cls, onclick: run }, ic ? h('span', { html: icon(ic, 15) }) : null, label);

  const sections: { id: SettingsSection; ic: string; title: string; short?: string; desc: string; body: () => (HTMLElement | null)[] }[] = [
    {
      id: 'appearance', ic: 'paint', title: 'Apariencia', desc: 'Cómo se ve Folio y cómo se muestran los documentos.',
      body: () => [
        row('Tema', null, segmented([['system', 'Sistema', 'monitor'], ['light', 'Claro', 'sun'], ['dark', 'Oscuro', 'moon']], s.theme, (v) => set('theme', v), 'Tema')),
        row('Vista de los documentos', 'Hojas como al imprimir, o lectura continua.',
          segmented([['page', 'Hojas', 'page'], ['web', 'Lectura', 'alignJustify']], s.pageView ? 'page' : 'web', (v) => set('pageView', v === 'page'), 'Vista de los documentos')),
        row('Ajustar la hoja a la ventana', 'Reduce la hoja si no cabe a lo ancho.',
          toggle(s.zoomFit !== false, (v) => set('zoomFit', v), 'Ajustar la hoja a la ventana')),
        app.mobile ? null : row('Cinta de opciones', 'Pestañas Inicio, Insertar, Disposición…',
          toggle(s.ribbon, (v) => set('ribbon', v), 'Cinta de opciones')),
        row('Marcas de formato ¶', 'Muestra los saltos de párrafo y de línea.', toggle(s.showMarks, (v) => set('showMarks', v), 'Marcas de formato')),
      ],
    },
    {
      id: 'writing', ic: 'keyboard', title: 'Escritura', desc: 'Atajos de teclado y correcciones mientras escribes.',
      body: () => [
        row('Atajos de teclado', s.keymap === 'en' ? 'Como Word en inglés: Ctrl+B negrita, Ctrl+S guardar…' : 'Como Word en español: Ctrl+N negrita, Ctrl+G guardar…',
          segmented([['es', 'Español'], ['en', 'Inglés']], s.keymap === 'en' ? 'en' : 'es', (v) => {
            set('keymap', v);
            app.ribbon.rebuild();
            app.sidebar.rebuild();
            redraw('writing');
          }, 'Atajos de teclado'),
          btn('Ver todos', () => void dialogs.shortcutsDialog(app), undefined, 'btn btn-sm btn-ghost')),
        row('Revisión ortográfica', 'Subraya las palabras mal escritas mientras escribes.', toggle(s.spellcheck, (v) => set('spellcheck', v), 'Revisión ortográfica')),
        row('Comillas y guiones tipográficos', 'Cambia "" por «» y -- por —. Se aplica al reiniciar Folio.', toggle(s.smartQuotes, (v) => save('smartQuotes', v), 'Comillas y guiones tipográficos')),
      ],
    },
    {
      id: 'export', ic: 'share', title: 'Exportar e imprimir', desc: 'Lo que aparece elegido al abrir Exportar e Imprimir. Siempre puedes cambiarlo en cada exportación.',
      body: () => {
        const cards = h('div', { class: 'format-cards st-formats', role: 'radiogroup', 'aria-label': 'Formato predeterminado' });
        const drawCards = () => {
          const cur = s.exportFormat ?? 'docx';
          cards.replaceChildren(...EXPORT_FORMATS.map((f) => h('button', {
            type: 'button', role: 'radio', 'aria-checked': String(f.id === cur), class: `format-card ${f.id === cur ? 'on' : ''}`,
            onclick: () => { save('exportFormat', f.id); drawCards(); },
          }, h('span', { class: 'bs-tile-ic', html: icon(f.ic, 20) }), h('span', { class: 'fc-title' }, f.label), h('span', { class: 'fc-desc' }, f.desc))));
        };
        drawCards();
        const author = h('input', { class: 'input input-sm st-input', value: s.authorName, placeholder: 'Tu nombre', 'aria-label': 'Autor' });
        author.addEventListener('input', debounce(() => save('authorName', author.value.trim()), 400));
        return [
          h('div', { class: 'st-block' }, h('div', { class: 'st-text' }, h('strong', {}, 'Formato predeterminado')), cards),
          row('Incluir el título del documento', 'Lo pone al principio de la primera página.', toggle(!s.exportNoTitle, (v) => save('exportNoTitle', !v), 'Incluir el título')),
          row('Versión del alumnado', 'Oculta los bloques de solución.', toggle(!!s.exportStudent, (v) => save('exportStudent', v), 'Versión del alumnado')),
          row('Autor', 'Para {autor} en encabezados y pies, los comentarios y las propiedades del .docx.', author),
          app.doc ? h('div', { class: 'st-actions' },
            btn('Exportar este documento…', () => opts.go('export'), 'share', 'btn btn-sm btn-primary'),
            btn('Imprimir…', () => opts.go('print'), 'print')) : null,
        ];
      },
    },
    {
      id: 'page', ic: 'pageSetup', title: 'Página de los documentos nuevos', short: 'Documentos nuevos', desc: 'Papel, márgenes, letra, encabezado y pie con los que empieza cada documento nuevo. Las plantillas con formato propio (examen, rúbrica…) conservan el suyo.',
      body: () => {
        const custom = !!s.docSetup;
        const form = dialogs.pageSetupForm(s.docSetup ?? defaultSetup(), () => save('docSetup', form.get()));
        return [
          h('div', { class: 'st-actions' },
            app.doc ? btn('Copiar del documento actual', () => { save('docSetup', { ...app.doc!.setup }); redraw('page'); toast('Se usará la página de este documento en los nuevos', { kind: 'ok' }); }, 'copy') : null,
            custom ? btn('Restablecer', () => { save('docSetup', null); redraw('page'); }, 'undo', 'btn btn-sm btn-ghost') : null,
            app.doc ? btn('Configurar la página de este documento…', () => void dialogs.pageSetupDialog(app), undefined, 'btn btn-sm btn-ghost') : null),
          h('div', { class: 'st-form' }, form.el),
        ];
      },
    },
    {
      id: 'storage', ic: 'history', title: 'Versiones y almacenamiento', short: 'Versiones', desc: 'Guardado automático e historial de versiones.',
      body: () => {
        const interval = h('select', { class: 'input input-sm', 'aria-label': 'Versión automática' },
          ...[2, 5, 10, 15, 30, 60].map((m) => h('option', { value: String(m), selected: s.autoVersionMinutes === m }, `Cada ${m} minutos`)));
        interval.addEventListener('change', () => save('autoVersionMinutes', Number(interval.value)));
        const ws = h('code', { class: 'path' }, app.workspace);
        return [
          row('Versión automática', 'Además, al cerrar. Las versiones con nombre (F12) nunca se borran.', interval),
          isAndroid ? null : h('div', { class: 'st-block' },
            h('div', { class: 'st-text' }, h('strong', {}, 'Carpeta de documentos'),
              h('span', {}, 'Tus documentos son archivos normales: puedes sincronizar esta carpeta con Drive, OneDrive o Nextcloud.')),
            ws,
            h('div', { class: 'st-actions' },
              btn('Abrir carpeta', () => void api.OpenWorkspaceFolder(), 'folder'),
              btn('Cambiar…', async () => {
                const dir = await api.ChooseWorkspace();
                if (!dir) return;
                app.workspace = dir; ws.textContent = dir;
                await app.refreshDocs(); app.doc = null;
                const f = app.docs.find((x) => !x.trashed);
                if (f) await app.open(f.id); else app.view.showEmpty();
              }))),
        ];
      },
    },
    ...(isDesktop ? [{
      id: 'background' as const, ic: 'bell', title: 'Avisos y segundo plano', short: 'Segundo plano', desc: 'Para recibir los avisos de la agenda, Folio tiene que estar abierto, aunque sea oculto.',
      body: () => {
        // Preferencias de este equipo: las guarda la ventana (no van en los ajustes sincronizados)
        const bg = toggle(false, (v) => void apply({ background: v }), 'Seguir en segundo plano al cerrar');
        const login = toggle(false, (v) => void apply({ openAtLogin: v }), 'Abrir al iniciar sesión');
        const bgInput = bg.querySelector('input')!, loginInput = login.querySelector('input')!;
        const show = (p: { background: boolean; openAtLogin: boolean }) => {
          bgInput.checked = p.background; loginInput.checked = p.openAtLogin; loginInput.disabled = !p.background;
        };
        const apply = async (p: { background?: boolean; openAtLogin?: boolean }) => { show(await api.SetDesktopPrefs(p)); saved(); };
        void api.GetDesktopPrefs().then(show);
        return [
          row('Seguir en segundo plano al cerrar', 'La ventana se oculta y Folio queda en la bandeja del sistema. Para salir del todo: «Salir de Folio» en la bandeja.', bg),
          row('Abrir al iniciar sesión', 'Arranca oculto, solo para avisar. Requiere el segundo plano.', login),
          row('Aviso de las tareas nuevas', null, h('span', { class: 'muted small' }, 'Se elige en Agenda > Plan. Cada tarea tiene el suyo en «Avisar».')),
        ];
      },
    }] : []),
    {
      id: 'account', ic: 'cloud', title: 'Cuenta y sincronización', short: 'Cuenta y nube', desc: 'Tus mismos documentos y agenda en todos tus dispositivos.',
      body: () => [
        row('Sincronización', app.sync?.linked ? 'Vinculada con tu nube.' : 'Sin vincular. Usa Nextcloud, WebDAV o Google Drive.',
          btn(app.sync?.linked ? 'Gestionar…' : 'Vincular…', () => void import('../sync/syncsettings').then((m) => m.syncDialog(app)), app.sync?.linked ? 'cloudCheck' : 'cloud')),
        row('Tu cuenta y círculos', 'Eventos compartidos con amigos o pareja.',
          btn('Abrir…', () => void import('../social/account').then((m) => m.accountDialog(app)), 'user')),
      ],
    },
    {
      id: 'help', ic: 'help', title: 'Ayuda', desc: `Folio ${app.version} · ${app.os === 'windows' ? 'Windows' : app.os === 'linux' ? 'Linux' : app.os}`,
      body: () => [
        row('Tutoriales', 'Un recorrido guiado de unos minutos.', h('div', { class: 'btn-row' },
          btn('Documentos', () => { opts.close(); void app.startTour(); }, 'graduation'),
          btn('Agenda', () => { opts.close(); void app.startTour('agenda'); }, 'calendar'))),
        row('Atajos de teclado', null, btn('Ver atajos', () => void dialogs.shortcutsDialog(app), 'keyboard')),
        row('Actualizaciones', `Tienes la versión ${app.version}.`, btn('Buscar actualizaciones', () => void import('./updates').then((m) => m.updateDialog(app)), 'download')),
      ],
    },
  ];

  const cards = new Map<SettingsSection, HTMLElement>();
  const links = new Map<SettingsSection, HTMLButtonElement>();
  const fill = (sec: (typeof sections)[number]) => {
    cards.get(sec.id)!.replaceChildren(
      h('header', { class: 'st-card-head' }, h('span', { class: 'st-card-ic', html: icon(sec.ic, 18) }),
        h('div', {}, h('h2', {}, sec.title), h('p', {}, sec.desc))),
      ...sec.body().filter((x): x is HTMLElement => !!x));
  };
  function redraw(id: SettingsSection) { fill(sections.find((x) => x.id === id)!); }
  const mark = (id: SettingsSection) => links.forEach((b, k) => b.classList.toggle('on', k === id));

  const toc = h('nav', { class: 'st-toc', 'aria-label': 'Secciones de ajustes' });
  const list = h('div', { class: 'st-sections' });
  for (const sec of sections) {
    const card = h('section', { class: 'st-card', id: `st-${sec.id}` });
    cards.set(sec.id, card);
    fill(sec);
    list.append(card);
    const link = h('button', { type: 'button', class: 'st-link', onclick: () => { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); mark(sec.id); } },
      h('span', { html: icon(sec.ic, 16) }), sec.short ?? sec.title);
    links.set(sec.id, link);
    toc.append(link);
  }
  // Resalta en el índice la sección que se está viendo
  main.onscroll = debounce(() => {
    const top = main.getBoundingClientRect().top + 80;
    let cur = sections[0].id;
    for (const sec of sections) if (cards.get(sec.id)!.getBoundingClientRect().top <= top) cur = sec.id;
    if (main.scrollTop + main.clientHeight >= main.scrollHeight - 4) cur = sections[sections.length - 1].id;
    mark(cur);
  }, 60);

  main.append(
    h('header', { class: 'bs-head st-head' }, h('div', {}, h('h1', {}, 'Ajustes'), h('p', { class: 'muted' }, 'Los cambios se aplican y se guardan al momento.')), status),
    h('div', { class: 'st-layout' }, toc, list));
  mark(opts.section ?? 'appearance');
  if (opts.section) requestAnimationFrame(() => cards.get(opts.section!)?.scrollIntoView({ block: 'start' }));
}
