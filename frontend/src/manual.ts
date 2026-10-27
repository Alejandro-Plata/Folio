// «Manual de Folio»: la primera nota del espacio de trabajo. Explica todas las
// funciones; empieza con un cuadro resumen cuyos enlaces llevan a cada sección.
// Los enlaces se generan con headingSlug a partir del propio título, así que no
// pueden desincronizarse. Al cambiar el contenido, sube MANUAL_VERSION: las
// instalaciones existentes lo actualizan al arrancar (guardando antes una versión).
import type { JSONContent } from '@tiptap/core';
import { headingSlug } from './editor/anchors';

export const MANUAL_TITLE = 'Manual de Folio';
export const MANUAL_VERSION = 1;

type Inline = JSONContent | string;
const t = (text: string, marks?: string[]): JSONContent => ({ type: 'text', text, ...(marks ? { marks: marks.map((m) => ({ type: m })) } : {}) });
const b = (text: string) => t(text, ['bold']);
const k = (text: string) => t(text, ['code']);
const link = (text: string, href: string): JSONContent => ({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] });
const p = (...c: Inline[]): JSONContent => ({ type: 'paragraph', content: c.length ? c.map((x) => (typeof x === 'string' ? t(x) : x)) : undefined });
const hd = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const ul = (...items: Inline[][]): JSONContent => ({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [p(...i)] })) });
const note = (kind: string, ...c: Inline[]): JSONContent => ({ type: 'callout', attrs: { kind }, content: [p(...c)] });
const cell = (c: Inline[], header = false, width?: number): JSONContent =>
  ({ type: header ? 'tableHeader' : 'tableCell', attrs: { colspan: 1, rowspan: 1, ...(width ? { colwidth: [width] } : {}) }, content: [p(...c)] });
const table = (rows: Inline[][][], widths: number[]): JSONContent => ({
  type: 'table',
  content: rows.map((r, i) => ({ type: 'tableRow', content: r.map((c, j) => cell(c, i === 0, widths[j])) })),
});
/** Enlace a una sección del manual por su título. */
const to = (title: string, text = title) => link(text, `#${headingSlug(title)}`);

interface Section { title: string; summary: string; body: JSONContent[] }

const SECTIONS: Section[] = [
  {
    title: 'La interfaz',
    summary: 'Panel lateral, cinta, barra de estado y los dos espacios: Documentos y Agenda.',
    body: [
      p('La ventana se divide en el panel lateral (izquierda), la cinta de opciones (arriba), el documento o la agenda (centro) y la barra de estado (abajo).'),
      ul(
        [b('Panel lateral: '), 'cambia entre Documentos y Agenda (Ctrl+Mayús+1 y Ctrl+Mayús+2), da acceso a Nuevo documento, Buscar, Plantillas e Importar, y muestra el árbol de documentos. Al pie están la Papelera y los Ajustes. Ctrl+\\ lo muestra u oculta; su borde derecho se arrastra para cambiar el ancho.'],
        [b('Barra superior: '), 'mostrar el panel, guardar, deshacer y rehacer; en el centro, la ruta del documento; a la derecha, Buscar (Alt+Q), comentarios, historial, ayuda (?) y Exportar.'],
        [b('Cinta: '), 'pestañas Archivo, Inicio, Insertar, Disposición, Referencias, Revisar y Vista, con los grupos rotulados como en Word. Las pestañas Tabla e Imagen aparecen al trabajar con una tabla o una imagen. Ctrl+F1 o doble clic en una pestaña la pliega.'],
        [b('Barra de estado: '), 'página actual y total, palabras y tiempo de lectura, estado del guardado y de la sincronización, mapa de atajos, vista (hojas o lectura) y zoom.'],
      ),
      p('En ventanas estrechas la cinta se compacta y el panel lateral flota sobre el documento. En el móvil, la interfaz cambia: véase ', to('Folio en el móvil'), '.'),
    ],
  },
  {
    title: 'Documentos y carpetas',
    summary: 'Crear, anidar, ordenar, marcar favoritos, cambiar el icono y recuperar de la papelera.',
    body: [
      ul(
        [b('Nuevo: '), 'Nuevo documento (Ctrl+U) crea uno en blanco; Archivo > Nuevo ofrece además las plantillas.'],
        [b('Anidar y ordenar: '), 'un documento se arrastra sobre otro para meterlo dentro, o entre dos para cambiar el orden. El «+» de cada fila crea una subpágina.'],
        [b('Menú de cada documento '), '(clic derecho o «⋯»): abrir, añadir subpágina, favorito, cambiar icono, renombrar, duplicar, mover a la raíz y mover a la papelera.'],
        [b('Favoritos: '), 'aparecen en su propia sección encima del árbol.'],
        [b('Papelera: '), 'conserva lo borrado con sus subpáginas e historial. Desde ella se restaura, se elimina definitivamente o se vacía.'],
      ),
      p('Cada documento se guarda como una carpeta dentro del espacio de trabajo (Ajustes > Almacenamiento), con su contenido, sus imágenes y su historial. La carpeta puede vivir dentro de Drive, OneDrive o Nextcloud.'),
    ],
  },
  {
    title: 'Plantillas',
    summary: 'Documentos de partida con estructura y formato ya hechos.',
    body: [
      p('Archivo > Nuevo (o Plantillas en el panel) muestra las plantillas: apuntes de clase, apuntes Cornell, examen, ficha de ejercicios, rúbrica, situación de aprendizaje y acta de reunión. Cada una crea un documento nuevo, editable como cualquier otro.'),
    ],
  },
  {
    title: 'Escribir y dar formato',
    summary: 'Fuentes, tamaños, color, resaltado, alineación, sangrías, interlineado y listas.',
    body: [
      hd(3, 'Texto'),
      ul(
        ['Negrita (Ctrl+N), cursiva (Ctrl+K), subrayado (Ctrl+S), tachado (Ctrl+Mayús+X), subíndice (Ctrl+=) y superíndice (Ctrl++).'],
        ['Fuente (Ctrl+M) y tamaño (Ctrl+Mayús+P). Ctrl+> y Ctrl+< suben y bajan el tamaño.'],
        ['Color del texto y resaltado (Ctrl+Alt+R), con la paleta del grupo Fuente.'],
        ['Mayús+F3 alterna mayúsculas y minúsculas; Ctrl+Espacio quita el formato de carácter.'],
        ['Copiar formato (Ctrl+Mayús+C) y pegar formato (Ctrl+Mayús+V), o el pincel de Inicio.'],
      ),
      hd(3, 'Fuentes'),
      p('El selector muestra cada fuente con su propia letra, agrupadas en sin serifa, con serifa, lectura fácil, manuscrita y monoespaciada. Veinte de ellas vienen con Folio y se incrustan en el PDF y el HTML, así que se ven igual en cualquier equipo. La fuente base del documento se elige en Disposición.'),
      hd(3, 'Párrafo'),
      ul(
        ['Alineación: izquierda (Ctrl+Q), centro (Ctrl+T), derecha (Ctrl+D) y justificada (Ctrl+J).'],
        ['Interlineado: sencillo (Ctrl+1), 1,5 (Ctrl+5) y doble (Ctrl+2).'],
        ['Sangría: Alt+Mayús+→ y Alt+Mayús+←. Mover un párrafo: Alt+Mayús+↑ y Alt+Mayús+↓.'],
        ['Listas con viñetas (Ctrl+Mayús+L), numeradas (Ctrl+Mayús+O, con varios niveles) y de tareas con casilla.'],
        ['Marcas de formato ¶ (Ctrl+Mayús+8) muestra párrafos y saltos de línea.'],
      ),
      hd(3, 'Estilos'),
      p('Normal (Ctrl+Mayús+N), Título 1 a 3 (Ctrl+Alt+1, 2, 3), Título 4, Cita y Código, en la galería de Inicio. Los títulos estructuran el documento: alimentan el índice y el panel Esquema, y se conservan como títulos en Word.'),
      p('También funcionan los atajos de Markdown al principio de una línea: ', k('#'), ' título, ', k('-'), ' viñeta, ', k('1.'), ' lista numerada, ', k('[ ]'), ' tarea, ', k('>'), ' cita, ', k('```'), ' código y ', k('---'), ' separador.'),
    ],
  },
  {
    title: 'Bloques y menú «/»',
    summary: 'Insertar cuadros, plegables, citas, código, separadores y más desde el teclado.',
    body: [
      p('En una línea vacía, ', k('/'), ' abre el menú de bloques; lo que se escribe después filtra la lista (', k('/tabla'), ', ', k('/def'), '). Intro inserta el bloque elegido. Los mismos bloques están en la pestaña Insertar.'),
      ul(
        [b('Cuadros destacados: '), 'definición, ejemplo, importante, consejo, atención, información y ejercicio, cada uno con su color e icono.'],
        [b('Plegable: '), 'bloque con título que se abre y se cierra.'],
        [b('Cita, código, separador, fecha y hora '), '(Alt+Mayús+D y Alt+Mayús+T).'],
        [b('Salto de página: '), 'Ctrl+Intro.'],
      ),
      p('Al pasar el ratón por un bloque aparece a su izquierda un asa: se arrastra para moverlo y con un clic abre su menú (convertir, duplicar, mover o eliminar). En el móvil, con una pulsación larga.'),
    ],
  },
  {
    title: 'Tablas',
    summary: 'Filas, columnas, celdas combinadas, encabezado repetido y color de celda.',
    body: [
      p('Insertar > Tabla dibuja una cuadrícula para elegir el tamaño. Con el cursor en una tabla aparece la pestaña Tabla: añadir o quitar filas y columnas, combinar y dividir celdas, fila de encabezado (se repite en cada página al imprimir), color de celda y borrar la tabla.'),
      p('El ancho de cada columna se cambia arrastrando su borde derecho. Tabulador pasa a la celda siguiente y, en la última, añade una fila. En el móvil, las tablas se ajustan al ancho de la pantalla sin cambiar sus medidas guardadas.'),
    ],
  },
  {
    title: 'Imágenes',
    summary: 'Pegar, arrastrar o insertar imágenes; tamaño, alineación y texto alternativo.',
    body: [
      p('Las imágenes se pegan (Ctrl+V), se arrastran a la ventana o se insertan desde Insertar > Imagen. Al seleccionar una aparece la pestaña Imagen: alineación, tamaño (25 %, 50 %, ancho de página u original) y texto alternativo. La esquina inferior derecha se arrastra para redimensionarla. Ninguna imagen supera el alto de una página.'),
    ],
  },
  {
    title: 'Ecuaciones',
    summary: 'Fórmulas en LaTeX, en línea o en bloque, con vista previa.',
    body: [
      p('Alt+= inserta una ecuación en el texto; también se crea escribiendo ', k('$x^2$'), '. Para una ecuación centrada en su propia línea: Insertar > Ecuación, o ', k('$$'), ' en una línea vacía. Un clic sobre la ecuación la edita, con vista previa y botones de símbolos.'),
      p('En Word se exportan como texto Unicode legible (x², √, α…), no como objetos de ecuación de Office.'),
    ],
  },
  {
    title: 'Notas al pie, comentarios, vínculos e índice',
    summary: 'Referencias dentro del documento y enlaces entre sus secciones.',
    body: [
      ul(
        [b('Notas al pie '), '(Ctrl+Alt+F): se numeran solas y se listan al final del documento.'],
        [b('Comentarios '), '(Ctrl+Alt+M): sobre el texto seleccionado. Se consultan y se resuelven en el panel Comentarios. No se imprimen; en Word se exportan como comentarios de revisión.'],
        [b('Vínculos '), '(Ctrl+Alt+K): una dirección web se abre con Ctrl+clic. Una dirección que empieza por ', k('#'), ' lleva a un título del propio documento: ', k('#tablas'), ' apunta al título «Tablas» (minúsculas, sin tildes y con guiones). Estos vínculos funcionan con un clic y se conservan en el PDF, el HTML y Word. El cuadro resumen de este manual usa vínculos así.'],
        [b('Índice: '), 'Referencias > Índice inserta una tabla de contenidos con los títulos 1 a 3, que se actualiza sola.'],
        [b('Esquema: '), 'panel con los títulos del documento para saltar entre ellos. Ctrl+I busca un título por su nombre.'],
      ),
    ],
  },
  {
    title: 'Herramientas para clase',
    summary: 'Soluciones plegables, líneas de respuesta, preguntas y versión del alumnado.',
    body: [
      ul(
        [b('Solución: '), 'bloque plegable con la respuesta de un ejercicio.'],
        [b('Líneas: '), 'renglones para responder a mano; el número de líneas se ajusta.'],
        [b('Pregunta: '), 'enunciado numerado con su puntuación, líneas y solución.'],
      ),
      p('Vista > Vista del alumnado muestra el documento sin soluciones y con la paginación que tendrá así el PDF. Al exportar o imprimir, la opción «Versión del alumnado» genera esa misma versión; en Ajustes se puede dejar marcada por defecto.'),
    ],
  },
  {
    title: 'Página, hojas e impresión',
    summary: 'Papel, márgenes, encabezado y pie, vistas, zoom e impresión.',
    body: [
      p('Disposición reúne márgenes (con valores habituales o personalizados), orientación, tamaño de papel (A4, A5, Carta y Oficio), encabezado y pie, numeración «Página X de Y» y la fuente, el tamaño y el interlineado base del documento. Encabezado y pie admiten ', k('{titulo}'), ', ', k('{fecha}'), ' y ', k('{autor}'), '.'),
      ul(
        [b('Diseño de impresión: '), 'el documento en hojas. Cada hoja contiene exactamente lo mismo que la página del PDF o de la impresión.'],
        [b('Lectura: '), 'el documento en continuo, a todo el ancho.'],
        [b('Zoom: '), 'Ctrl+Alt+= y Ctrl+Alt+-, Ctrl+rueda o la barra de estado. Ctrl+Alt+0 ajusta la hoja al ancho de la ventana.'],
        [b('Modo concentración '), '(Ctrl+Mayús+F11): oculta todo menos el documento.'],
        [b('Imprimir '), '(Ctrl+P): vista previa con las mismas opciones que la exportación.'],
      ),
      p('Los valores de página de los documentos nuevos se fijan en Ajustes > Documentos nuevos.'),
    ],
  },
  {
    title: 'Buscar y reemplazar',
    summary: 'Buscar en el documento, en todos los documentos y entre las acciones.',
    body: [
      ul(
        [b('En el documento: '), 'Ctrl+B busca y Ctrl+L reemplaza, con opciones de mayúsculas y palabras completas.'],
        [b('En todos los documentos: '), 'Ctrl+A (o Buscar en el panel) busca títulos y texto, sin distinguir tildes.'],
        [b('Acciones: '), 'Alt+Q abre la búsqueda de acciones: escribir «interlineado», «tabla» o «exportar» lleva directamente a la función.'],
      ),
    ],
  },
  {
    title: 'Guardado y versiones',
    summary: 'Guardado automático, puntos de restauración, comparar y restaurar.',
    body: [
      p('Folio guarda mientras se escribe. Además conserva versiones de cada documento:'),
      ul(
        [b('Automáticas: '), 'cada pocos minutos de edición (configurable en Ajustes) y al cerrar.'],
        [b('Puntos de restauración: '), 'Ctrl+G.'],
        [b('Versiones con nombre: '), 'F12. Nunca se borran.'],
      ),
      p('El historial (Ctrl+Alt+H) permite ver cualquier versión, compararla palabra a palabra con la actual, restaurarla o copiarla como documento nuevo. Restaurar guarda antes el estado actual. Las versiones automáticas antiguas se aclaran solas: todas las de las últimas 24 horas, una por hora durante una semana y una por día después.'),
    ],
  },
  {
    title: 'Exportar e importar',
    summary: 'Word, PDF, página web y Markdown; importar .docx, .md, .html y .txt; unir PDF.',
    body: [
      p('Exportar (botón de la barra superior o Archivo > Exportar) genera:'),
      ul(
        [b('Word (.docx): '), 'con estilos de título, listas reales, tablas, imágenes, notas al pie, comentarios, índice, encabezado, pie y numeración.'],
        [b('PDF: '), 'idéntico a las hojas del editor, con las fuentes incrustadas.'],
        [b('Página web (.html): '), 'un único archivo con las imágenes incluidas.'],
        [b('Markdown (.md): '), 'para otras aplicaciones de notas.'],
      ),
      p('Las opciones permiten quitar el título y generar la versión del alumnado. Archivo > Importar (o Importar en el panel) abre .docx, .md, .html y .txt como documentos nuevos.'),
      p(b('Unir PDF '), '(Archivo > Unir PDF, o soltando varios PDF en la ventana): ordenar los archivos, elegir rangos de páginas («1-3, 7»), añadir el documento abierto y crear un marcador por archivo.'),
    ],
  },
  {
    title: 'La agenda',
    summary: 'Calendario por días, semanas, meses y años, con navegación por teclado.',
    body: [
      p('Agenda (Ctrl+Mayús+2) muestra las vistas Día, Semana, Mes y Año (en el móvil, también Lista y 3 días). El panel lateral tiene un minicalendario, las próximas tareas, los accesos a Temario, Plan y Progreso, y los tipos de tarea.'),
      ul(
        ['Hoy (H), anterior y siguiente (← →), vistas D, S, M y A.'],
        ['Ir a (G) entiende «15 marzo», «semana 12» o «+3 semanas».'],
        ['Las tareas se arrastran para cambiar de día u hora; su borde inferior, para cambiar la duración.'],
        ['La vista Año colorea cada día según el tiempo de estudio.'],
      ),
    ],
  },
  {
    title: 'Crear tareas',
    summary: 'Barra rápida en lenguaje natural, dictado, editor completo, repeticiones y tipos.',
    body: [
      hd(3, 'Barra rápida'),
      p('La tarea se escribe como se diría y, antes de crearla, se muestra lo que se ha entendido. Intro la crea; Mayús+Intro abre el editor completo. Ejemplos:'),
      ul([k('mañana de 9 a 11 estudio')], [k('reunión cada 2 semanas los jueves a las 17')], [k('de lunes a viernes de 9 a 11 estudio tema 4 hasta el 20 de diciembre')], [k('dentista el 3 de noviembre a las 10')]),
      p('Se pueden escribir varias tareas en una frase («a las 9 tema 3 y luego a las 12 repaso del tema 1») y la prioridad con «prioridad alta» o ', k('!1'), '.'),
      hd(3, 'Dictado'),
      p('El micrófono de la barra (o mantener Ctrl+Mayús+Espacio) dicta la tarea; la frase se interpreta igual que si se escribiera. En el ordenador funciona sin conexión con un modelo de voz que se descarga una vez; en Android usa el reconocimiento de voz del sistema, manteniendo pulsado el botón +.'),
      hd(3, 'Editor de tarea'),
      p('Un clic en una tarea, un clic o un arrastre sobre un hueco de la rejilla (que marca la hora y la duración) o un doble clic en un día del mes abren el editor: título, tipo, fecha, hora, duración, repetición (diaria, semanal con días concretos, mensual, con fin), tema, notas, documento enlazado y, con círculos, quién la ve.'),
      hd(3, 'Tipos y prioridades'),
      p('Cada tipo tiene color, icono, trama y prioridad (1 = máxima): decide qué se coloca primero cuando no cabe todo. En el panel lateral, un clic oculta o muestra un tipo y el lápiz abre su editor.'),
    ],
  },
  {
    title: 'Varios días y semanas tipo',
    summary: 'Seleccionar días para copiar, mover, marcar descanso o borrar; reutilizar semanas.',
    body: [
      p('Arrastrando sobre el mes (o con Mayús+clic) se seleccionan varios días. La barra inferior permite añadir la misma tarea a todos, copiar (Ctrl+C) y pegar (Ctrl+V) en otro sitio, mover, marcar descanso (el plan no pondrá estudio) o borrar sus tareas. En el móvil, con una pulsación larga sobre el primer día.'),
      p('Semana tipo guarda la semana visible y la aplica a una o varias semanas. Los cambios de la agenda se deshacen con Ctrl+Z.'),
    ],
  },
  {
    title: 'Temario, plan y repasos',
    summary: 'Temas con apuntes, plan automático y repetición espaciada.',
    body: [
      hd(3, 'Temario'),
      p('Los temas se escriben a mano, se pegan como lista (un tema por línea) o se sacan del índice de un documento. A cada tema se le adjuntan sus apuntes (PDF, Word u otros); Añadir apuntes… asigna varios archivos a la vez según el número de su nombre («Tema 3.pdf»). También se puede enlazar un documento de Folio.'),
      hd(3, 'Plan de estudio'),
      p('Plan fija la fecha objetivo, el tiempo de estudio por día (horas, franja horaria o ambas), los días de descanso y la fase final de solo repaso. Planificar reparte el estudio nuevo y los repasos en ese tiempo, respetando las tareas fijas, y avisa si el temario no cabe.'),
      hd(3, 'Repasos'),
      p('Al marcar como hecha una tarea con tema se anota el tiempo real y cuánto se recordaba (Otra vez, Difícil, Bien, Fácil). Con eso se calcula el siguiente repaso (repetición espaciada FSRS) y el plan se ajusta. Bajo cada tarea con tema, un desplegable muestra el historial, el recuerdo estimado para ese día, el próximo repaso y los apuntes.'),
    ],
  },
  {
    title: 'Progreso',
    summary: 'Horas, racha, cobertura del temario, temas flojos y previsión.',
    body: [
      p('Progreso muestra las horas por semana frente al objetivo, la racha de días, cuántos temas se han estudiado y repasado, los temas más flojos, las notas registradas y la fecha prevista para terminar el temario. Los datos se exportan a CSV.'),
    ],
  },
  {
    title: 'Cuenta, círculos y citas',
    summary: 'Compartir eventos con otras personas y proponer citas.',
    body: [
      p('La cuenta (Archivo > Tu cuenta y círculos) se crea con Google o con correo y contraseña. Solo sirve para los círculos: los documentos y la agenda privada siguen en los dispositivos.'),
      ul(
        [b('Círculos: '), 'grupos (varias personas) o pareja (dos). Al crear un evento se elige quién lo ve. Los eventos del círculo los ven todos sus miembros y el plan los respeta como tiempo ocupado. Se entra con un código de invitación.'],
        [b('Citas '), '(círculos de pareja): se proponen varios días y la otra persona elige uno; queda en la agenda de los dos.'],
      ),
    ],
  },
  {
    title: 'Sincronización',
    summary: 'Los mismos documentos y la misma agenda en todos los dispositivos.',
    body: [
      p('Ajustes > Cuenta y nube (o Más > Sincronización en el móvil) vincula Nextcloud u otro servidor WebDAV, o Google Drive. Documentos y agenda se fusionan entre dispositivos; si dos editan lo mismo, se conserva la versión más reciente y la otra queda en el historial. Las credenciales se guardan en el almacén seguro del sistema. En el móvil, un código QR copia la configuración desde otro dispositivo.'),
    ],
  },
  {
    title: 'Folio en el móvil',
    summary: 'Navegación inferior, barra de formato y avisos de tareas.',
    body: [
      ul(
        [b('Secciones: '), 'Documentos, Agenda, Buscar y Más (plantillas, importar, unir PDF, temario, plan, progreso, tipos, papelera, ajustes y tutoriales).'],
        [b('Escribir: '), 'al editar aparece una barra de formato sobre el teclado; Aa abre estilos, fuente, color y párrafo, y + inserta bloques.'],
        [b('Agenda: '), 'deslizar a los lados cambia de periodo y tocar el título salta a cualquier día. El botón + abre la barra rápida; mantenerlo pulsado dicta.'],
        [b('Avisos: '), 'Plan de estudio > «Avisarme antes de cada tarea».'],
      ),
    ],
  },
  {
    title: 'Ajustes',
    summary: 'Apariencia, escritura, exportación, página, versiones, cuenta y ayuda.',
    body: [
      p('Ajustes (al pie del panel lateral o en Archivo) reúne en una página: tema claro u oscuro, vista de los documentos, cinta, marcas de formato, mapa de atajos (Word en español o en inglés), revisión ortográfica, comillas tipográficas, formato y opciones de exportación por defecto, página de los documentos nuevos, intervalo de las versiones automáticas, carpeta del espacio de trabajo, cuenta, nube y ayuda. Los cambios se aplican al momento.'),
    ],
  },
  {
    title: 'Actualizaciones',
    summary: 'Aviso al abrir cuando hay una versión nueva, con sus cambios.',
    body: [
      p('Al abrir Folio, si hay una versión nueva aparece un aviso con tres opciones: instalarla, ver sus cambios o dejarlo para más tarde. También se comprueba en Archivo > Buscar actualizaciones. Cada actualización se verifica con una firma antes de instalarse; los documentos y la agenda no se tocan.'),
    ],
  },
  {
    title: 'Atajos de teclado',
    summary: 'Los atajos principales; F1 muestra la lista completa.',
    body: [
      p('Folio usa los atajos de Word. Hay dos mapas, Word en español (el de esta tabla) y Word en inglés, elegibles en Ajustes o en la barra de estado. F1 muestra la lista completa del mapa activo.'),
      table([
        [['Acción'], ['Atajo']],
        [['Nuevo · Abrir · Guardar'], ['Ctrl+U · Ctrl+A · Ctrl+G']],
        [['Negrita · Cursiva · Subrayado'], ['Ctrl+N · Ctrl+K · Ctrl+S']],
        [['Buscar · Reemplazar · Seleccionar todo'], ['Ctrl+B · Ctrl+L · Ctrl+E']],
        [['Izquierda · Centro · Derecha · Justificar'], ['Ctrl+Q · Ctrl+T · Ctrl+D · Ctrl+J']],
        [['Título 1 · 2 · 3 · Normal'], ['Ctrl+Alt+1 · 2 · 3 · Ctrl+Mayús+N']],
        [['Viñetas · Numeración'], ['Ctrl+Mayús+L · Ctrl+Mayús+O']],
        [['Vínculo · Nota al pie · Comentario'], ['Ctrl+Alt+K · Ctrl+Alt+F · Ctrl+Alt+M']],
        [['Ecuación · Salto de página'], ['Alt+= · Ctrl+Intro']],
        [['Versión con nombre · Historial'], ['F12 · Ctrl+Alt+H']],
        [['Imprimir · Exportar a Word'], ['Ctrl+P · Ctrl+Mayús+E']],
        [['Documentos · Agenda'], ['Ctrl+Mayús+1 · Ctrl+Mayús+2']],
        [['Buscar acciones · Lista de atajos'], ['Alt+Q · F1']],
      ], [330, 270]),
      p('AltGr nunca se interpreta como Ctrl+Alt, así que @, # o € se escriben con normalidad en teclados españoles.'),
    ],
  },
];

/** Contenido del manual: cuadro resumen enlazado y una sección por función. */
export function MANUAL(): JSONContent {
  const summary = table([
    [['Función'], ['Para qué sirve']],
    ...SECTIONS.map((s): Inline[][] => [[to(s.title)], [s.summary]]),
  ], [210, 390]);
  return {
    type: 'doc',
    content: [
      p('Guía de todas las funciones de Folio. Cada fila del cuadro lleva a su explicación; los títulos también aparecen en el panel Esquema.'),
      summary,
      note('tip', 'El tutorial guiado (botón ? de la barra superior, o Más > Tutorial de documentos en el móvil) recorre lo esencial con prácticas.'),
      ...SECTIONS.flatMap((s) => [hd(2, s.title), ...s.body]),
    ],
  };
}
