# Agenda de estudio en Folio — guía de implementación

Plan paso a paso para añadir a Folio una **agenda** (día, semana, mes y año) con
tareas por prioridad, dictado por voz, seguimiento del estudio de oposiciones y
**repetición espaciada** que intercala repasos con estudio nuevo, todo
explicado en un tutorial interactivo. Incluye también una herramienta sencilla
para **unir PDF**.

Cada fase termina en algo usable y comprobable. No se empieza la siguiente sin
cumplir los criterios de aceptación de la anterior.

## Estado (26-10-2026)

Implementado: fase 0 (asa de bloque), unir PDF, fases 1, 2, 3, 5, 6 y 7, y el
dictado 4b (código en Go y en la interfaz, modelo `small` descargado). Pendiente:
- incluir `whisper-cli` en las compilaciones (en Linux hace falta `gcc-c++` y
  `cmake`; para Windows, el binario oficial de whisper.cpp);
- fase 8 (avisos de escritorio, copias de seguridad y exportar a `.ics`).

La versión para Android y la sincronización están en `docs/guia-android.md`.

---

## 0. Decisiones de base

| Tema | Decisión | Motivo |
|---|---|---|
| Dónde vive | Un segundo espacio, **Agenda**, junto a Documentos (conmutador arriba del panel lateral, `Ctrl+1` / `Ctrl+2`). | No mezcla la cinta de Word con la del calendario; cada espacio tiene su propia cinta. |
| Datos | Archivos JSON en `‹espacio de trabajo›/agenda/`, con las mismas escrituras atómicas de `internal/store`. | Igual que los documentos: se pueden sincronizar con Drive/OneDrive y no hace falta ninguna base de datos. |
| Lógica | El **planificador** y la repetición espaciada, en Go (`internal/agenda`), con tests. Las vistas, en TypeScript. | Es la parte delicada: tiene que dar el mismo resultado siempre y poder probarse sin interfaz. |
| Sin conexión | Todo funciona sin Internet, también el dictado (fase 4). | Privacidad, y que funcione en cualquier aula. |
| Integración con documentos | Cada **tema** del temario puede enlazar a su documento de apuntes en Folio. | Desde un bloque del calendario se abren los apuntes con un clic. |
| Dictado | **whisper.cpp** integrado, sin conexión, en Windows y Linux. La app descarga el modelo la primera vez que se usa. | Decidido. Ver fase 4. |
| Temario | Se introduce a mano **o** se importa de un documento (de Folio, .docx o texto pegado). | Decidido. Ver 6.0. |
| Opciones del calendario | Todo es elegible por la persona. Junto a cada opción hay **sugerencias** basadas en sus últimas acciones. | Decidido. Ver 4.1. |
| Horas | Siempre con hora y minuto, con atajo de solo hora («9» → 9:00). | Decidido. Ver 4.1. |

### Vocabulario

- **Tarea**: algo que se hace en un momento (con hora) o en un día (sin hora).
- **Tipo**: lo define la prioridad (ver 2.2). Ejemplos: *Estudio nuevo*, *Repaso*, *Simulacro*, *Clase/Trabajo*, *Personal*.
- **Tema**: unidad del temario de la oposición (por ejemplo, «Tema 12. La Constitución»).
- **Sesión**: registro de lo que realmente se hizo (minutos, valoración, nota del test).
- **Plan**: tareas generadas por el planificador (marcadas `auto`); las manuales nunca las toca.

---

## 0.1 Antes de empezar: arreglar los bloques en Linux

En la versión de Linux (WebKitGTK) los bloques no funcionan bien. Se arregla
antes de la agenda, porque la agenda reutiliza el mismo editor para las notas
de las tareas y los temas.

1. Reproducir cada bloque en la app de Linux: menú «/», cuadros, plegables y
   soluciones (el título es un `<input>` dentro del editor), líneas de
   respuesta, ecuaciones, tablas e imágenes.
2. Corregir las vistas de nodo afectadas (`editor/extensions.ts`): `stopEvent` e
   `ignoreMutation` para los campos internos, y foco y selección al entrar y
   salir con el teclado.
3. Añadir una prueba manual guiada (lista de comprobación) para Linux y Windows
   y repetirla en cada versión.

---

## 1. Principios de diseño (comprobar en cada fase)

1. **Nada día a día.** Toda acción repetitiva debe poder hacerse una sola vez sobre varios días: recurrencias, selección de varios días, semanas tipo, «aplicar a…», lenguaje natural.
2. **Orientación inmediata.** Siempre se ve dónde se está: cabecera con el rango visible («Semana 44 · 26 oct – 1 nov 2026»), botón **Hoy**, línea de la hora actual y un minicalendario en el panel lateral.
3. **Accesible.** Todo se puede hacer con el teclado y se anuncia en lectores de pantalla. El color nunca es la única pista: cada tipo tiene además icono y trama. Contraste AA, y se respeta `prefers-reduced-motion`.
4. **Confirmar antes de crear.** Lo dictado o escrito en lenguaje natural se muestra como vista previa editable antes de guardarse.
5. **El planificador propone, la persona decide.** Lo generado se distingue visualmente (borde discontinuo) y se puede fijar, mover o descartar.

---

## 2. Modelo de datos (fase 1)

### 2.1 Tarea

```go
type Task struct {
    ID        string     `json:"id"`
    Title     string     `json:"title"`
    TypeID    string     `json:"typeId"`              // define prioridad, color, icono
    Date      string     `json:"date"`                // "2026-10-26" (día local, sin zona)
    Start     string     `json:"start,omitempty"`     // "09:30"; vacío = tarea de día completo
    Minutes   int        `json:"minutes,omitempty"`   // duración prevista
    Notes     string     `json:"notes,omitempty"`
    Repeat    *Repeat    `json:"repeat,omitempty"`    // solo en la tarea «madre»
    SeriesID  string     `json:"seriesId,omitempty"`  // ocurrencia editada de una serie
    TopicID   string     `json:"topicId,omitempty"`   // estudio o repaso de un tema
    Kind      string     `json:"kind,omitempty"`      // "", "study", "review", "mock"
    Auto      bool       `json:"auto,omitempty"`      // creada por el planificador
    Pinned    bool       `json:"pinned,omitempty"`    // el planificador no la mueve
    Done      bool       `json:"done"`
    DocID     string     `json:"docId,omitempty"`     // documento de Folio enlazado
    Updated   time.Time  `json:"updated"`
}

type Repeat struct {
    Freq     string   `json:"freq"`               // daily | weekly | monthly
    Interval int      `json:"interval"`           // cada N
    Weekdays []int    `json:"weekdays,omitempty"` // 1=lunes … 7=domingo
    Until    string   `json:"until,omitempty"`    // fecha final incluida
    Except   []string `json:"except,omitempty"`   // fechas eliminadas de la serie
}
```

- Fechas como texto `AAAA-MM-DD` y horas `HH:MM` en hora local: así se evitan los líos de zonas horarias y cambios de hora en una agenda personal.
- Las series se expanden al leer un rango (`ListRange(from, to)`), no se guardan copias. Editar «solo esta» crea una tarea con `SeriesID` y añade la fecha a `Except`.

### 2.2 Tipos y prioridades

```go
type TaskType struct {
    ID       string `json:"id"`
    Name     string `json:"name"`      // «Estudio nuevo»
    Priority int    `json:"priority"`  // 1 = máxima
    Color    string `json:"color"`
    Icon     string `json:"icon"`
    Pattern  string `json:"pattern"`   // solid | stripes | dots (accesibilidad)
    CountsAsStudy bool `json:"countsAsStudy"`
}
```

Tipos por defecto (editables en Ajustes de la agenda):

| Prioridad | Tipo | Uso |
|---|---|---|
| 1 | Simulacro / examen | Fijo, el planificador nunca lo mueve. |
| 2 | Repaso | Generado por la repetición espaciada. |
| 3 | Estudio nuevo | Temas que aún no se han visto. |
| 4 | Clase / trabajo | Compromisos externos (ocupan capacidad). |
| 5 | Personal | Descanso, deporte, recados. |

La prioridad decide: el orden dentro de un día, qué se recoloca primero cuando no cabe todo y el color/trama en las vistas.

### 2.3 Temario y repetición espaciada

```go
type Topic struct {
    ID        string  `json:"id"`
    Number    int     `json:"number"`        // orden en el temario
    Title     string  `json:"title"`
    Block     string  `json:"block,omitempty"` // bloque o parte del temario
    Weight    float64 `json:"weight"`        // dificultad o extensión (1 = normal)
    StudyMinutes int  `json:"studyMinutes"`  // estimación para estudiarlo la primera vez
    DocID     string  `json:"docId,omitempty"`
    // Estado de memoria (FSRS)
    State     string  `json:"state"`         // new | learning | review
    Stability float64 `json:"stability"`
    Difficulty float64 `json:"difficulty"`
    LastReview string `json:"lastReview,omitempty"`
    Due       string  `json:"due,omitempty"`
    Reps      int     `json:"reps"`
    Lapses    int     `json:"lapses"`
}
```

### 2.4 Sesiones (seguimiento)

```go
type Session struct {
    ID      string `json:"id"`
    TaskID  string `json:"taskId,omitempty"`
    TopicID string `json:"topicId,omitempty"`
    Date    string `json:"date"`
    Minutes int    `json:"minutes"`          // tiempo real
    Rating  int    `json:"rating,omitempty"` // 1 Otra vez · 2 Difícil · 3 Bien · 4 Fácil
    Score   *float64 `json:"score,omitempty"` // nota de test, 0-10
    Note    string `json:"note,omitempty"`
}
```

### 2.5 Ajustes del plan

```go
type PlanSettings struct {
    ExamDate      string         `json:"examDate"`
    Capacity      map[int]int    `json:"capacity"`      // minutos por día de la semana (1-7)
    RestDays      []int          `json:"restDays"`      // días sin estudio
    BlockMinutes  int            `json:"blockMinutes"`  // bloque típico (50)
    ReviewMinutes int            `json:"reviewMinutes"` // repaso típico (25)
    Retention     float64        `json:"retention"`     // objetivo FSRS (0.9)
    FinalPhaseDays int           `json:"finalPhaseDays"`// solo repasos y simulacros al final (21)
    StudyWindow   [2]string      `json:"studyWindow"`   // franja horaria («16:00», «21:00»)
}
```

### 2.6 Archivos en disco

```
agenda/
  types.json          tipos y prioridades
  settings.json       PlanSettings
  topics.json         temario con su estado de memoria
  tasks/2026-10.json  tareas de cada mes (las series, en el mes de inicio)
  sessions/2026-10.jsonl  una sesión por línea (solo se añade)
  backup/AAAA-MM-DD.zip   copia diaria, se guardan las últimas 14
```

Partir por meses mantiene los archivos pequeños y reduce los conflictos al sincronizar.

### Pasos de la fase 1

1. Crear `internal/agenda` con los tipos anteriores, `Open(root)`, lectura y escritura atómica (reutilizar `writeFileAtomic`: moverla a un paquete `internal/fsutil`).
2. Expansión de recurrencias: `Occurrences(task, from, to) []Task`.
3. API en `app.go` (Wails): `AgendaRange(from, to)`, `AgendaSave(task)`, `AgendaDelete(id, scope)` con `scope` = `one | following | all`, `AgendaMove(ids, deltaDays)`, `AgendaCopy(ids, toDates)`, `TopicsList/Save/Delete`, `SessionAdd`, `PlanSettingsGet/Set`.
4. Backend simulado equivalente en `frontend/src/api.ts` para desarrollar en el navegador.

**Criterios de aceptación:** tests de Go para series (cada 2 semanas en lunes y jueves hasta una fecha, con excepciones), meses de 28 a 31 días, años bisiestos y cambio de hora en marzo y octubre. Una sesión que se escribe a medias no corrompe el archivo.

---

## 3. Vistas y navegación (fase 2)

### 3.1 Estructura en el frontend

```
frontend/src/agenda/
  agenda.ts        controlador: rango visible, vista activa, selección
  store.ts         caché de tareas por mes + llamadas a la API
  views/day.ts     rejilla horaria de un día
  views/week.ts    rejilla horaria de 7 columnas (o 5, laborables)
  views/month.ts   cuadrícula de 6×7 con chips
  views/year.ts    12 minimeses con mapa de calor de carga o de estudio
  ribbon.ts        cinta de la agenda: Inicio · Insertar · Plan · Vista
  minical.ts       minicalendario del panel lateral
```

### 3.2 Comportamiento de cada vista

- **Día y semana**: rejilla de 15 min, franja visible configurable (por defecto 7:00-23:00). Las tareas sin hora van en una fila superior. Se arrastra para crear, se mueve y se cambia la duración con el ratón **y con el teclado** (`Alt+↑/↓` mueve 15 min, `Alt+Mayús+↑/↓` cambia la duración). Línea de la hora actual. Las tareas que se solapan se dividen en columnas.
- **Mes**: chips con icono del tipo y hora; «+3 más» abre el día. Muestra los minutos planificados frente a la capacidad.
- **Año**: 12 minimeses; cada día coloreado según las horas estudiadas (pasado) o planificadas (futuro), con leyenda. Un clic lleva a la semana; arrastrar selecciona un rango.

### 3.3 Navegación y orientación

| Acción | Teclado |
|---|---|
| Día / semana / mes / año | `D` `S` `M` `A` |
| Anterior / siguiente | `←` `→` (o `RePág` `AvPág`) |
| Hoy | `H` |
| Ir a una fecha («15 marzo», «semana 12», «+3 semanas») | `G` |
| Moverse por los días de la cuadrícula | flechas; `Intro` abre el día |
| Nueva tarea en el día o la hora enfocada | `N` |

- La cabecera siempre muestra el rango y, si hay fecha de examen, **«Faltan 142 días»**.
- La vista y la fecha se recuerdan entre sesiones.

### 3.4 Accesibilidad

- Mes y año: `role="grid"` con `aria-rowindex/colindex` y un solo elemento enfocable (roving tabindex). Cada celda se anuncia así: «martes 27 de octubre, 3 tareas, 2 h 30 planificadas».
- Día y semana: cada tarea es un botón con `aria-label` completo («Repaso, Tema 4, de 17:00 a 17:25, prioridad 2»).
- Región `aria-live="polite"` para confirmar acciones («Tarea movida al jueves»).
- Tramas y iconos por tipo, modo de alto contraste y tamaño de letra según el zoom de la app.

**Criterios de aceptación:** todo el recorrido (crear, mover, cambiar de vista, ir a una fecha) se puede hacer sin ratón. Se probó con NVDA en Windows y Orca en Linux. Pasar de mes a semana tarda menos de 100 ms con 2.000 tareas.

---

## 4. Crear y organizar sin tedio (fase 3)

### 4.1 Elegir horas, duraciones y opciones (con sugerencias)

Toda opción del calendario (hora de inicio, duración, tipo, días, capacidad de
estudio, franja) la elige la persona. El sistema solo **sugiere**.

**Selector de hora** (`agenda/timepicker.ts`), común a toda la agenda:

- Campo de hora y minuto. Se escribe como resulte más cómodo y se normaliza al salir:

  | Se escribe | Queda |
  |---|---|
  | `9` | 09:00 |
  | `17` | 17:00 |
  | `930` / `9.30` / `9:30` / `9h30` | 09:30 |
  | `9 y media`, `9 y cuarto`, `menos cuarto` (dictado) | 09:30, 09:15, … |
  | `+30` (en duración o en la hora de fin) | 30 minutos más |

- `↑/↓` suben o bajan **una hora**; `Mayús+↑/↓`, **5 minutos**; `Ctrl+↑/↓`, **15 minutos**.
- Lista desplegable con las horas en punto (atajo de solo hora) y, al abrirla,
  los minutos 00 · 15 · 30 · 45 de la hora elegida. Se pueden escribir otros minutos.
- La duración usa el mismo control: del `1` al `9` se leen como horas (`2` → 2 h) y
  del `10` en adelante como minutos (`45` → 45 min); `1h30` y `1:30` también valen.

**Sugerencias según las últimas acciones** (`agenda/suggest.ts`):

- Se calculan sobre las tareas y sesiones de las **últimas 4 semanas**, dando
  más peso a lo más reciente y al **mismo día de la semana**.
- Para cada campo se muestran como mucho **3 chips** encima del control. Por
  ejemplo, para la hora de inicio de un *Repaso* un martes: `17:00 · 16:30 · 9:00`.
  Para la duración: `25 min · 50 min · 1 h 30`.
- La capacidad de estudio por día también se sugiere a partir de lo realmente
  estudiado («Los martes sueles estudiar 2 h 40 min»).
- Se aplican con un clic o con `Alt+1/2/3`. Nunca se rellenan solas.
- Si aún no hay historial, se usan valores recomendados razonables (bloques de
  50 min, repasos de 25 min, tarde de 16:00 a 21:00).
- Se puede desactivar en Ajustes de la agenda.

**Tiempo de estudio:** la persona elige entre **horas por día de la semana**
(«lunes 3 h, martes 2 h 30»), **franjas fijas** («de 16:00 a 21:00») o una
mezcla (franja con un máximo de horas). En los tres casos se usa el selector
anterior y aparecen las sugerencias.

### 4.2 Más formas de crear sin tedio

1. **Barra rápida en lenguaje natural** (`Ctrl+Espacio` o el campo de la cabecera). Analizador en español, por reglas y sin conexión (`agenda/parse.ts`), con tests. Debe entender:
   - fechas: *hoy, mañana, pasado mañana, el lunes, el próximo martes, 3 de noviembre, dentro de 2 semanas*
   - horas y duraciones: *a las 5, de 9 a 11, 17:30, durante 2 horas, 45 min*
   - repeticiones: *todos los días, de lunes a viernes, cada martes y jueves, cada 2 semanas, hasta junio*
   - tipo o prioridad: *repaso, simulacro, prioridad alta, !1*
   - tema: *tema 12* (enlaza con el temario)

   Ejemplo: «de lunes a viernes de 9 a 11 estudio tema 4 hasta el 20 de diciembre». Resultado: una serie, que se enseña como tarjeta de vista previa editable antes de guardarse.
2. **Selección de varios días**: `Mayús+clic` o arrastrar en el mes o el año. La barra de acciones permite añadir la misma tarea a todos, mover, copiar, marcar como descanso o borrar.
3. **Semanas tipo**: guardar la semana actual como plantilla («Semana de estudio», «Semana con clases») y aplicarla a un rango de semanas de una vez.
4. **Copiar y pegar** días o semanas (`Ctrl+C` / `Ctrl+V` sobre la selección) y **mover en bloque** («retrasar todo 1 día»).
5. **Editar series**: al cambiar una ocurrencia se pregunta «solo esta / esta y las siguientes / todas».
6. **Deshacer** (`Ctrl+Z`) en todas las operaciones de la agenda, incluidas las de varios días.

**Criterios de aceptación:** organizar un trimestre de ejemplo (clases fijas, estudio de lunes a viernes y simulacros quincenales) lleva menos de 2 minutos y no hay que tocar ningún día a mano. El analizador pasa más de 150 frases de prueba.

---

## 5. Dictado por voz (fase 4)

### 5.1 Qué se puede usar

| Opción | Windows | Linux | Sin conexión | Comentario |
|---|---|---|---|---|
| Web Speech API (`SpeechRecognition`) | ✗ no funciona en WebView2 | ✗ no existe en WebKitGTK | — | Descartada. |
| Dictado de Windows (`Win+H`) | ✓ | ✗ | Depende de la versión de Windows | Escribe en cualquier campo, así que funciona ya con la barra rápida. Coste: cero. |
| **whisper.cpp** integrado en Go | ✓ | ✓ | ✓ | Buen español. Modelo `base` (~140 MB) o `small` (~460 MB), que se descarga la primera vez que se usa. |

**Decidido: whisper.cpp.** Modelos, descargados por la app desde el repositorio
oficial de whisper.cpp (Hugging Face) la primera vez que se usa el dictado:

| Modelo | Tamaño | Uso |
|---|---|---|
| `ggml-base.bin` | ~148 MB | Recomendado por defecto: rápido en cualquier portátil. |
| `ggml-small.bin` | ~488 MB | Más preciso. Opcional en Ajustes. |

- Se guarda en la carpeta de configuración del usuario (no en el espacio de
  trabajo, para no sincronizar cientos de MB con Drive).
- Se comprueba la suma SHA-256 y se puede pausar, reanudar y borrar.
- Antes de descargar se pide confirmación indicando el tamaño.

### 5.2 Pasos

1. **4a (inmediato):** un botón de micrófono en la barra rápida. En Windows enfoca el campo y explica que hay que pulsar `Win+H`; en Linux se desactiva con una explicación. El texto dictado pasa por el mismo analizador de la fase 3.
2. **4b (dictado propio):**
   - Grabar el micrófono con `getUserMedia` en el webview. En WebView2 hay que aceptar el permiso en el gestor de Wails. En WebKitGTK hay que activar `enable-media-stream`; si Wails no lo permite, grabar en Go con `malgo` (miniaudio).
   - Pasar el audio a 16 kHz mono y transcribirlo con whisper.cpp (cgo) en una gorrutina, con progreso por eventos.
   - Modo **«pulsar para hablar»** (mantener `Ctrl+Mayús+Espacio`), con indicador visual y sonoro.
   - Descarga del modelo con progreso, suma de comprobación y opción de borrarlo.
3. Dictado de varias tareas seguidas: «mañana a las 9 tema 3, y a las 12 repaso tema 1». El analizador separa por «y» o «luego» y muestra una lista de vistas previas.

**Criterios de aceptación:** con el modelo `base`, 10 frases de prueba se transcriben y analizan bien en al menos 9 casos, en menos de 3 s cada una en un portátil normal. Si no hay micrófono o se deniega el permiso, se explica cómo arreglarlo.

---

## 6. Temario y repetición espaciada (fase 5)

### 6.0 Introducir el temario

Dos caminos, con el mismo resultado (una lista de temas editable):

1. **A mano:** una tabla editable (número, título, bloque, peso y documento
   enlazado). Admite **pegar varias líneas** de golpe: cada línea es un tema.
   Se reordena arrastrando o con `Alt+↑/↓`.
2. **Importar de un documento:**
   - un documento de Folio, un `.docx` (con el importador que ya existe) o texto pegado;
   - se detectan los temas por **títulos** (Título 1 o 2), **listas numeradas**
     o líneas que empiezan por «Tema N»; los títulos de nivel superior pasan a ser **bloques**;
   - vista previa con lo detectado antes de aceptar, para corregir o descartar líneas;
   - opción de **crear un documento de apuntes por tema**, enlazado
     automáticamente, a partir de las secciones del documento importado.

Importar de nuevo no duplica: los temas se emparejan por número y título, y se
conserva su historial de repasos.

### 6.1 Algoritmo de memoria

Se usa **FSRS** (el algoritmo actual de Anki): estima la probabilidad de recordar cada tema y programa el repaso cuando cae por debajo de la retención objetivo (90 % por defecto). Hay implementación de referencia en Go (`go-fsrs`) y en TypeScript (`ts-fsrs`). Usar la de Go en el planificador.

Tras cada estudio o repaso se pide una valoración rápida: **Otra vez · Difícil · Bien · Fácil**. A modo de orientación, con «Bien» los intervalos quedan en unos 1 → 3 → 8 → 20 → 45 días.

### 6.2 Planificador (intercalar estudio y repaso)

Entrada: temario, ajustes del plan, tareas fijas (que ocupan capacidad) y sesiones hechas.
Salida: tareas `auto` desde hoy hasta la fecha del examen.

Para cada día desde hoy hasta el examen:

1. **Capacidad libre** = capacidad del día − tareas fijas que caen en la franja de estudio. Los días de descanso se saltan.
2. **Repasos primero.** Se colocan los temas cuyo `Due` es ese día o ya pasó, ordenados por menor probabilidad de recuerdo. Si no caben, los que sobran pasan al día siguiente.
3. **Suavizar picos.** Si un día supera el 120 % de la capacidad media, los repasos con margen se adelantan o retrasan ±1-2 días (FSRS lo tolera). Así se evitan días imposibles seguidos de días vacíos.
4. **Estudio nuevo** en el hueco que queda, por orden del temario y según el peso del tema. Si un tema no cabe en un bloque, se parte en varios días seguidos.
5. **Intercalar dentro del día:** alternar bloques de estudio y repaso (estudio → repaso → estudio), sin repetir el mismo tema dos veces en un día y con pausas de 10 min entre bloques.
6. **Fase final** (los últimos N días): sin estudio nuevo, solo repasos de todo el temario y simulacros.
7. **Comprobación de viabilidad.** Si con la capacidad actual el temario no se termina antes de la fase final, se avisa con números: «Te faltan 18 h; añade 40 min diarios o reduce temas»; y se proponen ajustes.

Replanificar al marcar sesiones, al cambiar ajustes y cada día al abrir la app. Solo se tocan tareas `auto` y no fijadas. Si un repaso se salta, el plan se rehace y no se acumula culpa.

**Criterios de aceptación:** tests del planificador con temarios de 25, 70 y 90 temas. Ningún día supera su capacidad, todo tema estudiado recibe al menos 3 repasos antes del examen y el resultado es el mismo para la misma entrada.

---

## 7. Seguimiento del progreso (fase 6)

1. **Marcar una tarea como hecha** abre una tarjeta mínima: minutos reales (con el tiempo previsto ya puesto), valoración y nota del test opcional. Un solo `Intro` acepta los valores por defecto.
2. **Cronómetro opcional** (Pomodoro 50/10 o 25/5) iniciado desde la tarea. Al terminar, rellena los minutos.
3. **Panel de progreso:**
   - horas por semana frente al objetivo (barras), con racha de días;
   - cobertura del temario: sin ver / estudiado / repasado N veces;
   - retención estimada por tema (FSRS) y los temas más flojos;
   - notas de simulacros a lo largo del tiempo;
   - previsión: «a este ritmo terminarás el temario el 14 de marzo».
4. **Vista año** como mapa de calor de horas estudiadas.
5. **Exportar** el progreso a CSV y la semana a PDF (con el motor de PDF que ya existe), y la agenda a `.ics` para verla en el móvil.

**Criterios de aceptación:** cada cifra del panel se puede comprobar con el CSV exportado y el panel carga en menos de 200 ms con 2 años de sesiones.

---

## 8. Unir PDF (herramienta independiente)

Pensada para juntar temas, exámenes o apuntes en un solo archivo, en pocos clics.

- **Dónde:** Archivo > **Unir PDF**, en «Dígame» y arrastrando varios PDF a la ventana.
- **Biblioteca:** [`pdfcpu`](https://github.com/pdfcpu/pdfcpu) (Go puro, licencia
  Apache-2.0): sin programas externos y funciona igual en Windows y Linux.
- **Diálogo:**
  1. añadir archivos (botón, arrastrar o `Ctrl+O`); también **documentos de
     Folio**, que se exportan a PDF al momento con el motor actual;
  2. lista con miniatura de la primera página, nombre y número de páginas;
  3. reordenar arrastrando o con `Alt+↑/↓`, y quitar con `Supr`;
  4. opcional: **rango de páginas** por archivo («1-3, 7»);
  5. opcional: añadir **marcadores** con el nombre de cada archivo y numerar las páginas;
  6. **Unir** → elegir dónde guardar, con la opción «Abrir al terminar».
- **API Go:** `PdfInfo(path) (pages int, err)`, `PdfThumb(path) (png []byte)` y
  `MergePdf(items []MergeItem, out string, opts MergeOptions)`.
- **Criterios de aceptación:** unir 20 PDF de 30 páginas tarda menos de 5 s; los
  PDF protegidos con contraseña se avisan uno a uno sin romper la unión; los
  PDF dañados se señalan antes de unir.
- **Tutorial:** un paso propio en el tutorial general de Folio.

---

## 9. Tutorial interactivo (fase 7)

Reutilizar el motor de `ui/tour.ts` (resaltado + tareas que se comprueban solas), con un recorrido propio para la agenda:

1. Cambiar entre Documentos y Agenda.
2. Moverse: `H`, `←/→`, cambiar a semana, mes y año; `G` para ir a una fecha.
3. **Pruébalo:** crear con la barra rápida «mañana de 9 a 11 estudio tema 1».
4. **Pruébalo:** dictar una tarea (o `Win+H` en Windows).
5. **Pruébalo:** seleccionar 3 días en el mes y añadirles la misma tarea.
6. Tipos y prioridades: qué significa cada color, trama e icono.
7. **Pruébalo:** crear un tema, fijar la fecha del examen y ver aparecer repasos y estudio intercalados.
8. **Pruébalo:** marcar una sesión como hecha y valorarla, y ver cómo se reprograma el repaso.
9. Panel de progreso.

- Se practica sobre una **agenda de práctica aislada** (`agenda-practica/`), que se borra al terminar, igual que el documento de práctica actual. La agenda real no se toca.
- Accesible en cualquier momento desde el botón **?**, desde Archivo > Tutorial y desde «Dígame». También puede lanzarse solo un capítulo («Repetición espaciada»).

---

## 10. Pulido final (fase 8)

- Avisos de escritorio antes de cada bloque (opcional, configurable).
- Rendimiento: virtualizar la vista año y cachear los meses visibles.
- Copia de seguridad diaria y restaurar desde Ajustes.
- Actualizar el README y la «Guía rápida de Folio».

---

## 11. Orden recomendado y estimación

| Fase | Contenido | Estimación |
|---|---|---|
| 0 | Arreglar los bloques en Linux | 1-2 días |
| — | Unir PDF (independiente, se puede hacer en cualquier momento) | 1-2 días |
| 1 | Datos, almacenamiento, API y tests | 2-3 días |
| 2 | Vistas día/semana/mes/año, navegación y accesibilidad | 5-7 días |
| 3 | Selector de hora, sugerencias, barra rápida, selección de varios días, semanas tipo, deshacer | 5-6 días |
| 4a | Dictado con `Win+H` | ½ día |
| 5 | Temario (a mano e importado), FSRS y planificador | 6-7 días |
| 6 | Seguimiento y panel de progreso | 3-4 días |
| 7 | Tutorial de la agenda | 2 días |
| 4b | Dictado propio con whisper.cpp | 4-5 días |
| 8 | Pulido | 2-3 días |

El dictado propio (4b) va después del planificador: es lo más costoso, y mientras tanto la opción 4a ya permite dictar en Windows.

---

## 12. Decisiones

Tomadas:

1. **Dictado:** whisper.cpp sin conexión en Windows y Linux; la app descarga el modelo (por defecto `base`, ~148 MB).
2. **Temario:** a mano o importado de un documento.
3. **Tiempo de estudio y demás opciones:** elegibles por la persona, con sugerencias según sus últimas acciones; horas con hora y minuto y atajo de solo hora.
4. **Unir PDF:** se añade como herramienta independiente.

Pendientes:

1. **Sincronización con el móvil:** ¿basta con exportar `.ics`, o se quiere una suscripción que se actualice sola?
