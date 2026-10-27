# Folio

Procesador de textos para docentes con los **atajos de teclado de Microsoft Word**, una interfaz que toma la organización de Word (cinta con pestañas, menú Archivo, barra de estado) y la sobriedad de **Notion** (páginas anidadas, menú «/»), e **historial de versiones** de cada documento. Escrito en **Go** (Wails v2) con un editor ProseMirror/TipTap. Funciona en **Linux y Windows** como un único ejecutable nativo.

## Por qué así

- **Go + webview del sistema (Wails)**: un binario de unos 15 MB que usa WebKitGTK en Linux y WebView2 (Edge) en Windows. Arranca rápido y consume mucha menos memoria que Electron, porque no incluye un Chromium.
- **Editor ProseMirror**: el mismo motor que usan Notion-likes y editores profesionales. Las transacciones son incrementales, así que escribir sigue siendo fluido en documentos largos.
- **Carga diferida**: KaTeX (ecuaciones), mammoth (importar .docx) y marked/turndown (Markdown) solo se cargan cuando se usan.
- **Archivos normales**: cada documento es una carpeta con `content.json`, sus imágenes y su historial. Puedes sincronizar la carpeta con Drive, OneDrive o Nextcloud.

## Funciones

**Como Word**
- Estilos (Normal, Título 1-4, Cita, Código), 30 fuentes agrupadas como en Word (sin serifa, con serifa, lectura fácil, manuscrita y monoespaciada), cada una mostrada con su propia letra en el selector; tamaños, color de fuente y de resaltado, subíndice/superíndice, tachado.
- Alineación, interlineado, sangrías, viñetas, numeración multinivel, listas de tareas.
- Tablas con celdas combinadas, encabezado repetido, color de celda y columnas redimensionables.
- Imágenes (pegar, arrastrar o insertar) redimensionables, con alineación y texto alternativo.
- Notas al pie numeradas, comentarios de revisión, hipervínculos, índice automático y saltos de página.
- Copiar/pegar formato, cambiar mayúsculas/minúsculas (Mayús+F3), mover párrafos (Alt+Mayús+↑/↓).
- Buscar y reemplazar (mayúsculas/minúsculas, palabras completas), contar palabras.
- Configurar página: papel A4/A5/Carta/Oficio, orientación, márgenes, encabezado y pie con `{titulo}`, `{fecha}` y `{autor}`, y «Página X de Y».
- Vista de página con guías de salto, vista de lectura, zoom, marcas de formato ¶ y modo concentración.

**Primeros pasos**
- Tutorial guiado la primera vez que se abre, y en cualquier momento desde el botón de ayuda (?), Archivo > Tutorial o «Dígame»: resalta cada parte de la interfaz y propone prácticas que se comprueban solas (negrita, fuentes, menú «/», cuadros, ecuaciones, versión del alumnado, versiones y búsqueda) sobre unos apuntes de ejemplo que se borran al terminar.
- Se adapta a pantallas pequeñas: la cinta se compacta para caber sin barras de desplazamiento, el panel de documentos flota en ventanas estrechas y el zoom «Ajustar al ancho» reduce la hoja si no cabe.

**Pensado para docentes**
- Cuadros de **definición, ejemplo, importante, consejo, atención, información y ejercicio**.
- **Bloques de solución** plegables: al exportar o imprimir puedes generar la **versión del alumnado**, que los oculta.
- **Líneas de respuesta** para exámenes y fichas, y bloque «pregunta de examen».
- **Ecuaciones LaTeX** en línea (`$x^2$` o Alt+=) y en bloque (`$$`), con vista previa y botones de símbolos.
- Plantillas: apuntes de clase, apuntes Cornell, examen, ficha de ejercicios, rúbrica, situación de aprendizaje (LOMLOE) y acta de reunión.

**Como Notion**
- Menú `/` para insertar bloques, atajos Markdown (`#`, `-`, `1.`, `[ ]`, `>`, ` ``` `, `---`).
- Páginas anidadas en el panel lateral, arrastrar para reordenar, favoritos, iconos y papelera.
- Búsqueda en todos los documentos sin distinguir tildes, y paleta de comandos «Dígame» (Alt+Q).
- Tema claro/oscuro.

**Versiones**
- Versión automática cada N minutos de edición (configurable) y al cerrar la app.
- Ctrl+G / Ctrl+S guarda un punto de restauración; F12 guarda una versión con nombre.
- Vista previa de cualquier versión, comparación palabra a palabra con la actual, restaurar (siempre se guarda antes una copia del estado actual) o copiarla como documento nuevo.
- Almacenamiento comprimido y deduplicado por contenido. Las versiones automáticas antiguas se aclaran solas (todas las de 24 h, una por hora durante la semana y una por día después). Las versiones con nombre nunca se borran.

**Agenda de estudio (oposiciones)**
- Vistas de **día, semana, mes y año**, con minicalendario, «Ir a» («15 marzo», «semana 12», «+3 semanas») y atajos de una tecla (D, S, M, A, H, G, N).
- **Barra rápida en lenguaje natural**: «de lunes a viernes de 9 a 11 estudio tema 4 hasta el 20 de diciembre». Antes de crear nada se ve lo que se ha entendido.
- **Dictado sin conexión** con whisper.cpp (modelo «small», se descarga una vez). Mantén Ctrl+Mayús+Espacio para hablar.
- **Tipos con prioridad**, cada uno con color, icono y trama (se distinguen sin depender del color).
- Repeticiones, selección de **varios días** (añadir, copiar, mover, descanso, borrar), **semanas tipo** y deshacer.
- **Temario** a mano, pegando una lista o importado de un documento (con apuntes por tema).
- **Repetición espaciada (FSRS)** y un planificador que intercala estudio nuevo y repasos en tu tiempo de estudio (horas, franja o ambas, con sugerencias según tus últimas acciones), con fase final de repaso y simulacros, y aviso si el temario no cabe.
- **Progreso**: horas por semana frente al objetivo, racha, cobertura del temario, temas más flojos, notas de simulacros y previsión. Exporta a CSV.
- Tutorial interactivo propio sobre una agenda de prueba que se borra al terminar.

**Unir PDF**
- Archivo > Unir PDF (o soltar PDF en la ventana): reordenar, rangos de páginas, añadir el documento abierto y un marcador por archivo.

**Importar / exportar**
- Exporta a **Word (.docx)** generado en Go: estilos de título navegables, listas numeradas reales, tablas, imágenes, notas al pie, comentarios, índice actualizable, encabezado/pie y número de página.
- Exporta a **PDF** (motor de impresión de Edge/Chrome; Edge viene con Windows), **HTML** autónomo y **Markdown** (GFM).
- Imprime con el diálogo del sistema.
- Importa **.docx**, **.md**, **.html** y **.txt**.

## Atajos

Hay dos mapas, elegibles en Ajustes o en la barra de estado:

| Acción | Word en español | Word en inglés |
| --- | --- | --- |
| Negrita / Cursiva / Subrayado | Ctrl+N / Ctrl+K / Ctrl+S | Ctrl+B / Ctrl+I / Ctrl+U |
| Nuevo / Abrir / Guardar | Ctrl+U / Ctrl+A / Ctrl+G | Ctrl+N / Ctrl+O / Ctrl+S |
| Seleccionar todo | Ctrl+E | Ctrl+A |
| Buscar / Reemplazar | Ctrl+B / Ctrl+L | Ctrl+F / Ctrl+H |
| Izquierda / Centro / Derecha / Justificar | Ctrl+Q / Ctrl+T / Ctrl+D / Ctrl+J | Ctrl+L / Ctrl+E / Ctrl+R / Ctrl+J |
| Hipervínculo | Ctrl+Alt+K | Ctrl+K |

Comunes a ambos: Ctrl+Alt+1/2/3 (títulos), Ctrl+Mayús+N (Normal), Ctrl+Mayús+L (viñetas), Ctrl+1/2/5 (interlineado), Ctrl+= / Ctrl++ (sub/superíndice), Ctrl+Mayús+>/< y Ctrl+]/[ (tamaño), Ctrl+Espacio (quitar formato), Ctrl+Intro (salto de página), Ctrl+Alt+F (nota al pie), Ctrl+Alt+M (comentario), Alt+= (ecuación), Mayús+F3, Ctrl+Mayús+C/V (copiar/pegar formato), Ctrl+P, F12, Ctrl+F1 (cinta), Alt+Q, F1 (lista completa).

AltGr nunca se interpreta como Ctrl+Alt, así que `@`, `#` o `€` se escriben con normalidad en teclados españoles.

## Compilar

Requisitos: Go ≥ 1.24, Node ≥ 20 y el CLI de Wails (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`).

**Linux (Fedora)**
```bash
sudo dnf install gcc gtk3-devel webkit2gtk4.1-devel
./build.sh linux        # → build/bin/folio
```
En Debian/Ubuntu: `sudo apt install build-essential libgtk-3-dev libwebkit2gtk-4.1-dev`.

**Windows** (desde Linux o desde Windows; no necesita cgo)
```bash
./build.sh windows      # → build/bin/folio.exe
```
**Instalador de Windows** (un solo .exe; necesita `sudo dnf install mingw32-nsis`)
```bash
./build.sh installer    # → build/bin/Folio-Setup-<versión>.exe
```
Al abrirlo instala Folio para el usuario actual sin pedir permisos de administrador (en `%LocalAppData%\Programs\Folio`), crea los accesos del menú Inicio y del escritorio, lo añade a «Aplicaciones instaladas» (desde donde se desinstala) y lo abre. Windows no permite que un programa se ancle solo a la barra de tareas; la primera vez Folio explica cómo hacerlo. Desinstalar no borra los documentos.

En Windows también puedes usar `build.ps1`. El ejecutable usa WebView2, que ya viene con Windows 10/11.

**Desarrollo con recarga en caliente**
```bash
wails dev -tags webkit2_41
```
O solo la interfaz en el navegador con datos simulados: `cd frontend && npm run dev`.

**Tests**
```bash
go test ./...
(cd frontend && npm test)   # analizador de frases de la agenda
```

**Dictado (whisper.cpp)**: Folio busca `whisper-cli` junto al ejecutable, en
`~/.local/share/folio/bin` (Linux) o `%LocalAppData%\Folio\bin` (Windows), o en
el PATH. El modelo se descarga desde la propia app a `…/folio/models`.

## Dónde están los datos

- Documentos y agenda: `~/Documentos/Folio` (o la carpeta que elijas en Ajustes).
- Ajustes: `~/.config/Folio/settings.json` en Linux y `%AppData%\Folio\settings.json` en Windows.

```
Folio/docs/<id>/
  meta.json          título, icono, jerarquía y configuración de página
  content.json       documento (JSON de ProseMirror)
  content.txt        texto plano para la búsqueda
  files/             imágenes
  versions/          index.json + instantáneas .json.gz (deduplicadas por hash)
Folio/agenda/
  types.json, settings.json, topics.json, templates.json
  tasks/AAAA-MM.json       tareas de cada mes
  sessions/AAAA-MM.jsonl   sesiones de estudio realizadas
```

## Estructura del código

```
main.go, app.go, pdf.go   ventana Wails y API expuesta a la interfaz
app_agenda.go             API de la agenda
pdfmerge.go, dictation.go unir PDF (pdfcpu) y dictado (whisper.cpp)
internal/store            documentos, árbol, papelera, búsqueda e historial de versiones
internal/agenda           agenda: series, temario FSRS, sesiones y planificador
internal/docx             exportador .docx (incluye LaTeX → Unicode)
internal/paths            carpetas de usuario en Linux y Windows
frontend/src
  editor/                 extensiones del editor (cuadros, soluciones, ecuaciones, notas…)
  shortcuts.ts            mapas de atajos de Word (ES/EN)
  ui/                     panel lateral, cinta, paneles, diálogos, paleta, búsqueda
  io.ts                   exportación HTML/MD/PDF e importación
  templates.ts            plantillas docentes
  agenda/                 agenda: vistas, barra rápida, analizador de frases, dictado, temario, plan, progreso
docs/                     guías: plan de la agenda y porte a Android con sincronización
```

## Limitaciones conocidas

- La vista Diseño de impresión corta las páginas en los mismos sitios que el PDF, la impresión y el HTML. Word vuelve a paginar el .docx por su cuenta, así que allí los cortes pueden variar ligeramente.
- En Linux, WebKitGTK no ofrece sugerencias ortográficas en el menú contextual. En Windows (WebView2) sí.
- Veinte de las fuentes (Roboto, Lora, Atkinson Hyperlegible, Caveat…) van incluidas en Folio con licencia SIL OFL e incrustadas en el PDF y el HTML, solo con el alfabeto latino. Word no las incrusta en el .docx: en un equipo que no las tenga instaladas, Word las sustituye por otra.
- Las ecuaciones se exportan a Word como texto Unicode legible (x², √, α…), no como objetos de ecuación editables de Office.
- El PDF directo usa Chrome/Edge/Chromium. Si no hay ninguno instalado, Folio abre el diálogo de impresión del sistema.

## Sincronización y Android

- **Sincronización** (Más > Sincronización, o la paleta de comandos): vincula Nextcloud/otro WebDAV o Google Drive. Documentos y agenda se fusionan entre dispositivos; si dos dispositivos editan lo mismo, se conserva una versión de conflicto en el historial. Las credenciales van al almacén seguro del sistema (nunca a los ajustes ni a la nube). Para Google Drive hay que crear antes un proyecto en Google Cloud y rellenar `GoogleDesktopClientID/Secret` en `internal/cloudsync/oauth.go`.
- **Android**: app Capacitor con la misma interfaz adaptada al móvil (`?mobile` en el navegador permite probarla). Guía de construcción: `docs/guia-android.md`; desviaciones y comprobaciones pendientes: `docs/guia-android-notas.md`. Requiere JDK 21 y Android SDK/NDK; `./build.sh android` o `android-debug`. El código nativo aún no se ha compilado ni probado en un dispositivo.
- Avisos de tareas (solo Android): Plan de estudio > «Avisarme antes de cada tarea».
- Pruebas de interfaz móvil: `npm run dev` y, en otra terminal, `npm run test:mobile` (capturas en `frontend/tests/out/`, comprobación de desbordamiento y objetivos táctiles de 44 px).

## Cuentas, círculos y actualizaciones

- **Cuenta** (Archivo › Tu cuenta y círculos, o Más › Tu cuenta): entra con Google o con correo y contraseña. Sirve para los círculos; los documentos y la agenda privada siguen en tus dispositivos.
- **Círculos** de amigos (varias personas) o de pareja (dos): al crear un evento eliges «Quién lo ve»: solo tú o un círculo. Los del círculo los ven todos sus miembros y el plan de estudio los respeta como tiempo ocupado. Se entra con un código de invitación.
- **Citas** (círculos de pareja): propones varios días, la otra persona elige uno (o propone otros) y queda en la agenda de los dos.
- Configuración del servidor (Supabase): `docs/supabase.md`.
- **Actualizaciones** con un botón (Archivo › Buscar actualizaciones): GitHub Releases con suma SHA-256 y firma propia. Cómo publicar: `docs/actualizaciones.md`.
