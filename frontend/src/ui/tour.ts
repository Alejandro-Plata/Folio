// Tutorial guiado. Oscurece la pantalla, resalta el elemento real del que se
// habla y muestra una tarjeta con la explicación. Los pasos «Pruébalo» esperan
// a que la persona haga la acción (se comprueba sola) y la dan por superada.
// Se practica en un documento propio, que se borra al terminar o salir.
import type { JSONContent } from '@tiptap/core';
import type { App } from '../app';
import { api } from '../api';
import { shortcutLabel } from '../shortcuts';
import { escapeHTML, h } from './dom';
import { icon } from './icons';
import { goBack } from '../platform/back';
import { agendaSteps, endAgendaPractice } from '../agenda/tour';

interface Task {
  /** Qué tiene que hacer, en HTML. */
  text: string;
  /** Se comprueba varias veces por segundo; basta con que se cumpla una vez. */
  check: () => boolean | Promise<boolean>;
  done: string;
}

export type TourStep = Step;

interface Step {
  title: string;
  body: string;
  target?: () => Element | null | undefined;
  before?: () => void | Promise<void>;
  task?: Task;
}

const t = (text: string, marks?: string[]): JSONContent => ({ type: 'text', text, ...(marks ? { marks: marks.map((m) => ({ type: m })) } : {}) });
const p = (...c: (JSONContent | string)[]): JSONContent => ({ type: 'paragraph', content: c.length ? c.map((x) => (typeof x === 'string' ? t(x) : x)) : undefined });
const hd = (text: string): JSONContent => ({ type: 'heading', attrs: { level: 2 }, content: [t(text)] });

const PRACTICE_TITLE = 'Práctica del tutorial';
// Unos apuntes breves de 2.º de ESO: lo que se practica parte de texto real.
const BOLD_SENTENCE = 'Todos sus puntos están a la misma distancia del centro.';
const H_ELEMENTS = 'Elementos de la circunferencia';
const AREA_TEXT = 'El área del círculo de radio r es ';
const H_EXERCISES = 'Ejercicios';

function practiceDoc(): JSONContent {
  return {
    type: 'doc', content: [
      hd('La circunferencia y el círculo'),
      p('La circunferencia es una línea curva cerrada y plana. ', BOLD_SENTENCE, ' El círculo es la superficie que queda dentro de ella.'),
      hd(H_ELEMENTS),
      p(),
      p('El radio une el centro con cualquier punto de la circunferencia, y el diámetro mide el doble que el radio.'),
      hd('Longitud y área'),
      p('La longitud de la circunferencia es dos veces π por el radio.'),
      p(AREA_TEXT),
      hd(H_EXERCISES),
      p(t('1. ', ['bold']), 'Calcula el área de una pizza de 30 cm de diámetro. Redondea a las décimas.'),
      { type: 'toggle', attrs: { title: 'Solución', solution: true, open: true }, content: [p('El radio mide 15 cm, así que el área es π · 15² ≈ 706,9 cm².')] },
    ],
  };
}

const isPractice = (d: { title: string; icon: string; trashed: boolean }) => d.title === PRACTICE_TITLE && d.icon === 'graduation';

/** Borra la práctica que quedara de un tutorial interrumpido (por ejemplo, al cerrar la app a medias). */
export async function removeLeftoverPractice(app: App) {
  for (const d of app.docs.filter(isPractice)) await app.deleteForever(d.id);
}

/** Elemento de la cinta por el rótulo de su grupo («Fuente», «Docente»…). */
const ribbonGroup = (label: string) =>
  [...document.querySelectorAll('.ribbon .rg')].find((g) => g.querySelector('.rg-label')?.textContent === label);
/** Botón grande de la cinta por su rótulo. */
const ribbonButton = (label: string) =>
  [...document.querySelectorAll('.ribbon .rb-big')].find((b) => b.querySelector('.rb-big-label')?.textContent?.trim().startsWith(label));

export class Tour {
  private steps: Step[] = [];
  private index = 0;
  private practiceId = '';
  /** Documento abierto antes del tutorial, al que se vuelve al terminar. */
  private returnTo = '';
  private ring = h('div', { class: 'tour-ring' });
  private shade = h('div', { class: 'tour-shade' });
  private card = h('div', { class: 'tour-card', role: 'dialog', 'aria-live': 'polite' });
  private raf = 0;
  private poll: ReturnType<typeof setInterval> | undefined;
  private taskDone = false;
  private active = false;
  private kind: 'docs' | 'agenda' = 'docs';

  constructor(private app: App) {}

  get running() { return this.active; }

  /** Muestra la bienvenida; el tutorial empieza si la persona lo acepta. */
  async start(kind: 'docs' | 'agenda' = 'docs') {
    if (this.active) return;
    this.active = true;
    this.kind = kind;
    const mobile = document.body.classList.contains('is-mobile');
    this.steps = kind === 'agenda' ? agendaSteps(this.app, (a) => this.k(a)) : mobile ? this.buildMobileSteps() : this.buildSteps();
    this.index = 0;
    document.body.append(this.shade, this.ring, this.card);
    document.body.classList.add('touring');
    const follow = () => { this.place(); this.raf = requestAnimationFrame(follow); };
    this.raf = requestAnimationFrame(follow);
    await this.show();
  }

  private k(action: string) {
    const label = shortcutLabel(action, this.app.keymap);
    return label ? label.split('+').map((x) => `<kbd>${escapeHTML(x)}</kbd>`).join('+') : '';
  }

  /** Tutorial de documentos en el móvil: barra inferior, barra de formato y hojas. */
  private buildMobileSteps(): Step[] {
    const app = this.app;
    const shell = () => app.mobile!;
    const docJSON = () => JSON.stringify(app.editor.getJSON());
    let seen = false;
    const latch = (cond: () => boolean) => () => (seen = seen || cond());
    const reset = () => { seen = false; };
    /** Cierra las hojas abiertas (con «atrás», para que la pila quede limpia). */
    const closeSheets = () => { for (let i = 0; i < 4 && document.querySelector('.m-sheet-backdrop'); i++) goBack(); };
    const toEditor = async () => {
      await this.openPractice();
      if (shell().screen !== 'editor') shell().afterOpen();
      await new Promise((r) => setTimeout(r, 150));
    };
    const fb = (label: string) => () => document.querySelector(`.m-fb[aria-label^="${label}"]`);
    return [
      {
        title: 'Bienvenida a Folio',
        body: `<p>Este recorrido te enseña lo esencial en unos cinco minutos. En cada paso se <b>resalta el elemento real</b> de la pantalla.</p>
          <p>En los pasos marcados con <span class="tour-badge">Pruébalo</span> haces tú la acción y Folio comprueba que ha salido bien.</p>
          <p>Para practicar se abre un documento aparte, «${PRACTICE_TITLE}». Se borra solo al terminar y tus documentos no se tocan.</p>`,
      },
      {
        title: 'Tus documentos',
        body: '<p>Aquí están todos tus documentos. Un toque abre uno; si tiene páginas dentro, entras en ellas. Mantén pulsado (o toca ⋯) para marcar favoritos, mover, duplicar o borrar.</p><p>El botón <b>+</b> crea uno nuevo, en blanco o con una plantilla.</p>',
        target: () => document.querySelector('.m-docs .m-list'),
        before: async () => { await this.openPractice(); await shell().go('docs'); },
      },
      {
        title: 'Abrir un documento',
        body: '<p>Abre el documento de práctica para escribir en él.</p>',
        target: () => document.querySelector('.m-docs .m-row-btn'),
        before: async () => { await shell().go('docs'); reset(); },
        task: { text: `Toca «${PRACTICE_TITLE}».`, check: () => shell().screen === 'editor', done: 'Ya estás dentro. Con la flecha de arriba vuelves a la lista.' },
      },
      {
        title: 'Formato del texto',
        body: '<p>Al escribir aparece la <b>barra de formato</b> sobre el teclado: negrita, cursiva, subrayado, listas, sangrías, ecuaciones, imágenes y deshacer. Se desplaza hacia los lados.</p>',
        target: fb('Negrita'),
        before: async () => { await toEditor(); closeSheets(); this.selectText(BOLD_SENTENCE); },
        task: {
          text: `La frase «${BOLD_SENTENCE}» ya está seleccionada. Toca el botón <b>${app.keymap === 'es' ? 'N' : 'B'}</b> de la barra.`,
          check: () => docJSON().includes('"type":"bold"') && !!this.findText(BOLD_SENTENCE, 'bold'),
          done: 'La frase está en negrita.',
        },
      },
      {
        title: 'Estilos, fuente y color',
        body: '<p>El botón <b>Aa</b> abre todo lo demás: estilos (títulos, cita, código), fuente, tamaño, color, resaltado, alineación e interlineado.</p>',
        target: fb('Estilos'),
        before: async () => { await toEditor(); closeSheets(); reset(); this.selectText(BOLD_SENTENCE); },
        task: { text: 'Toca <b>Aa</b> para abrir la hoja de formato.', check: latch(() => !!document.querySelector('.m-sheet')), done: 'Elige un estilo o una fuente si quieres. Cierra la hoja para seguir.' },
      },
      {
        title: 'Insertar con «+»',
        body: '<p>El botón <b>+</b> inserta tablas, cuadros destacados (definición, ejemplo, aviso…), ecuaciones, soluciones plegables, líneas de respuesta y más. Tiene buscador.</p>',
        target: fb('Insertar'),
        before: async () => { closeSheets(); await toEditor(); reset(); this.focusAfter(H_ELEMENTS); },
        task: { text: 'Toca <b>+</b> y elige un bloque, por ejemplo <b>Definición</b>.', check: () => docJSON().includes('"type":"callout"'), done: 'Bloque insertado. Puedes escribir dentro.' },
      },
      {
        title: 'El menú «/»',
        body: '<p>Otra forma de insertar: en una línea vacía escribe <kbd>/</kbd> y aparece el menú de bloques. Sigue escribiendo para filtrar, por ejemplo <kbd>/tabla</kbd>.</p><p>Con una <b>pulsación larga sobre un bloque</b> se abre su menú: convertir, duplicar, mover o eliminar.</p>',
        target: () => this.paragraphAfter(H_ELEMENTS),
        before: async () => { closeSheets(); await toEditor(); reset(); this.focusAfter(H_ELEMENTS); },
        task: { text: `Escribe <kbd>/</kbd> en la línea vacía bajo «${H_ELEMENTS}». Puedes elegir un bloque o cerrar el menú.`, check: latch(() => !!document.querySelector('.slash-menu')), done: 'Ese es el menú de bloques.' },
      },
      {
        title: 'Más acciones',
        body: '<p>En <b>⋯</b> están: exportar (Word, PDF, web, Markdown), imprimir, buscar y reemplazar, esquema, comentarios, historial de versiones, configurar página, ver como hojas y la vista del alumnado.</p><p>Folio guarda solo mientras escribes y crea versiones; en el historial puedes compararlas y restaurarlas.</p>',
        target: () => document.querySelector('.m-appbar button[aria-label="Más acciones"]'),
        before: async () => { closeSheets(); await toEditor(); (document.activeElement as HTMLElement | null)?.blur(); },
      },
      {
        title: 'Agenda, buscar y más',
        body: '<p>Abajo cambias de sección: <b>Documentos</b>, <b>Agenda</b> de estudio, <b>Buscar</b> (en el texto de todos tus documentos y entre las acciones) y <b>Más</b> (plantillas, importar, unir PDF, papelera, ajustes y tutoriales).</p>',
        target: () => document.querySelector('.m-nav'),
        before: async () => { closeSheets(); await shell().go('docs'); },
      },
      {
        title: 'Tus datos en todos tus dispositivos',
        body: '<p>En <b>Más &gt; Sincronización</b> puedes vincular tu nube (Nextcloud u otro WebDAV, o Google Drive) para tener los mismos documentos y la misma agenda en el móvil y en el ordenador. Los datos van directos a tu nube.</p>',
        target: () => document.querySelector('.m-nav-btn:nth-child(4)'),
      },
      {
        title: 'Ya sabes lo esencial',
        body: `<p>Has practicado formato, bloques y la navegación.</p><p>Al terminar se borra «${PRACTICE_TITLE}». Puedes repetir este tutorial desde <b>Más &gt; Tutorial de documentos</b>.</p>`,
      },
    ];
  }

  private buildSteps(): Step[] {
    const app = this.app;
    const k = (a: string) => this.k(a);
    const docJSON = () => JSON.stringify(app.editor.getJSON());
    let versionsAtStart = -1;
    let seen = false;
    const latch = (cond: () => boolean) => () => (seen = seen || cond());
    const resetLatch = () => { seen = false; };

    return [
      {
        title: 'Bienvenida a Folio',
        body: `<p>Este recorrido te enseña lo esencial en unos cinco minutos. En cada paso se <b>resalta el elemento real</b> de la pantalla del que se habla.</p>
          <p>En los pasos marcados con <span class="tour-badge">Pruébalo</span> haces tú la acción y Folio comprueba que ha salido bien.</p>
          <p>Para practicar se abre un documento aparte, «${PRACTICE_TITLE}», con unos apuntes breves. Se borra solo al terminar, y tus documentos no se tocan.</p>`,
      },
      {
        title: 'Tus documentos',
        body: `<p>El panel lateral reúne todos tus documentos. Puedes anidarlos (páginas dentro de páginas), arrastrarlos para reordenarlos y marcarlos como favoritos.</p>
          <p>El botón <b>+</b> junto a «Documentos» crea uno nuevo. Ahora tienes abierto «${PRACTICE_TITLE}».</p>`,
        target: () => document.getElementById('sidebar'),
        before: async () => {
          app.showSidebar(true);
          await this.openPractice();
        },
      },
      {
        title: 'Título del documento',
        body: '<p>El título se escribe aquí, encima del texto. Es el nombre que aparece en el panel lateral y en los archivos que exportes.</p><p>Pulsa <kbd>Intro</kbd> para bajar al texto.</p>',
        target: () => document.querySelector('.doc-title'),
      },
      {
        title: 'Hojas reales',
        body: `<p>En la vista <b>Diseño de impresión</b> el documento se divide en hojas con su encabezado, su pie y «Página X de Y».</p>
          <p>Cada hoja contiene exactamente lo mismo que la página del PDF o de la impresión. Folio guarda solo mientras escribes.</p>`,
        target: () => document.getElementById('page'),
        before: () => { if (!app.settings.pageView) app.setSetting('pageView', true); },
      },
      {
        title: 'La cinta de opciones',
        body: `<p>Las herramientas se agrupan en pestañas: <b>Inicio</b> (formato), <b>Insertar</b>, <b>Disposición</b> (página), <b>Referencias</b>, <b>Revisar</b> y <b>Vista</b>.</p>
          <p><b>Archivo</b> abre Nuevo, Abrir, Exportar e Imprimir. Las pestañas <b>Tabla</b> e <b>Imagen</b> solo aparecen cuando trabajas con una tabla o una imagen.</p>`,
        target: () => document.querySelector('.ribbon .rb-tabs'),
        before: () => app.ribbon.select('home'),
      },
      {
        title: 'Formato del texto',
        body: `<p>El grupo <b>Fuente</b> tiene negrita, cursiva, subrayado, tamaño, color y resaltado. Los atajos más usados: ${k('bold')} negrita, ${k('italic')} cursiva, ${k('underline')} subrayado.</p>`,
        target: () => ribbonGroup('Fuente'),
        before: () => { app.ribbon.select('home'); this.selectText(BOLD_SENTENCE); },
        task: {
          text: `La frase «${BOLD_SENTENCE}» ya está seleccionada. Pulsa ${k('bold')} o el botón <b>${app.keymap === 'es' ? 'N' : 'B'}</b>.`,
          check: () => docJSON().includes('"type":"bold"') && !!this.findText(BOLD_SENTENCE, 'bold'),
          done: 'La frase está en negrita.',
        },
      },
      {
        title: 'Fuentes',
        body: '<p>El selector muestra cada fuente con su propia letra, agrupadas en sin serifa, con serifa, lectura fácil, manuscrita y monoespaciada.</p><p>Las fuentes de Folio se incrustan en el PDF, así que se ven igual en cualquier equipo.</p>',
        target: () => document.querySelector('.ribbon .fp-button'),
        before: () => { app.ribbon.select('home'); this.selectText(BOLD_SENTENCE); },
        task: {
          text: 'Con la frase aún seleccionada, abre el selector de fuente y elige otra, por ejemplo <span style="font-family:\'Lora\',serif">Lora</span> o <span style="font-family:\'Caveat\',cursive;font-size:1.15em">Caveat</span>.',
          check: () => docJSON().includes('"fontFamily":"'),
          done: 'La frase ya usa otra fuente.',
        },
      },
      {
        title: 'Estilos',
        body: `<p>Los estilos dan estructura: <b>Título 1</b> ${k('h1')}, <b>Título 2</b> ${k('h2')}, <b>Título 3</b> ${k('h3')} y <b>Normal</b> ${k('normal')}.</p>
          <p>Con títulos, el <b>Índice</b> (Referencias) y el panel <b>Esquema</b> se rellenan solos, y al exportar a .docx se conservan como títulos.</p>`,
        target: () => ribbonGroup('Estilos'),
        before: () => app.ribbon.select('home'),
      },
      {
        title: 'El menú «/»',
        body: '<p>En una línea vacía, escribe <kbd>/</kbd> y aparece un menú con todos los bloques (títulos, listas, tablas, cuadros, ecuaciones…). Sigue escribiendo para filtrar, por ejemplo <kbd>/tabla</kbd>.</p>',
        target: () => this.paragraphAfter(H_ELEMENTS),
        before: () => { resetLatch(); this.focusAfter(H_ELEMENTS); },
        task: {
          text: `El cursor está en la línea vacía bajo «${H_ELEMENTS}». Escribe <kbd>/</kbd> y elige un bloque, o pulsa <kbd>Esc</kbd> para cerrar el menú.`,
          check: latch(() => !!document.querySelector('.slash-menu')),
          done: 'Ese es el menú de bloques.',
        },
      },
      {
        title: 'Cuadros destacados',
        body: '<p>En <b>Insertar</b> está todo lo que se puede añadir. Los <b>cuadros</b> resaltan definiciones, ejemplos, avisos importantes, consejos o ejercicios, con su color y su icono.</p>',
        target: () => ribbonButton('Cuadro'),
        before: () => { app.ribbon.select('insert'); this.focusAfter(H_ELEMENTS); },
        task: {
          text: 'Pulsa <b>Cuadro</b> y elige <b>Definición</b>, por ejemplo para definir qué es el centro.',
          check: () => docJSON().includes('"type":"callout"'),
          done: 'Cuadro insertado. Puedes escribir dentro.',
        },
      },
      {
        title: 'Ecuaciones',
        body: `<p>Las ecuaciones se escriben en LaTeX y se ven con calidad de imprenta. ${k('equation')} inserta una en el texto. También puedes escribir <kbd>$x^2$</kbd> directamente, o elegir <b>Ecuación</b> para un bloque centrado.</p>`,
        target: () => ribbonGroup('Símbolos'),
        before: () => { app.ribbon.select('insert'); this.focusEndOf(AREA_TEXT); },
        task: {
          text: `El cursor está al final de «${AREA_TEXT.trim()}». Pulsa ${k('equation')}, escribe <code>\\pi r^2</code> y pulsa <kbd>Intro</kbd>.`,
          check: () => /"type":"math(Inline|Block)"/.test(docJSON()),
          done: 'Ecuación insertada. Haz clic en ella para editarla.',
        },
      },
      {
        title: 'Herramientas para clase',
        body: `<p>El grupo <b>Docente</b> añade lo típico de fichas y exámenes:</p>
          <ul><li><b>Solución</b>: un bloque plegable con la respuesta.</li><li><b>Líneas</b>: renglones para responder a mano.</li><li><b>Pregunta</b>: enunciado numerado con su puntuación.</li></ul>
          <p>Al final de los apuntes hay un ejercicio con su solución.</p>`,
        target: () => ribbonGroup('Docente'),
        before: () => { app.ribbon.select('insert'); this.scrollTo(H_EXERCISES); },
      },
      {
        title: 'Versión del alumnado',
        body: '<p>Con un clic ves el documento como lo recibirá el alumnado: sin soluciones y con la paginación que tendrá el PDF.</p><p>Al exportar o imprimir, marca «Versión del alumnado» para obtener esa misma versión.</p>',
        target: () => ribbonButton('Vista del alumnado'),
        before: () => { app.ribbon.select('view'); this.scrollTo(H_EXERCISES); },
        task: {
          text: 'Pulsa <b>Vista del alumnado</b> y fíjate en que la solución desaparece.',
          check: () => app.studentView,
          done: 'La solución está oculta. Al pasar al siguiente paso vuelve a la vista normal.',
        },
      },
      {
        title: 'Configurar la página',
        body: '<p><b>Disposición</b> controla márgenes, orientación, tamaño de papel, encabezado y pie de página, y la fuente y el interlineado de todo el documento.</p><p>En encabezado y pie puedes usar <code>{titulo}</code>, <code>{fecha}</code> y <code>{autor}</code>.</p>',
        target: () => document.querySelector('.ribbon .rb-body'),
        before: () => { if (app.studentView) app.toggleStudentView(); app.ribbon.select('layout'); },
      },
      {
        title: 'La barra de estado',
        body: `<p>Abajo ves la página actual y el total, las palabras, si está guardado y el zoom.</p>
          <p>El botón <b>Atajos</b> cambia entre los atajos en español (${app.keymap === 'es' ? 'los que usas ahora' : 'Ctrl+N negrita'}) y en inglés (${app.keymap === 'en' ? 'los que usas ahora' : 'Ctrl+B negrita'}). Los botones de la derecha cambian entre hojas y vista de lectura, y el zoom se ajusta solo al ancho de la ventana.</p>`,
        target: () => document.getElementById('statusbar'),
      },
      {
        title: 'Guardar y versiones',
        body: `<p>Folio guarda solo mientras escribes y crea una versión cada pocos minutos de trabajo.</p>
          <p>${k('save')} guarda un <b>punto de restauración</b>, y ${k('saveVersion')} una versión con nombre (por ejemplo «Antes de corregir»).</p>`,
        target: () => document.querySelector('.topbar [title^="Guardar"]'),
        before: async () => {
          app.ribbon.select('home');
          versionsAtStart = this.practiceId ? (await api.ListVersions(this.practiceId)).length : 0;
        },
        task: {
          text: `Haz clic en el documento y pulsa ${k('save')}, o el botón de guardar resaltado.`,
          check: async () => !!this.practiceId && versionsAtStart >= 0 && (await api.ListVersions(this.practiceId)).length > versionsAtStart,
          done: 'Punto de restauración guardado.',
        },
      },
      {
        title: 'Historial de versiones',
        body: '<p>El historial muestra todas las versiones. Puedes verlas, <b>compararlas palabra a palabra</b> con la actual y restaurarlas.</p><p>Restaurar nunca borra nada: antes se guarda una copia del estado actual.</p>',
        target: () => document.querySelector('.topbar [title^="Historial de versiones"]'),
        task: {
          text: 'Abre el historial con el botón resaltado.',
          check: () => app.panels.active === 'versions',
          done: 'Ahí está tu punto de restauración. Puedes cerrar el panel con la ×.',
        },
      },
      {
        title: 'Buscar cualquier cosa',
        body: `<p>¿No encuentras una opción? Pulsa ${k('palette')} y escribe lo que quieres hacer: «interlineado», «tabla», «exportar», «tutorial»… También busca dentro de todos tus documentos, sin distinguir tildes.</p>`,
        target: () => document.querySelector('.top-search'),
        before: () => { resetLatch(); app.panels.close(); },
        task: {
          text: `Pulsa ${k('palette')} o el cuadro «Buscar» y escribe <kbd>tabla</kbd>. Cierra con <kbd>Esc</kbd>.`,
          check: latch(() => !!document.querySelector('.palette')),
          done: 'Desde ahí se llega a cualquier comando.',
        },
      },
      {
        title: 'Exportar e imprimir',
        body: `<p><b>Exportar</b> genera <b>PDF</b> (idéntico a las hojas que ves), <b>Word (.docx)</b>, página web y Markdown. ${k('print')} imprime con vista previa.</p>
          <p>En ambos puedes elegir la versión del alumnado y si incluir el título.</p>`,
        target: () => document.querySelector('.topbar .btn-accent'),
      },
      {
        title: 'Ayuda siempre a mano',
        body: `<p>El botón <b>?</b> abre la ayuda: la lista de atajos (${k('help')}) y este tutorial, que puedes repetir cuando quieras.</p>
          <p>También está en <b>Archivo &gt; Tutorial</b> y buscando «tutorial» con ${k('palette')}.</p>`,
        target: () => document.querySelector('.topbar .help-btn'),
      },
      {
        title: 'Ya sabes lo esencial',
        body: `<p>Has practicado formato, fuentes, bloques, cuadros, ecuaciones, la versión del alumnado, las versiones y la búsqueda.</p>
          ${app.os === 'windows' ? '<p><b>Consejo:</b> haz clic derecho en el icono de Folio de la barra de tareas y elige «Anclar a la barra de tareas» para tenerlo siempre a mano.</p>' : ''}
          <p>Al terminar se borra «${PRACTICE_TITLE}» y vuelves a tus documentos.</p>`,
      },
    ];
  }

  // ---------- Documento de práctica ----------

  private async openPractice() {
    const app = this.app;
    if (this.practiceId && app.docs.some((d) => d.id === this.practiceId && !d.trashed)) {
      if (app.doc?.meta.id !== this.practiceId) await app.open(this.practiceId);
      return;
    }
    await removeLeftoverPractice(app);
    this.returnTo = app.doc?.meta.id ?? '';
    await app.flush();
    const m = await app.createFromJSON(PRACTICE_TITLE, 'graduation', practiceDoc());
    this.practiceId = m.id;
    await app.refreshDocs();
    await app.open(m.id);
  }

  /** Posición (inicio, fin) de un texto del documento, con una marca concreta si se pide. */
  private findText(text: string, mark?: string): { from: number; to: number } | null {
    let found: { from: number; to: number } | null = null;
    this.app.editor.state.doc.descendants((n, pos) => {
      if (found || !n.isText || !n.text?.includes(text)) return !found;
      if (mark && !n.marks.some((m) => m.type.name === mark)) return true;
      const from = pos + n.text.indexOf(text);
      found = { from, to: from + text.length };
      return false;
    });
    return found;
  }

  private selectText(text: string) {
    const r = this.findText(text);
    if (r) this.app.editor.chain().focus().setTextSelection(r).scrollIntoView().run();
  }

  /** Posición del bloque que sigue al título indicado. */
  private blockAfter(heading: string): number | null {
    const doc = this.app.editor.state.doc;
    let next: number | null = null;
    let hit = false;
    doc.forEach((n, offset) => {
      if (next !== null) return;
      if (hit) { next = offset; return; }
      hit = n.type.name === 'heading' && n.textContent === heading;
    });
    return next;
  }

  private paragraphAfter(heading: string) {
    const pos = this.blockAfter(heading);
    return pos === null ? null : (this.app.editor.view.nodeDOM(pos) as Element | null);
  }

  private focusAfter(heading: string) {
    const pos = this.blockAfter(heading);
    if (pos !== null) this.app.editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
  }

  private focusEndOf(text: string) {
    const r = this.findText(text);
    if (r) this.app.editor.chain().focus().setTextSelection(r.to).scrollIntoView().run();
  }

  private scrollTo(heading: string) {
    const pos = this.blockAfter(heading);
    const el = pos === null ? null : (this.app.editor.view.nodeDOM(pos) as HTMLElement | null);
    el?.scrollIntoView({ block: 'center' });
  }

  // ---------- Dibujo ----------

  private async show() {
    clearInterval(this.poll);
    const step = this.steps[this.index];
    this.taskDone = false;
    try { await step.before?.(); } catch (e) { console.error(e); }
    if (!this.active) return;
    this.render();
    if (step.task) {
      const task = step.task;
      let busy = false;
      this.poll = setInterval(async () => {
        if (busy || this.taskDone) return;
        busy = true;
        try {
          if (await task.check()) { this.taskDone = true; this.render(); }
        } finally { busy = false; }
      }, 250);
    }
  }

  private render() {
    const step = this.steps[this.index];
    const n = this.steps.length;
    const first = this.index === 0;
    const last = this.index === n - 1;
    const task = step.task;
    this.card.innerHTML = '';
    this.card.classList.toggle('is-center', !step.target);
    const progress = h('div', { class: 'tour-progress' }, h('span', { style: { width: `${((this.index + 1) / n) * 100}%` } }));
    const head = h('div', { class: 'tour-head' },
      h('span', { class: 'tour-count' }, first ? 'Tutorial' : last ? 'Final' : `Paso ${this.index} de ${n - 2}`),
      task ? h('span', { class: 'tour-badge' }, 'Pruébalo') : null,
      h('button', { class: 'tour-close', title: 'Salir del tutorial', 'aria-label': 'Salir del tutorial', html: icon('x', 16), onclick: () => void this.finish() }));
    const body = h('div', { class: 'tour-body', html: step.body });
    const taskBox = task
      ? h('div', { class: `tour-task ${this.taskDone ? 'is-done' : ''}` },
        h('span', { class: 'tour-task-ic', html: icon(this.taskDone ? 'checkCircle' : 'target', 18) }),
        h('div', { class: 'tour-task-text', html: this.taskDone ? `<b>¡Hecho!</b> ${task.done}` : task.text }))
      : null;
    const btn = (label: string, cls: string, run: () => void) => h('button', { class: `btn btn-sm ${cls}`, onclick: run }, label);
    const foot = h('div', { class: 'tour-foot' });
    if (first) {
      foot.append(btn('Ahora no', 'btn-ghost', () => void this.finish()), h('div', { class: 'spacer' }), btn('Empezar', 'btn-primary', () => { this.markDone(); this.go(1); }));
    } else if (last) {
      foot.append(btn('Anterior', 'btn-ghost', () => this.go(this.index - 1)), h('div', { class: 'spacer' }), btn('Terminar', 'btn-primary', () => void this.finish()));
    } else {
      foot.append(btn('Anterior', 'btn-ghost', () => this.go(this.index - 1)), h('div', { class: 'spacer' }));
      if (task && !this.taskDone) foot.append(btn('Saltar', 'btn-ghost', () => this.go(this.index + 1)));
      foot.append(btn('Siguiente', task && !this.taskDone ? 'btn' : 'btn-primary', () => this.go(this.index + 1)));
    }
    this.card.append(progress, head, h('h2', { class: 'tour-title' }, step.title), body, ...(taskBox ? [taskBox] : []), foot);
    this.place();
    if (!task) (this.card.querySelector('.btn-primary') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private go(i: number) {
    this.index = Math.max(0, Math.min(this.steps.length - 1, i));
    void this.show();
  }

  /** Coloca el resalte sobre el elemento y la tarjeta a su lado sin taparlo. */
  private place() {
    if (!this.active) return;
    const step = this.steps[this.index];
    const el = step.target?.();
    const vw = window.innerWidth, vh = window.innerHeight;
    const cw = this.card.offsetWidth, ch = this.card.offsetHeight;
    const r = el instanceof HTMLElement && el.getClientRects().length ? el.getBoundingClientRect() : null;
    const dim = !step.task;
    this.shade.classList.toggle('is-dim', !r && dim);
    this.ring.hidden = !r || (document.body.classList.contains('is-mobile') && !!document.querySelector('.m-sheet-backdrop'));
    this.ring.classList.toggle('is-dim', dim);
    if (r && document.body.classList.contains('is-mobile')) {
      // Móvil: tarjeta a todo el ancho, en la mitad de la pantalla opuesta al elemento (o arriba si hay una hoja abierta)
      const pad = 6;
      Object.assign(this.ring.style, { left: `${Math.max(2, r.left - pad)}px`, top: `${Math.max(2, r.top - pad)}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
      const safe = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-top')) || 0;
      const upper = r.top + r.height / 2 < vh / 2;
      const sheetOpen = !!document.querySelector('.m-sheet-backdrop');
      this.card.style.left = '12px';
      this.card.style.top = `${upper && !sheetOpen ? Math.max(12, vh - ch - 84) : 12 + safe}px`;
      return;
    }
    if (!r) {
      this.card.style.left = `${(vw - cw) / 2}px`;
      this.card.style.top = `${Math.max(16, (vh - ch) / 2)}px`;
      return;
    }
    const pad = 6;
    const box = { left: Math.max(4, r.left - pad), top: Math.max(4, r.top - pad), right: Math.min(vw - 4, r.right + pad), bottom: Math.min(vh - 4, r.bottom + pad) };
    Object.assign(this.ring.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.right - box.left}px`, height: `${box.bottom - box.top}px` });
    const gap = 14;
    const fits = {
      below: box.bottom + gap + ch <= vh - 8,
      above: box.top - gap - ch >= 8,
      right: box.right + gap + cw <= vw - 8,
      left: box.left - gap - cw >= 8,
    };
    let left: number, top: number;
    const clampX = (x: number) => Math.max(8, Math.min(x, vw - cw - 8));
    const clampY = (y: number) => Math.max(8, Math.min(y, vh - ch - 8));
    if (fits.below) { left = clampX(box.left); top = box.bottom + gap; }
    else if (fits.right) { left = box.right + gap; top = clampY(box.top); }
    else if (fits.left) { left = box.left - gap - cw; top = clampY(box.top); }
    else if (fits.above) { left = clampX(box.left); top = box.top - gap - ch; }
    else { left = vw - cw - 16; top = vh - ch - 16; } // elemento enorme: esquina inferior derecha
    this.card.style.left = `${left}px`;
    this.card.style.top = `${top}px`;
  }

  /** No se vuelve a mostrar solo, aunque se cierre la app a medias (en Windows incluye el aviso de anclar). */
  private markDone() {
    if (this.kind === 'agenda') return;
    const app = this.app;
    app.settings.tourDone = true;
    if (app.os === 'windows') app.settings.pinTipShown = true;
    app.persistSettings();
  }

  /** Cierra el tutorial; en el móvil vuelve a la lista de documentos (o a la agenda). */
  private async finish() {
    const kind = this.kind;
    await this.finishInner();
    if (this.app.mobile) await this.app.mobile.go(kind === 'agenda' ? 'agenda' : 'docs');
  }

  /** Quita el tutorial y borra definitivamente el documento de práctica. */
  private async finishInner() {
    if (!this.active) return;
    this.active = false;
    clearInterval(this.poll);
    cancelAnimationFrame(this.raf);
    this.shade.remove();
    this.ring.remove();
    this.card.remove();
    document.body.classList.remove('touring');
    const app = this.app;
    if (app.studentView) app.toggleStudentView();
    this.markDone();
    if (this.kind === 'agenda') {
      await endAgendaPractice(app).catch((e) => console.error(e));
      return;
    }
    const id = this.practiceId;
    this.practiceId = '';
    if (!id) return;
    if (app.doc?.meta.id === id && app.docs.some((d) => d.id === this.returnTo && !d.trashed)) await app.open(this.returnTo);
    await app.deleteForever(id);
  }
}
