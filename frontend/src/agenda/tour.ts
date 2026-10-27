// Pasos del tutorial de la agenda. Se practica en una agenda vacía y aislada
// (AgendaPractice) que se borra al terminar: la agenda real no se toca.
import type { App } from '../app';
import { api } from '../api';
import type { TourStep } from '../ui/tour';

const q = (sel: string) => () => document.querySelector(sel);

export function agendaSteps(app: App, k: (action: string) => string): TourStep[] {
  if (document.body.classList.contains('is-mobile')) return mobileAgendaSteps(app);
  const ag = () => app.agenda;
  let tasksAtStart = 0;
  return [
    {
      title: 'La agenda de estudio',
      body: `<p>Este recorrido enseña a organizar el estudio en unos cinco minutos: crear tareas escribiendo o dictando, moverte por días, semanas, meses y años, y dejar que Folio reparta el estudio y los repasos hasta el examen.</p>
        <p>Se practica en una <b>agenda de prueba vacía</b> que se borra al terminar. Tu agenda no se toca.</p>`,
    },
    {
      title: 'Documentos y agenda',
      body: `<p>Arriba del panel lateral cambias entre <b>Documentos</b> y <b>Agenda</b> (${k('modeDocs')} y ${k('modeAgenda')}).</p>
        <p>Debajo tienes el minicalendario para saltar a cualquier día, lo próximo de hoy y los tipos de tarea.</p>`,
      target: q('.sb-modes'),
      before: async () => {
        await api.AgendaPractice(true);
        await app.setMode('agenda');
        await ag().state.load();
        ag().goTo('week', ag().state.today);
      },
    },
    {
      title: 'Moverte por el tiempo',
      body: `<p><b>Hoy</b> vuelve al día actual y las flechas pasan al periodo anterior o siguiente. Con el teclado: <kbd>H</kbd> hoy, <kbd>←</kbd> <kbd>→</kbd>, y <kbd>D</kbd> <kbd>S</kbd> <kbd>M</kbd> <kbd>A</kbd> para día, semana, mes y año.</p>
        <p><kbd>G</kbd> abre «Ir a»: entiende «15 marzo», «semana 12» o «+3 semanas».</p>`,
      target: q('.ag-head-row'),
      task: {
        text: 'Cambia a la vista de <b>Mes</b> (botón o tecla <kbd>M</kbd>).',
        check: () => ag().view === 'month',
        done: 'En el mes ves la carga de estudio de cada día.',
      },
    },
    {
      title: 'Crear escribiendo',
      body: '<p>En la barra escribe la tarea como la dirías: fecha, hora, duración, repetición, tipo y tema. Antes de crear nada ves lo que se ha entendido.</p><p>Ejemplos: «de lunes a viernes de 9 a 11 estudio», «simulacro cada 2 semanas los sábados a las 9», «llamar al centro el 3 de noviembre a las 10».</p>',
      target: q('.ag-quick'),
      before: async () => { tasksAtStart = (await ag().state.range('1900-01-01', '2999-12-31')).length; },
      task: {
        text: 'Escribe <kbd>mañana de 9 a 11 estudio tema 1</kbd> y pulsa <kbd>Intro</kbd>.',
        check: async () => (await ag().state.range('1900-01-01', '2999-12-31')).length > tasksAtStart,
        done: 'Tarea creada. Pulsa Mayús+Intro si quieres revisar todos los campos antes.',
      },
    },
    {
      title: 'Dictar',
      body: `<p>El micrófono convierte tu voz en texto <b>sin conexión</b>, y la frase pasa por el mismo análisis que la barra. Mantén <kbd>Ctrl</kbd>+<kbd>Mayús</kbd>+<kbd>Espacio</kbd> mientras hablas y suelta para terminar.</p>
        <p>Puedes dictar varias tareas seguidas: «mañana a las 9 tema 3 y luego a las 12 repaso del tema 1».</p>`,
      target: q('.ag-mic'),
    },
    {
      title: 'Tipos y prioridades',
      body: '<p>Cada tarea tiene un tipo con prioridad (1 es la más alta), color, icono y trama, para distinguirlos también sin color. Toca un tipo para ocultarlo o mostrarlo; con el lápiz los cambias.</p><p>En la barra puedes escribir «prioridad alta» o «!1».</p>',
      target: q('.ag-legend'),
    },
    {
      title: 'Varios días a la vez',
      body: '<p>Para no repetir lo mismo día a día, arrastra sobre el mes (o usa Mayús+clic) y elige qué hacer con todos: añadir la misma tarea, copiarlos, moverlos, marcarlos como descanso o borrar sus tareas.</p><p>Las <b>semanas tipo</b> guardan una semana y la aplican a muchas de una vez.</p>',
      target: q('.ag-body'),
      before: () => { if (ag().view !== 'month') ag().setView('month'); },
      task: {
        text: 'Arrastra sobre tres días seguidos del mes.',
        check: () => ag().selection.size >= 2,
        done: 'Abajo tienes las acciones para todos los días elegidos.',
      },
    },
    {
      title: 'El temario',
      body: '<p>Con <b>Añadir temas</b> los escribes, pegas la lista (un tema por línea) o sacas el índice de un documento. Con <b>Añadir apuntes…</b> eliges tus PDF o Word de una vez y cada uno va a su tema según el número del nombre («Tema 3.pdf»).</p>',
      target: q('.ag-tools button[title="Temario de la oposición"]'),
      before: () => ag().select([], 'replace'),
      task: {
        text: 'Abre <b>Temario</b>, pulsa <b>Añadir temas › Pegar una lista de temas…</b>, pega unos temas y guarda con <b>Guardar y planificar</b>.',
        check: () => ag().state.topics.length > 0,
        done: 'Temario guardado: el plan ya se ha calculado.',
      },
    },
    {
      title: 'Estudio y repasos, intercalados',
      body: `<p><b>Planificar</b> reparte el estudio nuevo y los repasos de cada tema en tu tiempo de estudio, sin pasarte de lo que elijas cada día. Los repasos siguen la <b>repetición espaciada</b>: cada vez más separados según lo bien que recuerdes el tema.</p>
        <p>En <b>Plan</b> eliges la fecha del examen, cuánto estudias cada día (horas, franja o ambas, con sugerencias según lo que sueles hacer) y la fase final de solo repasos.</p>`,
      target: q('.ag-tools button[title^="Repartir"]'),
      before: () => ag().goTo('week', ag().state.today),
    },
    {
      title: 'Marcar como hecha',
      body: '<p>Al terminar un bloque, márcalo con su casilla. Apuntas el tiempo real y lo bien que recordabas el tema (<b>Otra vez</b>, <b>Difícil</b>, <b>Bien</b>, <b>Fácil</b>): con eso se calcula el siguiente repaso y el plan se ajusta solo.</p>',
      target: () => document.querySelector('.ag-block.is-auto') ?? document.querySelector('.ag-block'),
      task: {
        text: 'Marca como hecha una tarea del plan con su casilla y guarda la valoración.',
        check: async () => (await api.AgendaSessions('', ''))?.length > 0,
        done: 'Sesión registrada. El siguiente repaso ya está recolocado.',
      },
    },
    {
      title: 'La curva del olvido',
      body: '<p>Bajo cada estudio o repaso hay un desplegable con su tema: cuántas veces lo has visto y qué tal te fue, cuánto lo recuerdas ese día, cuándo tocaría el siguiente repaso según cómo te vaya y tus apuntes para abrirlos al momento.</p>',
      target: () => document.querySelector('.ag-next .ag-mem'),
    },
    {
      title: 'Tu progreso',
      body: '<p><b>Progreso</b> muestra las horas por semana frente a tu objetivo, la racha, cuánto temario llevas, los temas más flojos y las notas de los simulacros. Se exporta a CSV.</p>',
      target: q('.ag-tools button[title="Progreso del estudio"]'),
    },
    {
      title: 'Ya sabes organizarte',
      body: '<p>Al terminar se borra la agenda de prueba y vuelves a la tuya.</p><p>Puedes repetir este tutorial desde el botón <b>?</b> de la barra superior o buscando «tutorial de la agenda».</p>',
    },
  ];
}

/** Sale de la agenda de práctica y vuelve a la real. */
export async function endAgendaPractice(app: App) {
  await api.AgendaPractice(false);
  await app.agenda.state.load();
  app.agenda.select([], 'replace');
  app.agenda.goTo('week', app.agenda.state.today);
}

/** Tutorial de la agenda en el móvil. */
function mobileAgendaSteps(app: App): TourStep[] {
  const ag = () => app.agenda;
  const shell = () => app.mobile!;
  const moreRow = (label: string) => () =>
    [...document.querySelectorAll('.m-more .m-row-title')].find((e) => e.textContent === label)?.closest('button') ?? null;
  let tasksAtStart = 0;
  return [
    {
      title: 'La agenda de estudio',
      body: `<p>Este recorrido enseña a organizar el estudio en unos cinco minutos: crear tareas escribiendo o dictando, moverte por días, meses y años, y dejar que Folio reparta el estudio y los repasos hasta el examen.</p>
        <p>Se practica en una <b>agenda de prueba vacía</b> que se borra al terminar. Tu agenda no se toca.</p>`,
    },
    {
      title: 'Las secciones',
      body: '<p>Abajo cambias entre <b>Documentos</b>, <b>Agenda</b>, <b>Buscar</b> y <b>Más</b>. El temario, el plan y el progreso del estudio están en <b>Más</b>.</p>',
      target: q('.m-nav'),
      before: async () => {
        await api.AgendaPractice(true);
        await shell().go('agenda');
        await ag().state.load();
        ag().setView('list');
      },
    },
    {
      title: 'Cambiar de vista',
      body: '<p><b>Lista</b> enseña los próximos días uno tras otro, <b>Día</b> y <b>3 días</b> la rejilla por horas, <b>Mes</b> cada día con puntos de colores y <b>Año</b> un mapa de calor del estudio.</p><p>Desliza a los lados para pasar al periodo siguiente o anterior. Toca el título para saltar a cualquier día.</p>',
      target: q('.ag-views'),
      task: { text: 'Cambia a la vista <b>Mes</b>.', check: () => ag().view === 'month', done: 'En el mes, toca un día para ver sus tareas debajo.' },
    },
    {
      title: 'Crear una tarea',
      body: '<p>El botón <b>+</b> abre la barra rápida: escribe la tarea como la dirías, con fecha, hora, duración, repetición, tipo y tema. Antes de crear nada ves lo que se ha entendido.</p><p>Ejemplos: «de lunes a viernes de 9 a 11 estudio», «simulacro cada 2 semanas los sábados a las 9».</p>',
      target: q('.m-fab'),
      before: async () => { ag().setView('list'); tasksAtStart = (await ag().state.range('1900-01-01', '2999-12-31')).length; },
      task: {
        text: 'Toca <b>+</b>, escribe <kbd>mañana de 9 a 11 estudio tema 1</kbd> y pulsa <b>Crear</b>.',
        check: async () => (await ag().state.range('1900-01-01', '2999-12-31')).length > tasksAtStart,
        done: 'Tarea creada. Con «Mayús+Intro» (o el lápiz) revisas todos los campos antes.',
      },
    },
    {
      title: 'Dictar',
      body: '<p>Mantén pulsado <b>+</b> mientras hablas y suelta para terminar. El móvil reconoce tu voz <b>sin salir del dispositivo</b> y la frase pasa por el mismo análisis que si la escribieras.</p><p>Puedes dictar varias tareas seguidas: «mañana a las 9 tema 3 y luego a las 12 repaso del tema 1».</p>',
      target: q('.m-fab'),
    },
    {
      title: 'Tipos y prioridades',
      body: '<p>Cada tarea tiene un tipo con prioridad (1 es la más alta), color, icono y forma, para distinguirlos también sin color. Se editan en <b>Más &gt; Tipos y prioridades</b>.</p>',
      target: q('.ag-body'),
    },
    {
      title: 'Varios días a la vez',
      body: '<p>Para no repetir lo mismo día a día, mantén pulsado un día del mes y toca otros: puedes añadir la misma tarea a todos, copiarlos, moverlos, marcarlos como descanso o borrar sus tareas.</p><p>Las <b>semanas tipo</b> (en Más) guardan una semana y la aplican a muchas de una vez.</p>',
      target: q('.ag-body'),
      before: () => { if (ag().view !== 'month') ag().setView('month'); },
      task: { text: 'Mantén pulsado un día del mes y toca otro.', check: () => ag().selection.size >= 2, done: 'Abajo tienes las acciones para todos los días elegidos.' },
    },
    {
      title: 'El temario',
      body: '<p>En <b>Más &gt; Temario</b> añades los temas (a mano, pegando la lista o sacando el índice de un documento) y les adjuntas sus apuntes en PDF o Word.</p>',
      target: moreRow('Temario'),
      before: async () => { ag().select([], 'replace'); await shell().go('more'); },
      task: { text: 'Abre <b>Temario</b>, pega unos temas con <b>Añadir temas › Pegar una lista de temas…</b> y guarda con <b>Guardar y planificar</b>.', check: () => ag().state.topics.length > 0, done: 'Temario guardado: el plan ya se ha calculado.' },
    },
    {
      title: 'Estudio y repasos, intercalados',
      body: '<p>El plan reparte el estudio nuevo y los repasos de cada tema en tu tiempo de estudio, sin pasarse de lo que elijas cada día. Los repasos siguen la <b>repetición espaciada</b>: cada vez más separados según lo bien que recuerdes el tema.</p><p>En <b>Más &gt; Plan de estudio</b> eliges la fecha del examen y cuánto estudias cada día.</p>',
      target: moreRow('Plan de estudio'),
      before: async () => { await shell().go('more'); },
    },
    {
      title: 'Marcar como hecha',
      body: '<p>Al terminar un bloque, márcalo con su casilla. Apuntas el tiempo real y lo bien que recordabas el tema (<b>Otra vez</b>, <b>Difícil</b>, <b>Bien</b>, <b>Fácil</b>): con eso se calcula el siguiente repaso.</p>',
      target: () => document.querySelector('.ag-list .ag-done'),
      before: async () => { await shell().go('agenda'); ag().setView('list'); },
      task: { text: 'Marca como hecha una tarea del plan y guarda la valoración.', check: async () => (await api.AgendaSessions('', ''))?.length > 0, done: 'Sesión registrada. El siguiente repaso ya está recolocado.' },
    },
    {
      title: 'La curva del olvido',
      body: '<p>Bajo cada estudio o repaso hay un desplegable con su tema: cuántas veces lo has visto y qué tal te fue, cuánto lo recuerdas ese día, cuándo tocaría el siguiente repaso según cómo te vaya y tus apuntes para abrirlos al momento.</p>',
      target: () => document.querySelector('.ag-list .ag-mem'),
    },
    {
      title: 'Tu progreso',
      body: '<p><b>Más &gt; Progreso</b> muestra las horas por semana frente a tu objetivo, la racha, cuánto temario llevas, los temas más flojos y las notas de los simulacros.</p>',
      target: moreRow('Progreso'),
      before: async () => { await shell().go('more'); },
    },
    {
      title: 'Ya sabes organizarte',
      body: '<p>Al terminar se borra la agenda de prueba y vuelves a la tuya.</p><p>Puedes repetir este tutorial desde <b>Más &gt; Tutorial de la agenda</b>.</p>',
    },
  ];
}
