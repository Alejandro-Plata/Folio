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
      title: 'La agenda',
      body: `<p>Crear tareas escribiendo o dictando, moverse por el calendario y planificar el estudio con repasos.</p>
        <p>Se practica en una agenda de prueba que se borra al terminar.</p>`,
    },
    {
      title: 'Documentos y agenda',
      body: `<p>Arriba del panel lateral cambias entre <b>Documentos</b> y <b>Agenda</b> (${k('modeDocs')} y ${k('modeAgenda')}).</p>
        <p>Debajo: minicalendario, próximas tareas y tipos.</p>`,
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
      body: `<p><b>Hoy</b> y las flechas mueven el periodo. Teclas: <kbd>H</kbd> hoy, <kbd>←</kbd> <kbd>→</kbd>, <kbd>D</kbd> <kbd>S</kbd> <kbd>M</kbd> <kbd>A</kbd> día, semana, mes y año.</p>
        <p><kbd>G</kbd> abre «Ir a» («15 marzo», «semana 12», «+3 semanas»).</p>`,
      target: q('.ag-head-row'),
      task: {
        text: 'Cambia a la vista de <b>Mes</b> (botón o tecla <kbd>M</kbd>).',
        check: () => ag().view === 'month',
        done: 'Vista de mes.',
      },
    },
    {
      title: 'Crear escribiendo',
      body: '<p>La tarea se escribe como se diría: fecha, hora, duración, repetición, tipo y tema. Antes de crearla se muestra lo que se ha entendido.</p><p>Ejemplos: «de lunes a viernes de 9 a 11 estudio», «reunión cada 2 semanas los jueves a las 17», «dentista el 3 de noviembre a las 10».</p>',
      target: q('.ag-quick'),
      before: async () => { tasksAtStart = (await ag().state.range('1900-01-01', '2999-12-31')).length; },
      task: {
        text: 'Escribe <kbd>mañana de 9 a 11 estudio tema 1</kbd> y pulsa <kbd>Intro</kbd>.',
        check: async () => (await ag().state.range('1900-01-01', '2999-12-31')).length > tasksAtStart,
        done: 'Tarea creada. Mayús+Intro abre el editor completo.',
      },
    },
    {
      title: 'Dictar',
      body: `<p>Dictado sin conexión: mantener <kbd>Ctrl</kbd>+<kbd>Mayús</kbd>+<kbd>Espacio</kbd> mientras se habla. La frase se interpreta igual que en la barra.</p>`,
      target: q('.ag-mic'),
    },
    {
      title: 'Tipos y prioridades',
      body: '<p>Cada tipo tiene prioridad (1 = máxima), color, icono y trama. Un clic lo oculta o lo muestra; el lápiz los edita.</p>',
      target: q('.ag-legend'),
    },
    {
      title: 'Varios días a la vez',
      body: '<p>Arrastrando sobre el mes (o con Mayús+clic) se seleccionan varios días: añadir una tarea a todos, copiar, mover, marcar descanso o borrar.</p><p>Las <b>semanas tipo</b> guardan una semana para aplicarla a otras.</p>',
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
      body: '<p><b>Añadir temas</b>: a mano, pegando una lista o desde el índice de un documento. <b>Añadir apuntes…</b>: varios PDF o Word a la vez, asignados por el número del nombre («Tema 3.pdf»).</p>',
      target: q('.ag-tools button[title="Temas y apuntes"]'),
      before: () => ag().select([], 'replace'),
      task: {
        text: 'Abre <b>Temario</b>, pulsa <b>Añadir temas › Pegar una lista de temas…</b>, pega unos temas y guarda con <b>Guardar y planificar</b>.',
        check: () => ag().state.topics.length > 0,
        done: 'Temario guardado: el plan ya se ha calculado.',
      },
    },
    {
      title: 'Estudio y repasos, intercalados',
      body: `<p><b>Planificar</b> reparte estudio y repasos en el tiempo disponible. Los repasos se espacian según lo que se recuerda cada tema.</p>
        <p>En <b>Plan</b>: fecha objetivo, tiempo por día y fase final de repaso.</p>`,
      target: q('.ag-tools button[title^="Repartir"]'),
      before: () => ag().goTo('week', ag().state.today),
    },
    {
      title: 'Marcar como hecha',
      body: '<p>La casilla marca la tarea como hecha. Con tema, se anota el tiempo y cuánto se recordaba (<b>Otra vez</b>, <b>Difícil</b>, <b>Bien</b>, <b>Fácil</b>); de ahí sale el siguiente repaso.</p>',
      target: () => document.querySelector('.ag-block.is-auto') ?? document.querySelector('.ag-block'),
      task: {
        text: 'Marca como hecha una tarea del plan con su casilla y guarda la valoración.',
        check: async () => (await api.AgendaSessions('', ''))?.length > 0,
        done: 'Sesión registrada.',
      },
    },
    {
      title: 'La curva del olvido',
      body: '<p>Cada tarea con tema tiene un desplegable: historial, recuerdo estimado para ese día, próximo repaso y apuntes.</p>',
      target: () => document.querySelector('.ag-next .ag-mem'),
    },
    {
      title: 'Tu progreso',
      body: '<p><b>Progreso</b>: horas por semana, racha, temas estudiados, temas más flojos y notas. Se exporta a CSV.</p>',
      target: q('.ag-tools button[title="Progreso del estudio"]'),
    },
    {
      title: 'Ya sabes organizarte',
      body: '<p>Se borra la agenda de prueba. El tutorial se repite desde el botón <b>?</b> de la barra superior.</p>',
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
      title: 'La agenda',
      body: `<p>Crear tareas escribiendo o dictando, moverse por el calendario y planificar el estudio con repasos.</p>
        <p>Se practica en una agenda de prueba que se borra al terminar.</p>`,
    },
    {
      title: 'Las secciones',
      body: '<p>Abajo: <b>Documentos</b>, <b>Agenda</b>, <b>Buscar</b> y <b>Más</b> (temario, plan y progreso).</p>',
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
      body: '<p><b>Lista</b>, <b>Día</b>, <b>3 días</b>, <b>Mes</b> y <b>Año</b>. Deslizar a los lados cambia de periodo; tocar el título salta a cualquier día.</p>',
      target: q('.ag-views'),
      task: { text: 'Cambia a la vista <b>Mes</b>.', check: () => ag().view === 'month', done: 'En el mes, toca un día para ver sus tareas debajo.' },
    },
    {
      title: 'Crear una tarea',
      body: '<p><b>+</b> abre la barra rápida. La tarea se escribe como se diría y antes de crearla se muestra lo que se ha entendido.</p><p>Ejemplo: «de lunes a viernes de 9 a 11 estudio».</p>',
      target: q('.m-fab'),
      before: async () => { ag().setView('list'); tasksAtStart = (await ag().state.range('1900-01-01', '2999-12-31')).length; },
      task: {
        text: 'Toca <b>+</b>, escribe <kbd>mañana de 9 a 11 estudio tema 1</kbd> y pulsa <b>Crear</b>.',
        check: async () => (await ag().state.range('1900-01-01', '2999-12-31')).length > tasksAtStart,
        done: 'Tarea creada. El lápiz abre el editor completo.',
      },
    },
    {
      title: 'Dictar',
      body: '<p>Mantener pulsado <b>+</b> mientras se habla. La frase se interpreta igual que si se escribiera.</p>',
      target: q('.m-fab'),
    },
    {
      title: 'Tipos y prioridades',
      body: '<p>Cada tipo tiene prioridad (1 = máxima), color, icono y trama. Se editan en <b>Más &gt; Tipos y prioridades</b>.</p>',
      target: q('.ag-body'),
    },
    {
      title: 'Varios días a la vez',
      body: '<p>Pulsación larga en un día del mes y toques en otros: añadir una tarea a todos, copiar, mover, marcar descanso o borrar.</p><p>Las <b>semanas tipo</b> (en Más) guardan una semana para aplicarla a otras.</p>',
      target: q('.ag-body'),
      before: () => { if (ag().view !== 'month') ag().setView('month'); },
      task: { text: 'Mantén pulsado un día del mes y toca otro.', check: () => ag().selection.size >= 2, done: 'Abajo tienes las acciones para todos los días elegidos.' },
    },
    {
      title: 'El temario',
      body: '<p><b>Más &gt; Temario</b>: temas a mano, pegando una lista o desde el índice de un documento, con sus apuntes en PDF o Word.</p>',
      target: moreRow('Temario'),
      before: async () => { ag().select([], 'replace'); await shell().go('more'); },
      task: { text: 'Abre <b>Temario</b>, pega unos temas con <b>Añadir temas › Pegar una lista de temas…</b> y guarda con <b>Guardar y planificar</b>.', check: () => ag().state.topics.length > 0, done: 'Temario guardado: el plan ya se ha calculado.' },
    },
    {
      title: 'Estudio y repasos, intercalados',
      body: '<p>El plan reparte estudio y repasos en el tiempo disponible; los repasos se espacian según lo que se recuerda cada tema.</p><p><b>Más &gt; Plan de estudio</b>: fecha objetivo y tiempo por día.</p>',
      target: moreRow('Plan de estudio'),
      before: async () => { await shell().go('more'); },
    },
    {
      title: 'Marcar como hecha',
      body: '<p>La casilla marca la tarea como hecha. Con tema, se anota el tiempo y cuánto se recordaba (<b>Otra vez</b>, <b>Difícil</b>, <b>Bien</b>, <b>Fácil</b>); de ahí sale el siguiente repaso.</p>',
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
      body: '<p><b>Más &gt; Progreso</b>: horas por semana, racha, temas estudiados, temas más flojos y notas.</p>',
      target: moreRow('Progreso'),
      before: async () => { await shell().go('more'); },
    },
    {
      title: 'Ya sabes organizarte',
      body: '<p>Se borra la agenda de prueba. El tutorial se repite desde <b>Más &gt; Tutorial de la agenda</b>.</p>',
    },
  ];
}
