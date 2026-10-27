# Folio para Android y sincronización en la nube — guía de implementación

Guía paso a paso para llevar **toda** la aplicación (documentos, agenda de
estudio, unir PDF, versiones, exportación, dictado y tutoriales) a Android, con
una interfaz pensada para el móvil, y para **vincular** la app de escritorio
(Windows y Linux) y la de Android mediante la nube.

Está escrita para que la ejecute un modelo sin contexto previo. Todas las
decisiones están tomadas: no hay que elegir tecnologías ni inventar
arquitectura. Si algo no encaja con el código real, hay que pararse y avisar,
no improvisar (ver § 0.3).

---

## Índice

- [0. Cómo usar esta guía](#0-cómo-usar-esta-guía)
- [1. Decisiones de arquitectura](#1-decisiones-de-arquitectura)
- [2. Mapa del código actual](#2-mapa-del-código-actual)
- [3. Preparar el entorno](#3-preparar-el-entorno)
- [Fase A. Núcleo Go independiente de Wails](#fase-a-núcleo-go-independiente-de-wails)
- [Fase B. Capa de plataforma en la interfaz](#fase-b-capa-de-plataforma-en-la-interfaz)
- [Fase C. Proyecto Android con Capacitor](#fase-c-proyecto-android-con-capacitor)
- [Fase D. El núcleo Go dentro de Android](#fase-d-el-núcleo-go-dentro-de-android)
- [Fase E. Archivos, compartir y abrir](#fase-e-archivos-compartir-y-abrir)
- [Fase F. PDF e impresión en Android](#fase-f-pdf-e-impresión-en-android)
- [Fase G. Dictado en Android](#fase-g-dictado-en-android)
- [Fase H. Interfaz móvil](#fase-h-interfaz-móvil)
- [Fase I. Sincronización en la nube](#fase-i-sincronización-en-la-nube)
- [Fase J. Avisos de la agenda](#fase-j-avisos-de-la-agenda)
- [Fase K. Tutoriales en el móvil](#fase-k-tutoriales-en-el-móvil)
- [Fase L. Pruebas y calidad](#fase-l-pruebas-y-calidad)
- [Fase M. Compilar, firmar y publicar](#fase-m-compilar-firmar-y-publicar)
- [Apéndice 1. Errores frecuentes](#apéndice-1-errores-frecuentes)
- [Apéndice 2. Lista de comprobación final](#apéndice-2-lista-de-comprobación-final)

---

## 0. Cómo usar esta guía

### 0.1 Reglas para quien la ejecute

1. **Sigue las fases en orden.** Cada fase empieza con *Objetivo* y termina con
   *Comprobación*. No empieces la siguiente si la comprobación falla.
2. **La versión de escritorio nunca se rompe.** Al terminar cada fase deben
   pasar estos comandos (desde la raíz del repositorio):
   ```bash
   export PATH="$HOME/.local/go/bin:$HOME/go/bin:$PATH"
   go vet ./... && go test ./...
   (cd frontend && npx tsc --noEmit && npm run build)
   ./build.sh linux
   ```
3. **Convenciones del proyecto** (obligatorias):
   - Textos de la interfaz y comentarios en **español de España**. Sin
     anglicismos innecesarios. Tuteo.
   - Comentarios breves que explican el *porqué*, igual que en el resto del
     código. Nada de comentarios del tipo «// importa X».
   - TypeScript sin frameworks: se usa `h()` de `frontend/src/ui/dom.ts` para
     crear elementos, `modal()`, `popupMenu()` y `toast()` del mismo archivo.
     **No** añadas React, Vue, Tailwind ni librerías de componentes.
   - CSS con las variables de `frontend/src/styles.css` (`--accent`, `--bg`,
     `--text`…). Nada de colores sueltos salvo los ya definidos.
   - Go formateado con `gofmt`. Errores en español para el usuario.
   - Cada archivo nuevo empieza con un comentario de 1-3 líneas que dice para
     qué sirve.
4. **No inventes APIs.** Si un método de una librería no existe con el nombre
   que da esta guía, busca en la documentación oficial de esa versión el
   equivalente, y apúntalo en `docs/guia-android-notas.md` (crea el archivo).
5. **Haz un commit por paso numerado** (`git commit -m "Android A3: …"`) para
   poder volver atrás.
6. Las rutas son relativas a la raíz del repositorio
   (`/home/…/Proyectos/folio`) salvo que se indique otra cosa.

### 0.2 Qué se entrega al final

- `frontend/android/`: proyecto Android (Capacitor) que genera `Folio.apk` / `.aab`.
- `internal/core/`: núcleo Go compartido por escritorio y Android.
- `internal/sync/`: motor de sincronización (escritorio y Android).
- `mobile/`: paquete Go para `gomobile bind` (genera `folio-core.aar`).
- `frontend/src/platform/`: capa que oculta las diferencias entre escritorio, Android y navegador.
- `frontend/src/mobile/`: interfaz móvil (navegación, barras, hojas, gestos).
- `./build.sh android` compila todo.

### 0.3 Cuándo parar y preguntar

Para y deja una nota en `docs/guia-android-notas.md` (y avisa al usuario) si:

- Un test que ya existía deja de pasar y no sabes por qué tras dos intentos.
- Hace falta una credencial o cuenta (Google Cloud, Play Console, firma): **no
  las crees tú**. Explica al usuario qué crear y dónde se pone (ver § I.7 y § M).
- Una librería ha cambiado tanto que el código de esta guía no compila y la
  corrección no es evidente.

---

## 1. Decisiones de arquitectura

| Tema | Decisión | Motivo |
|---|---|---|
| Contenedor Android | **Capacitor 7** (WebView del sistema). | Reutiliza el 100 % de la interfaz TypeScript, igual que Wails en escritorio. Wails no genera apps Android. |
| Lógica | **El mismo código Go** compilado con `gomobile bind` en un `.aar`. | Almacén de documentos, versiones, agenda, planificador FSRS, .docx y unir PDF tienen una sola implementación, ya probada. |
| Puente | Un único método `Call(método, argumentosJSON)` despachado por reflexión en Go. | `gomobile` solo admite tipos simples; así no hay que escribir un envoltorio por función. |
| Imágenes de los documentos | Se siguen guardando como `/files/<doc>/<hash>.png`; Android intercepta esa ruta en el WebView. | El JSON de los documentos es idéntico en todas las plataformas (imprescindible para sincronizar). |
| PDF en Android | Imprimir: `PrintManager` del sistema. Exportar a archivo: WebView fuera de pantalla + `PrintDocumentAdapter` (§ F). | No hay Chrome «headless» en Android. |
| Dictado en Android | `SpeechRecognizer` del sistema **en el dispositivo** (`createOnDeviceSpeechRecognizer`, Android 12+), con reconocimiento sin conexión preferido. | Es local y privado como whisper.cpp, pero sin descargar 488 MB. whisper.cpp en Android queda como mejora opcional (§ G.5). |
| Sincronización | Motor propio en Go (`internal/sync`), por archivos, con **fusión a tres bandas** por tipo de archivo. Proveedores: **WebDAV** (Nextcloud y similares) y **Google Drive**. | Los datos ya son archivos JSON. Sin servidor propio ni cuentas de Folio. La misma lógica en escritorio y Android. |
| Conflictos en documentos | Gana la versión más reciente y **la otra se guarda en el historial de versiones** del documento. | No se pierde nada y reutiliza la función de versiones que ya existe. |
| Interfaz móvil | Mismo código, con una capa `frontend/src/mobile/` que cambia la estructura (barra inferior, pantallas, hojas, barra de formato sobre el teclado). Se activa con `body.is-mobile`. | Una sola base de código; el escritorio no cambia. |
| Versiones mínimas | Android 8.0 (API 26) mínimo; compila contra API 35. | Cubre >95 % de dispositivos; el WebView del sistema se actualiza por Play Store. |

**Fuera de alcance:** iOS (la arquitectura lo permitiría con Capacitor + `gomobile bind -target=ios`, pero no se hace aquí), cifrado de extremo a extremo (se deja preparado en § I.9) y edición simultánea en tiempo real.

---

## 2. Mapa del código actual

Léelo antes de empezar. Si algún archivo no existe o ha cambiado de nombre, para (§ 0.3).

### 2.1 Go (raíz y `internal/`)

| Archivo | Contenido |
|---|---|
| `main.go` | Arranque de Wails: ventana sin marco, `Bind: []any{app}`, arrastrar archivos. |
| `app.go` | `type App`: ajustes (`Settings`), apertura del espacio de trabajo, **todas las funciones que llama la interfaz** (documentos, versiones, exportar .docx, importar, diálogos de archivos). Usa `wruntime` (Wails) para diálogos y eventos. |
| `app_agenda.go` | Funciones `Agenda*` (delegan en `internal/agenda`) y `AgendaPractice`. |
| `pdf.go` | `ExportPDF` y `renderPDF`: HTML → PDF con Chrome/Edge sin ventana. **Solo escritorio.** |
| `pdfmerge.go` | `ChoosePdfs`, `PdfInfo`, `RenderPdfTemp`, `MergePdfs`, `mergePdfs` (pdfcpu). |
| `dictation.go` | Dictado con `whisper-cli` (escritorio). |
| `exec_windows.go`, `exec_other.go` | `hideWindow`, `stopProcess`. |
| `internal/store/` | Documentos en disco (`docs/<id>/meta.json`, `content.json`, `content.txt`, `files/`, `versions/`). |
| `internal/agenda/` | Agenda: tareas, series, tipos, temario FSRS, sesiones, planificador, deshacer. |
| `internal/docx/` | Exportación a Word. |
| `internal/paths/` | `ConfigDir()`, `DefaultWorkspace()`, `DataDir()`. |
| `internal/fsutil/` | `ReadJSON`, `WriteJSON`, `WriteFileAtomic`. |

### 2.2 Disposición de los datos (espacio de trabajo)

```
<espacio>/
  docs/<id>/meta.json            metadatos (título, icono, padre, orden, updated…)
  docs/<id>/content.json         contenido ProseMirror + configuración de página
  docs/<id>/content.txt          texto plano (búsqueda)
  docs/<id>/files/<hash>.<ext>   imágenes (nombre = hash: nunca cambian)
  docs/<id>/versions/index.json  lista de versiones
  docs/<id>/versions/<hash>.json.gz  contenido de cada versión (nombre = hash)
  agenda/types.json, settings.json, topics.json, templates.json
  agenda/tasks/AAAA-MM.json      tareas del mes
  agenda/sessions/AAAA-MM.jsonl  sesiones (una por línea)
```
Los ajustes de la app (`Settings`) están **fuera** del espacio, en `paths.ConfigDir()/settings.json`.

> Antes de la fase I, comprueba esta disposición leyendo `internal/store/store.go`
> (`docDir`, `filesDir`) y `internal/store/versions.go`. Si difiere, adapta
> las reglas de § I.4 a la disposición real.

### 2.3 Interfaz (`frontend/src/`)

| Archivo | Contenido |
|---|---|
| `api.ts` | Interfaz `Backend` con todas las funciones del backend; elige Wails (`window.go.main.App`) o el simulado (navegador). `onEvent`, `setWindowTitle`. |
| `app.ts` | Clase `App`: estado, abrir/guardar, atajos, modos «docs»/«agenda», tutorial. |
| `ui/*.ts` | Panel lateral, cinta, barra superior (`docview.ts`), paneles, diálogos, Archivo (`backstage.ts`), unir PDF, tutorial (`tour.ts`), asa de bloque. |
| `editor/*.ts` | Editor TipTap/ProseMirror y extensiones. |
| `agenda/*.ts` | Agenda: `view.ts` (controlador), `views/` (día-semana, mes, año), `editor.ts`, `quickadd.ts`, `parse.ts`, `dictation.ts`, `topics.ts`, `plansettings.ts`, `stats.ts`, `sidebar.ts`, `templates.ts`, `agenda.css`. |
| `styles.css` | Estilos y variables de tema. |

---

## 3. Preparar el entorno

Todo en Linux (Fedora del usuario). Ejecuta y comprueba cada línea.

### 3.1 Herramientas

| Herramienta | Versión | Instalación | Comprobación |
|---|---|---|---|
| Go | la del repo (`go.mod`) | ya instalada en `~/.local/go` | `go version` |
| Node.js | ≥ 20 | ya instalado (nvm) | `node -v` |
| JDK | **21** | `sudo dnf install java-21-openjdk-devel` (lo instala el usuario) | `javac -version` → 21 |
| Android SDK + NDK | SDK Platform 35, Build-Tools 35, **NDK 27.x**, Command-line tools | Android Studio → *SDK Manager* (lo instala el usuario) | `ls $ANDROID_HOME/ndk` |
| gomobile | última | `go install golang.org/x/mobile/cmd/gomobile@latest && go install golang.org/x/mobile/cmd/gobind@latest && gomobile init` | `gomobile version` |

Variables (añádelas a `~/.bashrc`):
```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/$(ls $ANDROID_HOME/ndk | sort -V | tail -1)"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"
```

> Instalar paquetes del sistema necesita `sudo`: **pídeselo al usuario**
> (`! sudo dnf install java-21-openjdk-devel`), no lo intentes tú.

### 3.2 Comprobación

```bash
java -version && gomobile version && adb version && echo LISTO
```

---

## Fase A. Núcleo Go independiente de Wails

**Objetivo:** que toda la lógica viva en `internal/core` sin importar Wails, para
poder usarla desde Android. El escritorio sigue funcionando igual porque `App`
**incrusta** el núcleo.

### A1. Crear `internal/core/service.go`

1. Crea el paquete `internal/core` con `type Service struct`. Mueve a él (cortar
   y pegar, sin cambiar la lógica) desde `app.go` y `app_agenda.go`:
   - Los campos `store`, `agenda`, `realAgenda`, `mu`, `settings`, `tempPdfs`.
   - Los tipos `Settings`, `InitData`, `CreateRequest`, `ExportOptions`, `ImportedFile`, `AgendaInitData`, `PdfFile`, `MergeItem`, `MergeOptions`.
   - `defaultSettings()`, `openWorkspace`, `settingsPath`, `st()`, `ag()`.
   - Todas las funciones **que no abren diálogos ni ventanas**: `Init`,
     `SaveSettings`, `ListDocs`, `GetDoc`, `CreateDoc`, `SaveDoc`, `UpdateMeta`,
     `SetSetup`, `TrashDoc`, `RestoreDoc`, `DeleteDoc`, `EmptyTrash`,
     `DuplicateDoc`, `Search`, versiones (`ListVersions` … `DeleteVersion`),
     `SaveImage`, todas las `Agenda*`, `PdfInfo`, `mergePdfs`, `pageSelection`,
     `pdfErrorText`, `copyFile`.
2. El constructor recibe las carpetas y quién emite eventos:
   ```go
   // Package core reúne la lógica de Folio sin depender de la interfaz: lo
   // usan la app de escritorio (Wails) y la de Android (gomobile).
   package core

   // Emitter envía un evento a la interfaz (nombre y datos serializables a JSON).
   type Emitter func(name string, data ...any)

   type Options struct {
   	ConfigDir string  // ajustes de la app (settings.json)
   	Workspace string  // espacio por defecto si los ajustes no dicen otro
   	OS        string  // "linux", "windows", "android"
   	Version   string
   	Emit      Emitter // puede ser nil
   }

   func New(o Options) (*Service, error)
   ```
   - `New` hace lo que hoy hace `NewApp` (leer ajustes, abrir el espacio, volver al
     predeterminado si falla) **sin `panic`**: devuelve el error.
   - `Init()` devuelve `OS: s.opt.OS` en vez de `goruntime.GOOS`.
3. **Versiones de las funciones con diálogo basadas en rutas** (nuevas, en `core`):
   ```go
   // Escriben en la ruta indicada; el diálogo para elegirla lo pone cada plataforma.
   func (s *Service) ExportDocxTo(id string, opt ExportOptions, path string) error
   func (s *Service) WriteTextFile(path, content string) error
   func (s *Service) ImportFromPath(path string) (*ImportedFile, error)
   func (s *Service) MergePdfsTo(items []MergeItem, out string, bookmarks bool) error
   ```
   Copia la lógica de `ExportDocx`, `SaveTextFile`, `OpenImportFile` y `MergePdfs` sin la parte del diálogo.

### A2. Adelgazar `App` (escritorio)

En `app.go`:
```go
type App struct {
	*core.Service                 // métodos promovidos: Wails los publica igual que antes
	ctx       context.Context
	dictation dictation
}
```
- `NewApp()` llama a `core.New(core.Options{ConfigDir: paths.ConfigDir(), Workspace: paths.DefaultWorkspace(), OS: goruntime.GOOS, Version: Version, Emit: nil})` y en `startup` pone `Emit` a `func(n string, d ...any) { wruntime.EventsEmit(ctx, n, d...) }` (añade `SetEmitter` en `core`).
- En `App` se quedan solo las funciones con diálogo (`ExportDocx`, `SaveTextFile`,
  `OpenImportFile`, `ChooseWorkspace`, `ChoosePdfs`, `MergePdfs`, `ExportPDF`,
  `RenderPdfTemp`), `OpenWorkspaceFolder`, `OpenURL`, `RevealFile`,
  `ConfirmClose`, `beforeClose`, `domReady`, `filesHandler` y el dictado. Cada una
  pide la ruta con el diálogo y llama a la versión de `core` (A1.3).

> **Cuidado:** Wails publica los métodos promovidos de un puntero incrustado.
> Después de `wails build`, abre `frontend/wailsjs/go/main/App.d.ts` y comprueba
> que siguen **todos** los métodos de `Backend` (`frontend/src/api.ts`). Si falta
> alguno, añade en `App` un envoltorio de una línea (`func (a *App) X(…) … { return a.Service.X(…) }`).

### A3. Despachador genérico (para Android)

Crea `internal/core/dispatch.go`. Llama a cualquier método exportado de un
objeto con los argumentos en un array JSON, como hace Wails:

```go
package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
)

var errorType = reflect.TypeOf((*error)(nil)).Elem()

// Dispatch llama a target.method(args...) con los argumentos en un array JSON
// y devuelve el primer resultado (no error) en JSON. Lo usa Android.
func Dispatch(target any, method, argsJSON string) (string, error) {
	m := reflect.ValueOf(target).MethodByName(method)
	if !m.IsValid() {
		return "", fmt.Errorf("función desconocida: %s", method)
	}
	var raw []json.RawMessage
	if argsJSON != "" && argsJSON != "null" {
		if err := json.Unmarshal([]byte(argsJSON), &raw); err != nil {
			return "", fmt.Errorf("argumentos no válidos para %s: %w", method, err)
		}
	}
	t := m.Type()
	if t.IsVariadic() || len(raw) != t.NumIn() {
		return "", fmt.Errorf("%s espera %d argumentos y recibió %d", method, t.NumIn(), len(raw))
	}
	in := make([]reflect.Value, t.NumIn())
	for i := range in {
		p := reflect.New(t.In(i))
		if err := json.Unmarshal(raw[i], p.Interface()); err != nil {
			return "", fmt.Errorf("argumento %d de %s: %w", i+1, method, err)
		}
		in[i] = p.Elem()
	}
	var result any
	for _, v := range m.Call(in) {
		if v.Type().Implements(errorType) {
			if !v.IsNil() {
				return "", v.Interface().(error)
			}
			continue
		}
		result = v.Interface()
	}
	b, err := json.Marshal(result)
	if err != nil {
		return "", errors.New("no se pudo serializar la respuesta de " + method)
	}
	return string(b), nil
}
```

Test obligatorio `internal/core/dispatch_test.go`: un tipo de prueba con métodos
`Sum(a, b int) int`, `Fail() error`, `Echo(x struct{ A string }) (struct{ A string }, error)`.
Comprueba éxito, error devuelto, número de argumentos incorrecto y método inexistente.

### A4. Comprobación de la fase A

```bash
go vet ./... && go test ./... && ./build.sh linux
grep -c "export function" frontend/wailsjs/go/main/App.d.ts   # igual o mayor que antes
```
Abre la app de escritorio: crea un documento, añade una imagen, exporta a .docx,
une dos PDF y crea una tarea en la agenda. Todo debe funcionar como antes.

---

## Fase B. Capa de plataforma en la interfaz

**Objetivo:** que la interfaz no sepa si está en Wails, en Android o en un
navegador. Todo lo específico pasa por `frontend/src/platform/`.

### B1. `frontend/src/platform/platform.ts`

```ts
// Dónde se ejecuta Folio y qué puede hacer cada plataforma.
export type PlatformId = 'desktop' | 'android' | 'web';

declare global { interface Window { Capacitor?: { isNativePlatform(): boolean; getPlatform(): string } } }

export const platform: PlatformId = window.go?.main?.App ? 'desktop'
  : window.Capacitor?.isNativePlatform?.() && window.Capacitor.getPlatform() === 'android' ? 'android'
  : 'web';

export const isDesktop = platform === 'desktop';
export const isAndroid = platform === 'android';

/** Interfaz móvil: en Android siempre; en el navegador, si la ventana es estrecha (para probar). */
export function wantsMobileUI(): boolean {
  return isAndroid || new URLSearchParams(location.search).has('mobile');
}
```

### B2. Backend de Android en `api.ts`

1. Instala Capacitor en el frontend (fase C1) antes de este paso.
2. Crea `frontend/src/platform/android.ts`:

```ts
// Backend de Android: cada función de `Backend` llama al núcleo Go (plugin
// FolioCore) con los argumentos en JSON; las que necesitan diálogos del
// sistema se sustituyen por versiones de Android (archivos, PDF, dictado).
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { Backend } from '../api';
import { androidOverrides } from './android-overrides';

interface FolioCorePlugin {
  call(o: { method: string; args: string }): Promise<{ result: string }>;
  addListener(name: 'event', cb: (e: { name: string; payload: string }) => void): Promise<PluginListenerHandle>;
}
export const FolioCore = registerPlugin<FolioCorePlugin>('FolioCore');

export function createAndroidBackend(): Backend {
  const core = new Proxy({} as Backend, {
    get: (_t, name: string) => async (...args: unknown[]) => {
      const r = await FolioCore.call({ method: name, args: JSON.stringify(args) });
      return r.result === '' ? undefined : JSON.parse(r.result);
    },
  });
  // Los eventos del núcleo se escuchan solo en Android (en escritorio este módulo no se usa)
  void FolioCore.addListener('event', (e) => {
    const data = e.payload ? JSON.parse(e.payload) : [];
    listeners.get(e.name)?.forEach((cb) => cb(...(Array.isArray(data) ? data : [data])));
  });
  // Las funciones sustituidas se buscan primero; el resto cae en el Proxy (núcleo)
  return Object.assign(Object.create(core), androidOverrides(core)) as Backend;
}

const listeners = new Map<string, Set<(...a: any[]) => void>>();
export function onAndroidEvent(name: string, cb: (...a: any[]) => void) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name)!.add(cb);
  return () => listeners.get(name)!.delete(cb);
}
```

3. En `frontend/src/api.ts` cambia la selección del backend:
```ts
import { platform } from './platform/platform';
import { createAndroidBackend, onAndroidEvent } from './platform/android';

export const isNative = platform !== 'web';
export const api: Backend = platform === 'desktop' ? window.go!.main.App
  : platform === 'android' ? createAndroidBackend()
  : createMockBackend();

export function onEvent(name: string, cb: (...a: any[]) => void) {
  return platform === 'android' ? onAndroidEvent(name, cb) : window.runtime?.EventsOn(name, cb);
}
```
4. **Todo lo que usa `window.runtime`** debe estar protegido por `isDesktop`:
   - `ui/docview.ts → windowControls()` (botones de ventana): solo si `isDesktop`.
   - `app.ts → window.runtime?.OnFileDrop(...)`: ya usa `?.`; déjalo.
   - `api.ts → setWindowTitle`: en Android no hace nada (ya usa `if (window.runtime)`).
5. `App.native` (en `app.ts`) debe seguir siendo `true` en Android (`isNative`).

### B3. Comprobación de la fase B

```bash
cd frontend && npx tsc --noEmit && npm run build
```
La app de escritorio y `npm run dev` en el navegador funcionan igual que antes.

---

## Fase C. Proyecto Android con Capacitor

**Objetivo:** una app Android que abre la interfaz (todavía con el backend
simulado si el núcleo no está listo).

### C1. Instalar Capacitor

```bash
cd frontend
npm install @capacitor/core@^7 @capacitor/android@^7 @capacitor/app@^7 @capacitor/keyboard@^7 \
  @capacitor/status-bar@^7 @capacitor/share@^7 @capacitor/haptics@^7 @capacitor/local-notifications@^7 \
  @capacitor/preferences@^7
npm install -D @capacitor/cli@^7
npx cap init Folio es.folio.app --web-dir dist
```

### C2. `frontend/capacitor.config.ts`

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'es.folio.app',
  appName: 'Folio',
  webDir: 'dist',
  android: { allowMixedContent: false, webContentsDebuggingEnabled: true },
  plugins: {
    Keyboard: { resize: 'native', resizeOnFullScreen: true },
    StatusBar: { overlaysWebView: true },
  },
};
export default config;
```
> `webContentsDebuggingEnabled: true` permite depurar con `chrome://inspect`.
> En la compilación de publicación se pone a `false` (fase M).

### C3. Crear el proyecto

```bash
cd frontend
npm run build
npx cap add android
npx cap sync android
```
Se crea `frontend/android/`. Añade a `.gitignore`:
```
frontend/android/app/build/
frontend/android/.gradle/
frontend/android/app/libs/*.aar
frontend/android/local.properties
```

### C4. Ajustes del proyecto Android

`frontend/android/variables.gradle`: `minSdkVersion = 26`, `compileSdkVersion = 35`, `targetSdkVersion = 35`.

`frontend/android/app/src/main/AndroidManifest.xml` — dentro de `<manifest>`:
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" android:maxSdkVersion="32" />
<uses-permission android:name="android.permission.USE_EXACT_ALARM" />
<queries>
  <intent><action android:name="android.speech.RecognitionService" /></intent>
</queries>
```
Y en la `<activity>` principal, para recibir PDF compartidos desde otras apps:
```xml
<intent-filter>
  <action android:name="android.intent.action.SEND" />
  <action android:name="android.intent.action.SEND_MULTIPLE" />
  <category android:name="android.intent.category.DEFAULT" />
  <data android:mimeType="application/pdf" />
</intent-filter>
```

### C5. `index.html`

Cambia la etiqueta `viewport` para que la app use toda la pantalla (bordes redondeados y muesca):
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content" />
```

### C6. Comprobación de la fase C

```bash
cd frontend/android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
La app abre en el emulador o el móvil y muestra Folio (con datos simulados: aún no hay núcleo Go).

---

## Fase D. El núcleo Go dentro de Android

**Objetivo:** que Android use los mismos datos y la misma lógica que el escritorio.

### D1. Paquete `mobile/` para gomobile

`mobile/mobile.go`:
```go
// Package mobile expone el núcleo de Folio a Android con gomobile: un
// despachador genérico (Call) y un canal de eventos hacia Kotlin.
package mobile

import (
	"encoding/json"
	"errors"
	"sync"

	"folio/internal/core"
)

// EventSink lo implementa Kotlin para recibir eventos del núcleo.
type EventSink interface {
	Emit(name string, payloadJSON string)
}

var (
	mu   sync.Mutex
	svc  *core.Service
	sink EventSink
)

// Start abre el núcleo con las carpetas privadas de la app.
func Start(configDir, workspaceDir, version string) error {
	mu.Lock()
	defer mu.Unlock()
	if svc != nil {
		return nil
	}
	s, err := core.New(core.Options{ConfigDir: configDir, Workspace: workspaceDir, OS: "android", Version: version,
		Emit: func(name string, data ...any) {
			if sink == nil {
				return
			}
			b, _ := json.Marshal(data)
			sink.Emit(name, string(b))
		}})
	if err != nil {
		return err
	}
	svc = s
	return nil
}

// SetEventSink registra el receptor de eventos (llamar antes de Start).
func SetEventSink(s EventSink) { sink = s }

// Call ejecuta una función del núcleo con los argumentos en un array JSON.
func Call(method, argsJSON string) (string, error) {
	if svc == nil {
		return "", errors.New("el núcleo no está iniciado")
	}
	return core.Dispatch(svc, method, argsJSON)
}

// AssetPath traduce «/files/<doc>/<archivo>» a la ruta del archivo (para el WebView).
func AssetPath(url string) (string, error) {
	if svc == nil {
		return "", errors.New("el núcleo no está iniciado")
	}
	return svc.AssetPath(url)
}

// Stop guarda lo pendiente (versión «al cerrar»).
func Stop() {
	if svc != nil {
		svc.Shutdown()
	}
}
```
Añade a `core.Service` los métodos `AssetPath(url string) (string, error)` (delegando en `store.AssetPath`) y `Shutdown()` (lo que hoy hace `App.shutdown`).

### D2. Generar el `.aar`

```bash
mkdir -p frontend/android/app/libs
gomobile bind -target=android/arm64,android/amd64 -androidapi 26 -javapkg=es.folio \
  -ldflags="-s -w" -o frontend/android/app/libs/folio-core.aar ./mobile
```
- `android/amd64` sirve para el emulador; para publicar basta `android/arm64,android/arm`.
- Se generan las clases Java `es.folio.mobile.Mobile` (funciones estáticas) y `es.folio.mobile.EventSink`.

En `frontend/android/app/build.gradle`, dentro de `dependencies { … }`:
```gradle
implementation files('libs/folio-core.aar')
```

### D3. Plugin `FolioCore` (Kotlin)

`frontend/android/app/src/main/java/es/folio/app/FolioCorePlugin.kt`:
```kotlin
// Puente entre la interfaz y el núcleo Go: cada llamada se ejecuta en un hilo
// aparte (nunca en el principal) y los eventos del núcleo llegan a la interfaz.
package es.folio.app

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import es.folio.mobile.EventSink
import es.folio.mobile.Mobile
import java.io.File
import java.util.concurrent.Executors

@CapacitorPlugin(name = "FolioCore")
class FolioCorePlugin : Plugin() {
    private val worker = Executors.newSingleThreadExecutor()

    override fun load() {
        val ctx = context
        Mobile.setEventSink(object : EventSink {
            override fun emit(name: String, payloadJSON: String) {
                val e = JSObject()
                e.put("name", name)
                e.put("payload", payloadJSON)
                notifyListeners("event", e)
            }
        })
        val config = File(ctx.filesDir, "config").apply { mkdirs() }
        val workspace = File(ctx.filesDir, "Folio").apply { mkdirs() }
        worker.execute { Mobile.start(config.absolutePath, workspace.absolutePath, BuildConfig.VERSION_NAME) }
    }

    @PluginMethod
    fun call(call: PluginCall) {
        val method = call.getString("method") ?: return call.reject("Falta el método")
        val args = call.getString("args") ?: "[]"
        worker.execute {
            try {
                val out = JSObject()
                out.put("result", Mobile.call(method, args))
                call.resolve(out)
            } catch (e: Exception) {
                call.reject(e.message ?: "Error en $method")
            }
        }
    }

    override fun handleOnDestroy() {
        worker.execute { Mobile.stop() }
    }
}
```
> Un solo hilo de trabajo garantiza el orden de las llamadas (igual que en
> escritorio) y evita condiciones de carrera en el almacén.

Registra el plugin en `MainActivity.kt`:
```kotlin
package es.folio.app

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(FolioCorePlugin::class.java)
        super.onCreate(savedInstanceState)
        bridge.setWebViewClient(FolioWebViewClient(bridge))
        // Respetar el tamaño de letra del sistema
        bridge.webView.settings.textZoom = (resources.configuration.fontScale * 100).toInt()
    }
}
```
(Los demás plugins de las fases E–G se registran igual, antes de `super.onCreate`.)

### D4. Imágenes `/files/…` en el WebView

`frontend/android/app/src/main/java/es/folio/app/FolioWebViewClient.kt`:
```kotlin
// Sirve las imágenes de los documentos («/files/<doc>/<hash>.png») desde el
// espacio de trabajo, igual que el servidor de archivos de Wails en escritorio.
package es.folio.app

import android.webkit.MimeTypeMap
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import com.getcapacitor.Bridge
import com.getcapacitor.BridgeWebViewClient
import es.folio.mobile.Mobile
import java.io.File
import java.io.FileInputStream

open class FolioWebViewClient(bridge: Bridge) : BridgeWebViewClient(bridge) {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val path = request.url.path ?: return super.shouldInterceptRequest(view, request)
        if (!path.startsWith("/files/")) return super.shouldInterceptRequest(view, request)
        return try {
            val file = File(Mobile.assetPath(path))
            val ext = file.extension.lowercase()
            val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
            WebResourceResponse(mime, null, FileInputStream(file)).apply {
                responseHeaders = mapOf("Cache-Control" to "max-age=31536000, immutable")
            }
        } catch (e: Exception) {
            WebResourceResponse("text/plain", "utf-8", 404, "No encontrado", null, null)
        }
    }
}
```

### D5. Comprobación de la fase D

```bash
./build.sh android-debug   # o los comandos de D2 + C6 a mano
adb logcat | grep -i -E "folio|capacitor"
```
En el móvil: crea un documento, escribe, inserta una imagen (fase E para el selector; mientras, pega una imagen), cierra y vuelve a abrir la app: el documento sigue ahí con su imagen. La agenda guarda tareas y el plan funciona.

---

## Fase E. Archivos, compartir y abrir

**Objetivo:** sustituir los diálogos de escritorio por los del sistema Android
(Storage Access Framework) y la hoja de «Compartir».

### E1. Plugin `FolioFiles` (Kotlin)

Funciones del plugin:

| Método | Qué hace | Implementación |
|---|---|---|
| `pick({ mimeTypes: string[], multiple: boolean })` → `{ files: { path, name, size }[] }` | Elegir archivos | `Intent.ACTION_OPEN_DOCUMENT` (+ `EXTRA_ALLOW_MULTIPLE`). Copia cada `Uri` a `cacheDir/import/<nombre>` y devuelve esa ruta. |
| `saveAs({ path, name, mimeType })` → `{ saved: boolean }` | Guardar un archivo ya creado | `Intent.ACTION_CREATE_DOCUMENT` con `EXTRA_TITLE = name`; copia `path` al `Uri` elegido. |
| `share({ path, mimeType, title })` | Compartir | `FileProvider.getUriForFile` + `Intent.ACTION_SEND`. |
| `open({ path, mimeType })` | Abrir con otra app | `Intent.ACTION_VIEW` con `FileProvider` y `FLAG_GRANT_READ_URI_PERMISSION`. |
| `tempPath({ name })` → `{ path }` | Ruta temporal para escribir | `File(cacheDir, "out/" + name)`. |
| `consumeShared()` → `{ files }` | PDF recibidos con «Compartir con Folio» | Lee el `Intent` de arranque (`SEND`/`SEND_MULTIPLE`), copia a caché y lo vacía. |

Notas obligatorias:
- Usa `registerForActivityResult` mediante `startActivityForResult(call, intent, "callbackName")` y `@ActivityCallback` de Capacitor (no la API antigua `onActivityResult`).
- Declara el `FileProvider` en el manifiesto (`android:authorities="${applicationId}.fileprovider"`) con `res/xml/file_paths.xml` que incluya `<cache-path name="cache" path="." />` y `<files-path name="files" path="." />`.
- Copia los archivos en el hilo de trabajo, nunca en el principal.

### E2. `frontend/src/platform/android-overrides.ts`

Implementa con `FolioFiles` y las funciones de ruta del núcleo (A1.3) las funciones de `Backend` que en escritorio abren diálogos:

| Función de `Backend` | En Android |
|---|---|
| `ExportDocx(id, opt)` | `tempPath` → `core.ExportDocxTo(id, opt, tmp)` → `saveAs`. Devuelve el nombre o `''` si se cancela. |
| `SaveTextFile(name, content, …)` | `tempPath` → `core.WriteTextFile(tmp, content)` → `saveAs`. |
| `OpenImportFile()` | `pick({ mimeTypes: [docx, md, html, txt] })` → `core.ImportFromPath(path)`. |
| `ChoosePdfs()` | `pick({ mimeTypes: ['application/pdf'], multiple: true })` → `core.PdfInfo(paths)`. |
| `MergePdfs(items, opt)` | `tempPath('… (unido).pdf')` → `core.MergePdfsTo(items, tmp, opt.bookmarks)` → `saveAs`; si `opt.open`, `open`. |
| `ExportPDF(title, html)` | Fase F. |
| `RenderPdfTemp(title, html)` | Fase F (a una ruta temporal) → `core.PdfInfo`. |
| `ChooseWorkspace()` | Lanza un error con el texto «En Android los documentos se guardan dentro de la app; usa la sincronización para tenerlos en otros equipos.». La opción se oculta en Ajustes. |
| `OpenWorkspaceFolder()`, `RevealFile()` | `RevealFile(path)` → `share`. `OpenWorkspaceFolder` se oculta en Android. |
| `OpenURL(url)` | `window.open(url, '_system')`. |
| `ConfirmClose()` | No hace nada. |
| `Dictation*` | Fase G. |

Patrón de cada función:
```ts
export function androidOverrides(core: Backend): Partial<Backend> {
  return {
    async ExportDocx(id, opt) {
      const name = `${(await core.GetDoc(id)).meta.title || 'Documento'}.docx`;
      const { path } = await FolioFiles.tempPath({ name });
      await (core as any).ExportDocxTo(id, opt, path);
      const { saved } = await FolioFiles.saveAs({ path, name, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      return saved ? name : '';
    },
    // … el resto según la tabla
  };
}
```
Declara en `Backend` (en `api.ts`) las funciones nuevas del núcleo (`ExportDocxTo`, `WriteTextFile`, `ImportFromPath`, `MergePdfsTo`) para que TypeScript las conozca. En escritorio también existen (por la incrustación de A2), aunque no se usen.

### E3. «Compartir con Folio»

En `app.ts`, al arrancar en Android y al volver a primer plano (`App.addListener('appStateChange')` de `@capacitor/app`): `FolioFiles.consumeShared()`. Si hay PDF, abre `pdfMergeDialog(app, files)` (`ui/pdfmerge.ts`).

### E4. Comprobación de la fase E

En el móvil: importar un .docx; exportar a .docx y a Markdown (se guardan donde elijas); unir dos PDF elegidos con el selector y compartir el resultado; compartir un PDF desde la app Archivos hacia Folio abre «Unir PDF».

---

## Fase F. PDF e impresión en Android

### F1. Imprimir

Plugin `FolioPrint.print({ html, title })`: crea un `WebView` **fuera de pantalla**
(no añadido a la vista), carga el HTML con `loadDataWithBaseURL("https://localhost/", html, "text/html", "utf-8", null)`,
y en `onPageFinished` llama a:
```kotlin
val pm = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
pm.print(title, webView.createPrintDocumentAdapter(title), PrintAttributes.Builder().build())
```
El diálogo del sistema permite imprimir o «Guardar como PDF». En `ui/backstage.ts`,
en Android, el botón «Imprimir» usa este plugin en vez de `printHTML`.

> El HTML de exportación (`buildExportHTML` en `io.ts`) referencia imágenes como
> `/files/…`: con `baseURL https://localhost/` las sirve `FolioWebViewClient`
> **solo si el WebView fuera de pantalla usa también ese cliente**. Como es otro
> WebView (no el del puente), aquí sí se asigna directamente:
> `webView.webViewClient = object : FolioWebViewClient(bridge) { override fun onPageFinished(v: WebView, url: String) { … } }`
> (declara `FolioWebViewClient` como `open class`).

### F2. Exportar a un archivo PDF sin diálogo (para «Exportar» y «Unir PDF»)

Android no permite crear `PrintDocumentAdapter.LayoutResultCallback` fuera del
paquete `android.print`. La solución habitual es una clase Java en ese paquete,
dentro de la app:

`frontend/android/app/src/main/java/android/print/PdfWriter.java`:
```java
// Escribe en un archivo el PDF que genera un PrintDocumentAdapter (sin diálogo).
// Va en el paquete android.print porque sus callbacks solo se pueden crear ahí.
package android.print;

import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import java.io.File;

public class PdfWriter {
    public interface Done { void ok(); void fail(String message); }

    public static void write(PrintDocumentAdapter adapter, PrintAttributes attrs, File out, Done done) {
        adapter.onLayout(null, attrs, null, new PrintDocumentAdapter.LayoutResultCallback() {
            @Override public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                try {
                    ParcelFileDescriptor fd = ParcelFileDescriptor.open(out,
                        ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE | ParcelFileDescriptor.MODE_READ_WRITE);
                    adapter.onWrite(new PageRange[]{PageRange.ALL_PAGES}, fd, new CancellationSignal(),
                        new PrintDocumentAdapter.WriteResultCallback() {
                            @Override public void onWriteFinished(PageRange[] pages) {
                                try { fd.close(); } catch (Exception ignored) {}
                                done.ok();
                            }
                            @Override public void onWriteFailed(CharSequence error) { done.fail(String.valueOf(error)); }
                        });
                } catch (Exception e) { done.fail(e.getMessage()); }
            }
            @Override public void onLayoutFailed(CharSequence error) { done.fail(String.valueOf(error)); }
        }, null);
    }
}
```
Plugin `FolioPrint.toPdf({ html, path, paper: 'A4'|'A5'|'Letter'|'Legal', landscape })`:
1. WebView fuera de pantalla con `FolioWebViewClient`, `loadDataWithBaseURL`.
2. En `onPageFinished`, espera 300 ms (para que se apliquen fuentes e imágenes) y llama a:
   ```kotlin
   val media = when (paper) { "A5" -> PrintAttributes.MediaSize.ISO_A5; "Letter" -> PrintAttributes.MediaSize.NA_LETTER
       "Legal" -> PrintAttributes.MediaSize.NA_LEGAL; else -> PrintAttributes.MediaSize.ISO_A4 }
   val attrs = PrintAttributes.Builder()
       .setMediaSize(if (landscape) media.asLandscape() else media)
       .setResolution(PrintAttributes.Resolution("pdf", "pdf", 600, 600))
       .setMinMargins(PrintAttributes.Margins.NO_MARGINS).build()
   PdfWriter.write(webView.createPrintDocumentAdapter("folio"), attrs, File(path), done)
   ```
3. Resuelve la llamada en `done.ok()`; rechaza en `done.fail()`.

Los márgenes los pone el propio HTML de exportación (`@page` en `io.ts`), igual que en escritorio.

En `android-overrides.ts`:
- `ExportPDF(title, html)` → `tempPath` → `FolioPrint.toPdf` (papel y orientación de `app.doc.setup`) → `saveAs`.
- `RenderPdfTemp(title, html)` → `tempPath` → `FolioPrint.toPdf` → `core.PdfInfo([path])[0]` con `name = title`.

### F3. Comprobación de la fase F

Exporta a PDF un documento con imagen, ecuación y tabla, y compara con el PDF del
escritorio: mismas páginas, mismos saltos. «Unir PDF» con «Añadir este documento» funciona.

---

## Fase G. Dictado en Android

### G1. Plugin `FolioSpeech` (Kotlin)

| Método | Qué hace |
|---|---|
| `available()` → `{ onDevice: boolean, any: boolean }` | `SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx)` (API 31+) y `SpeechRecognizer.isRecognitionAvailable(ctx)`. |
| `start({ language: 'es-ES', partial: true })` | Pide `RECORD_AUDIO` si falta (`requestPermissionForAlias`). Crea el reconocedor: `createOnDeviceSpeechRecognizer` si está disponible; si no, `createSpeechRecognizer`. `Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)` con `EXTRA_LANGUAGE = "es-ES"`, `EXTRA_PREFER_OFFLINE = true`, `EXTRA_PARTIAL_RESULTS = true`, `EXTRA_MAX_RESULTS = 1`. Emite `notifyListeners("partial", { text })` y, al terminar, resuelve `{ text }`. |
| `stop()` | `recognizer.stopListening()` (se resuelve la llamada de `start` con el resultado final). |
| `cancel()` | `recognizer.cancel()` y rechaza `start` con «cancelado». |

Todas las llamadas al `SpeechRecognizer` deben hacerse en el **hilo principal**
(`activity.runOnUiThread { … }`), es obligatorio en Android. Errores del
reconocedor → mensajes en español:
`ERROR_NO_MATCH` → «No se ha entendido nada.»;
`ERROR_INSUFFICIENT_PERMISSIONS` → «Folio no tiene permiso para usar el micrófono.»;
`ERROR_LANGUAGE_UNAVAILABLE` / `ERROR_LANGUAGE_NOT_SUPPORTED` → «Falta el paquete de voz en español. Instálalo en Ajustes > Sistema > Idioma > Reconocimiento de voz sin conexión.».

### G2. Integración con la agenda

En `frontend/src/agenda/dictation.ts` (`class Dictation`):
- Si `isAndroid`, `ready()` comprueba `FolioSpeech.available()` en lugar del modelo de whisper (sin descarga).
- `start()` llama a `FolioSpeech.start()`. Mientras, muestra el mismo indicador (`showOverlay`) con el texto parcial que llega por el evento `partial`.
- `stop()` llama a `FolioSpeech.stop()` y pasa el texto a `onText`.
- El atajo «mantén Ctrl+Mayús+Espacio» no aplica en el móvil: el **botón de micrófono** del botón flotante (fase H) funciona como «mantén pulsado para hablar» (pointerdown → start, pointerup → stop) y como alternancia con un toque.

### G3. Comprobación de la fase G

Con el móvil en modo avión: mantén el micrófono, di «mañana a las nueve repaso del tema doce durante media hora» y suelta: aparece la vista previa con fecha, hora, duración, tipo y tema correctos.

### G4. (Opcional, más adelante) whisper.cpp en Android

Solo si el reconocimiento del sistema no es suficiente: compilar whisper.cpp
con el NDK (su ejemplo `examples/whisper.android`) como librería JNI y añadir
`FolioSpeech.transcribeWav`. No forma parte de esta guía.

---

## Fase H. Interfaz móvil

**Objetivo:** la misma app con estructura, tamaños y gestos de móvil. El
escritorio no cambia: todo va en `frontend/src/mobile/` y en reglas bajo
`body.is-mobile`.

### H1. Principios de diseño móvil (comprobar en cada pantalla)

1. **Una tarea por pantalla.** Lista → detalle, con «atrás» siempre disponible
   (botón de la barra y botón/gesto atrás de Android).
2. **Zona del pulgar:** acciones principales abajo (barra de navegación, botón
   flotante, barra de formato sobre el teclado). Arriba solo título y acciones secundarias.
3. **Objetivos táctiles ≥ 48 × 48 dp** y separación ≥ 8 dp.
4. **Texto base 16 px** (evita el zoom automático al enfocar campos), interlineado 1,5.
5. **Misma identidad que el escritorio:** fuente Inter, superficies tranquilas,
   acento `--accent`, tipos de la agenda con color + icono + trama. Esquinas 12 px
   en tarjetas y 20 px en la parte superior de las hojas inferiores.
6. **Movimiento sobrio:** 200 ms, `ease-out`; sin animaciones si
   `prefers-reduced-motion`.
7. **Accesible con TalkBack:** todo control tiene nombre (`aria-label`), el orden
   de foco sigue el visual y los cambios importantes se anuncian (`aria-live`).

### H2. Activar la interfaz móvil

En `frontend/src/main.ts`, antes de `new App()`:
```ts
import { wantsMobileUI } from './platform/platform';
if (wantsMobileUI()) document.body.classList.add('is-mobile');
```
En `App.start()` (`app.ts`), tras montar la interfaz:
```ts
if (document.body.classList.contains('is-mobile')) {
  const { MobileShell } = await import('./mobile/shell');
  this.mobile = new MobileShell(this);
}
```
Para probar en el navegador del ordenador: `npm run dev` y abrir
`http://localhost:5173/?mobile` con la emulación de dispositivo de Chrome.

### H3. Estructura (`frontend/src/mobile/shell.ts`)

```
┌──────────────────────────────┐
│ Barra superior (56 dp)       │  ← atrás · título · acciones (máx. 2 + «más»)
├──────────────────────────────┤
│                              │
│     Pantalla actual          │
│                              │
│                       [ + ]  │  ← botón flotante (56 dp) en listas y agenda
├──────────────────────────────┤
│ Documentos · Agenda · Buscar · Más │  ← barra de navegación (80 dp, con etiquetas)
└──────────────────────────────┘
```

`MobileShell` crea:
- `appBar`: `<header class="m-appbar">` con botón atrás (icono `arrowLeft`), `<h1>` y una ranura de acciones.
- `bottomNav`: `<nav class="m-nav" aria-label="Secciones">` con 4 botones (`docs`, `calendar`, `search`, `more`) con icono y etiqueta.
- `fab`: `<button class="m-fab">`.
- Una **pila de pantallas** (`push(screen)`, `pop()`), cada una con `{ title, el, actions?, fab?, onBack? }`.
- La **pila de «atrás»** (H9).

Y oculta lo de escritorio con CSS (`frontend/src/mobile/mobile.css`):
```css
body.is-mobile .topbar, body.is-mobile #ribbon, body.is-mobile #statusbar,
body.is-mobile .sidebar, body.is-mobile .sidebar-resizer, body.is-mobile .block-handle,
body.is-mobile .ag-head .ag-tools, body.is-mobile .win-controls { display: none !important; }
body.is-mobile { font-size: 16px; padding: env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left); }
.m-appbar { height: 56px; display: flex; align-items: center; gap: 4px; padding: 0 4px; background: var(--chrome); border-bottom: 1px solid var(--chrome-line); }
.m-appbar h1 { flex: 1; margin: 0 8px; font-size: 18px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.m-nav { height: calc(64px + env(safe-area-inset-bottom)); padding-bottom: env(safe-area-inset-bottom); display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid var(--border); background: var(--chrome); }
.m-nav button { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; font-size: 12px; color: var(--text-muted); min-height: 48px; }
.m-nav button.on { color: var(--accent); font-weight: 600; }
.m-fab { position: fixed; right: 16px; bottom: calc(80px + env(safe-area-inset-bottom)); width: 56px; height: 56px; border-radius: 16px; background: var(--accent); color: #fff; box-shadow: var(--shadow-pop); display: grid; place-items: center; z-index: 30; }
body.is-mobile .icon-btn { width: 44px; height: 44px; }
body.is-mobile .btn { height: 44px; padding: 0 16px; font-size: 15px; }
body.is-mobile .input { height: 44px; font-size: 16px; }
```
(Los valores son de partida: ajústalos mirando capturas, § L2.)

### H4. Sección Documentos

**Pantalla «Lista de documentos»** (`mobile/doclist.ts`)
- Buscador fijo arriba (filtra títulos al escribir; «Buscar dentro» abre la búsqueda de la sección Buscar).
- Secciones «Favoritos» y «Documentos». Cada fila (≥ 56 dp): icono, título, fecha relativa (`relTime` de `ui/dom.ts`) y, si tiene hijos, flecha `chevronRight`.
- Tocar un documento con hijos abre **su** lista (navegación por niveles, título = nombre del documento, primera fila «Abrir este documento»). Tocar uno sin hijos lo abre.
- Pulsación larga (500 ms, con `@capacitor/haptics`) en una fila → hoja de acciones: Abrir, Favorito, Cambiar icono, Duplicar, Mover a…, Mover a la papelera. Reutiliza las funciones de `ui/sidebar.ts` (`app.duplicate`, `app.trash`, `app.updateMeta`).
- Botón flotante **+** → hoja «Nuevo»: Documento en blanco + plantillas (`TEMPLATES` de `templates.ts`).

**Pantalla «Editor»** (`mobile/editorscreen.ts`)
- Reutiliza el editor existente: mueve el elemento `#scroller` (con `.page`) dentro de la pantalla. **No** crees otro editor.
- Barra superior: atrás, título del documento (toca para renombrar), deshacer y menú «más» (Exportar, Imprimir, Versiones, Comentarios, Esquema, Buscar y reemplazar, Configurar página, Vista de hojas, Vista del alumnado).
- Por defecto, **vista de lectura** (`settings.pageView = false` la primera vez en el móvil) con márgenes de 16 px; en el menú, «Ver como hojas» activa la vista de página con `zoomFit` (ya existe).
- Paneles (versiones, comentarios, esquema) y buscar/reemplazar → **pantallas completas** apiladas (`push`), con el mismo contenido que en escritorio (`ui/panels.ts`, `ui/findbar.ts`).

**Barra de formato sobre el teclado** (`mobile/formatbar.ts`)
- Visible solo con el editor enfocado. Se coloca justo encima del teclado con `window.visualViewport`:
  ```ts
  const vv = window.visualViewport!;
  const place = () => { bar.style.bottom = `${window.innerHeight - vv.height - vv.offsetTop}px`; };
  vv.addEventListener('resize', place); vv.addEventListener('scroll', place);
  ```
- Fila con desplazamiento horizontal, botones de 44 dp, en este orden:
  **Aa** (hoja de estilos) · **N/B** · **K/I** · **S/U** · viñetas · numeración · tareas · sangría − · sangría + · **+** (hoja «Insertar») · ecuación · imagen · deshacer · rehacer · ocultar teclado.
- Cada botón llama a `app.run(acción)` (las mismas acciones que los atajos) y refleja su estado (`aria-pressed`) en cada `selectionUpdate` del editor.
- **Hoja «Aa»:** estilos (Normal, Título 1-3, Cita, Código), fuente (`FontPicker`), tamaño, color y resaltado, alineación e interlineado. Reutiliza los controles de `ui/ribbon.ts`: extrae a funciones exportables las piezas que hagan falta, sin duplicar lógica.
- **Hoja «Insertar»:** la lista `BLOCKS` de `editor/blocks.ts` agrupada por `group`, con búsqueda. El menú «/» del editor sigue funcionando igual.
- **Asa de bloque en el móvil:** sin asa al pasar el ratón; una **pulsación larga sobre un bloque** abre el mismo menú del asa (convertir, duplicar, mover, eliminar). Implementa `BlockHandle.openMenuAt(pos)` en `ui/blockhandle.ts` y llámalo desde un detector de pulsación larga en `mobile/`.

### H5. Sección Agenda

La agenda ya es independiente (`frontend/src/agenda/`); en el móvil cambia su cabecera y añade una vista.

- **Barra superior:** título = mes y año visibles (tocar → selector de mes con la cuadrícula de `views/year.ts` en una hoja). Acciones: «Hoy» e «Ir a».
- **Selector de vista** bajo la barra (segmentado, 44 dp): **Lista · Día · 3 días · Mes · Año**.
  - Añade `ViewKind = 'list' | '3days'` en `agenda/model.ts` y en `AgendaView`. Por defecto en el móvil: `list`.
  - **Lista** (nueva, `agenda/views/list.ts`): días seguidos desde hoy (carga de 14 en 14 al desplazar), cada día con su cabecera fija («Hoy · martes, 27 de octubre») y sus tareas como filas de 56 dp (casilla de hecha, hora, chip con tipo y título). Los días sin tareas se agrupan («Sin tareas del 3 al 5 de nov.»).
  - **3 días:** `renderTimeGrid` con 3 columnas (el día del cursor y los dos siguientes).
  - **Mes:** celdas con **puntos** de color + forma (en vez de chips) y, debajo de la cuadrícula, la lista del día seleccionado.
- **Gestos** (`agenda/gestures.ts`, eventos `pointer*`):
  - Deslizar horizontalmente > 60 px (o > 0,3 px/ms) → período anterior/siguiente (`view.step(±1)`), con una transición de 200 ms.
  - Tocar un hueco de la rejilla → nueva tarea a esa hora.
  - Pulsación larga en un bloque (500 ms + vibración corta) → modo arrastre: mover arriba/abajo y a otro día. La duración se cambia con el tirador inferior, que en el móvil mide 16 px de alto.
  - Las acciones de teclado y lectores de pantalla siguen disponibles (TalkBack: doble toque para abrir, acciones personalizadas con `aria-describedby` que explica «Desliza con dos dedos para cambiar de semana»).
- **Botón flotante +:** un toque abre la **hoja de creación rápida** (barra rápida `QuickAdd` a pantalla completa con la vista previa debajo). Mantener pulsado → dictado («mantén para hablar», fase G).
- **Selección de varios días** (mes y año): pulsación larga en un día activa la selección; tocar otros días los añade; la barra de selección (`.ag-selbar`) aparece encima de la barra de navegación.
- **Temario, Plan y Progreso:** desde «Más» → «Estudio», como pantallas completas (los diálogos actuales en modo hoja, H6).

### H6. Diálogos como hojas

En el móvil, `modal()` (`ui/dom.ts`) debe mostrarse como **hoja a pantalla
completa** salvo las confirmaciones cortas. Sin tocar las llamadas existentes:

```css
body.is-mobile .modal-backdrop { padding: 0; place-items: end stretch; }
body.is-mobile .modal { width: 100%; max-height: 100%; height: 100%; border-radius: 0; padding-bottom: env(safe-area-inset-bottom); }
body.is-mobile .modal.is-small { height: auto; border-radius: 20px 20px 0 0; }
body.is-mobile .modal-head { position: sticky; top: 0; background: var(--bg-elev); padding-top: calc(10px + env(safe-area-inset-top)); }
body.is-mobile .modal-foot { position: sticky; bottom: 0; background: var(--bg-elev); }
body.is-mobile .modal-foot .btn { flex: 1; }
```
En `modal()`, añade la clase `is-small` cuando el cuerpo sea un único `<p>` (confirmaciones) y registra el cierre en la pila de «atrás» (H9).

Formularios con varias columnas (`.ag-row`, `.ag-days-row`, `.ag-topic-row`, `.pm-row`) pasan a una columna:
```css
body.is-mobile .ag-row { flex-direction: column; }
body.is-mobile .ag-days-row { grid-template-columns: 1fr 1fr; }
body.is-mobile .ag-topic-row { grid-template-columns: 56px 1fr 44px; }
body.is-mobile .ag-topic-row > :nth-child(n+3):not(:last-child) { display: none; }
```
En el temario del móvil, tocar una fila abre una hoja con todos sus campos (bloque, extensión, apuntes).

### H7. Sección Buscar

Pantalla con un campo de búsqueda grande que usa `api.Search(q)` (documentos) y
los comandos de la paleta (`ui/palette.ts`): reutiliza su lógica de
`commandItems`. Resultados en dos grupos: «En tus documentos» y «Acciones».

### H8. Sección Más

Lista de entradas (56 dp) que abren pantallas o diálogos ya existentes:
Plantillas · Importar · Unir PDF · **Estudio** (Temario, Plan, Progreso, Semanas tipo, Tipos) · **Sincronización** (fase I) · Ajustes · Papelera · Tutoriales · Atajos (solo con teclado físico) · Acerca de Folio.

### H9. Botón «atrás» de Android

`frontend/src/mobile/back.ts`:
```ts
// Pila de «atrás»: el botón o gesto atrás de Android cierra lo último abierto
// (menú, hoja, diálogo, pantalla); con la pila vacía, sale de la app.
import { App as CapApp } from '@capacitor/app';

const stack: (() => void)[] = [];
export function pushBack(close: () => void): () => void {
  stack.push(close);
  return () => { const i = stack.lastIndexOf(close); if (i >= 0) stack.splice(i, 1); };
}
export function initBack() {
  void CapApp.addListener('backButton', () => {
    const close = stack.pop();
    if (close) close(); else void CapApp.exitApp();
  });
}
```
Úsalo en `modal()`, `popupMenu()`, las hojas y `MobileShell.push()`. Antes de salir, `app.flush()`.

### H10. Teclado, barras del sistema y tema

- `@capacitor/keyboard`: en `Keyboard.addListener('keyboardWillShow')` añade `body.keyboard-open` (oculta la barra de navegación y el botón flotante mientras se escribe).
- `@capacitor/status-bar`: color y estilo según el tema (`StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light })`) en `app.applyTheme()`.
- Android 15 dibuja la app de borde a borde: los márgenes `env(safe-area-inset-*)` de H3 ya lo cubren. Comprueba en un dispositivo con barra de gestos y en otro con botones.

### H11. Rendimiento en el móvil

- La paginación (`ui/paginator.ts`) solo se calcula en la vista de hojas.
- Carga diferida de KaTeX, mammoth y pdf ya existe: no la cambies.
- Las listas de más de 200 filas (documentos, temario, lista de la agenda) se dibujan en tramos al desplazar (`IntersectionObserver`).

### H12. Comprobación de la fase H

Ver § L2 (capturas automáticas) y § L3 (en el dispositivo). Criterios:
- Ninguna pantalla tiene desplazamiento horizontal a 360 dp de ancho.
- Todos los botones miden al menos 44 × 44 px en las capturas.
- El botón atrás cierra siempre lo último que se abrió.
- Escribir un documento de una página entera con la barra de formato, sin ver la cinta, es cómodo.

---

## Fase I. Sincronización en la nube

**Objetivo:** que la app de escritorio (Windows y Linux) y la de Android
compartan documentos y agenda a través de una nube del usuario, sin perder
nunca datos.

### I1. Conceptos

- **Proveedor:** dónde se guardan los datos (WebDAV o Google Drive).
- **Carpeta remota:** `Folio/` en el proveedor, con la misma disposición que el espacio de trabajo (§ 2.2).
- **Estado de sincronización** (local, por dispositivo): `<espacio>/.folio-sync/state.json` y copias base en `<espacio>/.folio-sync/base/…`. **Nunca** se sube.
- **Identificador de dispositivo:** `deviceId` aleatorio y `deviceName` («Portátil de Alejandro», «Android»), guardados en `Settings`.
- **Vincular** = configurar el mismo proveedor y la misma carpeta en cada dispositivo.

### I2. Paquete `internal/sync`

Archivos:

| Archivo | Contenido |
|---|---|
| `provider.go` | `type Provider interface` y `type RemoteFile`. |
| `webdav.go` | Proveedor WebDAV con `net/http` (sin librerías externas). |
| `gdrive.go` | Proveedor Google Drive (API REST v3). |
| `engine.go` | Algoritmo de sincronización (I3). |
| `merge.go` | Fusiones por tipo de archivo (I4). |
| `state.go` | Lectura y escritura del estado. |
| `engine_test.go` | Pruebas con un proveedor en memoria (I8). |

```go
// RemoteFile es un archivo de la carpeta remota.
type RemoteFile struct {
	Path string // relativo a la carpeta remota, con «/»
	Rev  string // ETag (WebDAV) o md5Checksum (Drive): cambia si cambia el contenido
	Size int64
}

// Provider es el mínimo que necesita el motor de cualquier nube.
type Provider interface {
	Name() string
	List(ctx context.Context) ([]RemoteFile, error)                 // recursivo
	Get(ctx context.Context, path string) ([]byte, string, error)    // contenido y Rev
	Put(ctx context.Context, path string, data []byte, ifRev string) (string, error) // crea carpetas si faltan; ifRev "" = sin condición
	Delete(ctx context.Context, path string, ifRev string) error
}

var ErrConflict = errors.New("el archivo remoto ha cambiado") // Put/Delete con ifRev desactualizado
```

### I3. Algoritmo (engine.go)

`func (e *Engine) Sync(ctx context.Context) (Report, error)`; solo una sincronización a la vez (`sync.Mutex`; si ya hay una en curso, devuelve sin hacer nada).

1. **Inventario local:** recorre el espacio de trabajo **excluyendo** `.folio-sync/`, `.tmp-*`, archivos que empiecen por `.`, y `agenda-practica/`. Para cada archivo: ruta relativa con `/`, hash SHA-256 y tamaño.
2. **Inventario remoto:** `provider.List`.
3. Para cada ruta de la unión, con `B` = estado guardado (`hash` local y `rev` remota de la última sincronización):

   | Local frente a `B.hash` | Remoto frente a `B.rev` | Acción |
   |---|---|---|
   | igual | igual | nada |
   | cambiado o nuevo | igual | **subir** (`Put` con `ifRev = B.rev`) |
   | borrado | igual | **borrar remoto** (`Delete` con `ifRev = B.rev`) |
   | igual | cambiado o nuevo | **bajar** (escritura atómica con `fsutil.WriteFileAtomic`) |
   | igual | borrado | **borrar local** |
   | cambiado | cambiado | **fusionar** (I4): bajar, fusionar con el local y la base, escribir local, subir con `ifRev` = la rev bajada |
   | nuevo | nuevo (sin `B`) | si los hashes coinciden, solo registrar; si no, **fusionar** con base vacía |
   | borrado | cambiado | **bajar** (gana el cambio: nunca se pierden datos) |
   | cambiado | borrado | **subir** (ídem) |

4. Si `Put`/`Delete` devuelve `ErrConflict`, ese archivo se deja para la siguiente pasada; el motor repite (máx. 3 pasadas) la fase 3 solo con los archivos en conflicto.
5. Tras cada operación correcta, guarda en el estado `hash`, `rev` y, para los archivos fusionables (I4), una **copia base** en `.folio-sync/base/<ruta>`.
6. Antes de sobrescribir un archivo local, vuelve a calcular su hash: si ha cambiado desde el inventario (el usuario siguió escribiendo), sáltalo en esta pasada.
7. Al terminar: si cambió algún archivo local, el núcleo **recarga** el almacén y la agenda (`store.Open`, `agenda.Open`) y emite `sync:changed` con `{ docs: [ids], agenda: bool }`. Emite `sync:progress` (`hecho`, `total`) durante el proceso y `sync:done` con el informe.

El estado se guarda con `fsutil.WriteJSON` al final de cada archivo procesado (si se corta la conexión, la siguiente sincronización continúa donde iba).

### I4. Reglas de fusión por tipo de archivo (merge.go)

`func Merge(path string, base, local, remote []byte, ctx MergeContext) (merged []byte, extra []Extra, err error)`.
`MergeContext` lleva `DeviceName` y la hora. `Extra` son efectos adicionales (por ejemplo, «guarda esta versión en el historial»).

| Ruta | Regla |
|---|---|
| `docs/*/files/*`, `docs/*/versions/*.json.gz` | Nombres por hash: el contenido no cambia nunca. Si ambos existen, se queda cualquiera (son iguales). |
| `docs/*/versions/index.json` | Unión por `id` de versión, ordenada por `created`. |
| `docs/*/meta.json` | Gana el de `updated` más reciente. Excepción: si uno pasa `trashed` a `true` y el otro solo cambió el orden o el favorito, se respeta la papelera. |
| `docs/*/content.json` (+ `content.txt`) | Gana el de `meta.updated` más reciente. **El perdedor se guarda como versión** del documento con la etiqueta «Conflicto · versión de ‹dispositivo› (‹fecha›)»: `Extra{Kind: "version", DocID, Content, Text, Label}`, que el núcleo aplica con un método nuevo `store.ImportVersion(id, content, text, label)`. |
| `agenda/tasks/AAAA-MM.json` | Fusión a tres bandas **por `id` de tarea**: añadida en un lado → se añade; borrada en un lado y sin cambios en el otro → se borra; cambiada en ambos → gana el `updated` más reciente. En las series, `repeat.except` y `repeat.done` se **unen** (conjuntos). |
| `agenda/sessions/AAAA-MM.jsonl` | Unión por `id` de sesión (las sesiones no se editan). Borrada en un lado y presente en la base → se borra. |
| `agenda/topics.json` | Por `id` como las tareas. Para `memory` (FSRS) gana la que tenga `LastReview` más reciente; si empatan, la de más `Reps`. `studied`: la fecha más antigua. |
| `agenda/types.json`, `agenda/templates.json` | Por `id`; en conflicto, gana el lado local y se avisa en el informe. |
| `agenda/settings.json` | Gana el más reciente (fecha de modificación del archivo guardada en el estado). |
| Cualquier otro archivo | Gana el más reciente; el otro se guarda junto a él como `nombre (conflicto ‹dispositivo›).ext`. |

Todas estas reglas tienen test (I8). La base vacía (primera sincronización)
convierte la fusión en una unión: es seguro porque todos los identificadores son aleatorios.

**Agenda:** la pila de «deshacer» (`agenda.Store.undo`) se vacía tras una sincronización que cambie la agenda (deshacer después de traer cambios de otro dispositivo sería peligroso).

### I5. Proveedor WebDAV (Nextcloud, ownCloud, Synology, etc.)

Configuración: URL del servidor (por ejemplo
`https://nube.ejemplo.es/remote.php/dav/files/USUARIO/`), usuario y
**contraseña de aplicación** (en Nextcloud: Ajustes > Seguridad > Contraseñas de aplicación).

- `List`: `PROPFIND` con `Depth: 1`, recorriendo carpetas (no uses `Depth: infinity`: muchos servidores lo desactivan). Cuerpo de la petición:
  ```xml
  <?xml version="1.0" encoding="utf-8"?>
  <d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>
  ```
  Respuesta `207 Multi-Status`: decodifica con `encoding/xml` en
  `type multistatus struct { Responses []struct { Href string `xml:"href"`; Props []struct { Etag string `xml:"prop>getetag"`; Length int64 `xml:"prop>getcontentlength"`; Collection *struct{} `xml:"prop>resourcetype>collection"` } `xml:"propstat"` } `xml:"response"` }`.
  Convierte `href` (URL codificada) en ruta relativa con `url.PathUnescape` y quita el prefijo de la carpeta.
- `Get`: `GET`; la rev es la cabecera `ETag`.
- `Put`: `MKCOL` de cada carpeta que falte (405 = ya existe), luego `PUT` con `If-Match: <rev>` si `ifRev != ""`, o `If-None-Match: *` si el archivo debe ser nuevo. `412 Precondition Failed` → `ErrConflict`. La rev nueva sale de la cabecera `ETag` de la respuesta; si no viene, haz `PROPFIND` del archivo.
- `Delete`: `DELETE` con `If-Match`; `404` = ya no existe (correcto).
- Autenticación: `req.SetBasicAuth`. Siempre HTTPS (rechaza `http://` salvo `localhost`).
- Tiempo de espera: 30 s por petición; reintenta 3 veces con espera exponencial ante 5xx o errores de red.

### I6. Proveedor Google Drive

- Ámbito OAuth: **`https://www.googleapis.com/auth/drive.file`** (solo los archivos que crea Folio; el usuario ve la carpeta «Folio» en su Drive).
- Estructura: una carpeta `Folio` (se busca por nombre y `appProperties.folio = "root"`; si no existe, se crea) y subcarpetas reales que reproducen la disposición. Guarda en el estado un mapa `ruta → fileId` para no buscar cada vez.
- `List`: `GET https://www.googleapis.com/drive/v3/files?q='<id>' in parents and trashed=false&fields=nextPageToken,files(id,name,mimeType,md5Checksum,size)&pageSize=1000` recorriendo carpetas. Rev = `md5Checksum`.
- `Get`: `GET …/files/<id>?alt=media`.
- `Put` (archivo nuevo): `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,md5Checksum` con metadatos `{ name, parents: [carpeta] }`.
  `Put` (existente): `PATCH https://www.googleapis.com/upload/drive/v3/files/<id>?uploadType=media&fields=md5Checksum`. Drive no tiene `If-Match`: **antes** de subir, lee `md5Checksum` (`GET …/files/<id>?fields=md5Checksum`) y si no coincide con `ifRev`, devuelve `ErrConflict`.
- `Delete`: mueve a la papelera (`PATCH …/files/<id>` con `{ "trashed": true }`) para que se pueda recuperar.
- Límites: 429/403 `rateLimitExceeded` → espera exponencial (1, 2, 4, 8 s).
- **Token:** el proveedor recibe un `func(ctx) (string, error)` que devuelve un token de acceso válido. Lo da cada plataforma (I7).

### I7. Vincular cuentas en cada plataforma

**Lo que tiene que hacer el usuario (no lo hagas tú):** crear un proyecto en
Google Cloud Console, activar la API de Google Drive, configurar la pantalla de
consentimiento («Folio», ámbito `drive.file`) y crear dos IDs de cliente OAuth:
**«App de escritorio»** y **«Android»** (paquete `es.folio.app` + huella SHA-1
del certificado de firma, § M). Los IDs se ponen en `internal/sync/oauth_ids.go`:
```go
// IDs públicos de los clientes OAuth de Folio (no son secretos en apps instaladas).
const GoogleDesktopClientID = "…apps.googleusercontent.com"
const GoogleDesktopClientSecret = "…" // Google lo exige para «App de escritorio»; no es confidencial
```

**Escritorio (Go):**
- Flujo OAuth para apps instaladas con **PKCE** y redirección a `http://127.0.0.1:<puerto libre>/oauth`: abre el navegador con `OpenURL`, levanta un `http.Server` temporal que recibe el `code`, lo canjea por `access_token` + `refresh_token`.
- El `refresh_token` se guarda en el **almacén de credenciales del sistema** con `github.com/zalando/go-keyring` (servicio `Folio`, usuario `gdrive` o `webdav:<url>`). La contraseña de WebDAV, igual. **Nunca** en `settings.json`.

**Android (Kotlin):**
- Google Drive: `Identity.getAuthorizationClient(activity).authorize(AuthorizationRequest.builder().setRequestedScopes(listOf(Scope("https://www.googleapis.com/auth/drive.file"))).build())` (Google Play services, dependencia `com.google.android.gms:play-services-auth`). Si devuelve `hasResolution()`, lanza el `PendingIntent`; el resultado trae `accessToken`. Plugin `FolioAuth.googleToken()` → `{ token }`. El núcleo pide el token por un evento y la interfaz se lo pasa (`core.SetAccessToken(token)`); al caducar (401), se pide otro en silencio.
- WebDAV: la contraseña se guarda con `EncryptedSharedPreferences` (AndroidX Security) en el plugin `FolioSecrets` (`get`, `set`, `remove`), y se pasa al núcleo al iniciar la sincronización.

**Pantalla «Sincronización»** (Ajustes en escritorio; Más en Android), `frontend/src/ui/syncsettings.ts`:
1. Estado: «Sin vincular» / «Vinculado con ‹proveedor› · última sincronización hace 2 min» / error con explicación y botón «Reintentar».
2. «Vincular con Google Drive» → flujo de I7.
3. «Vincular con Nextcloud u otro WebDAV» → formulario (URL, usuario, contraseña de aplicación) → «Probar conexión» (`PROPFIND` a la raíz) → crear o elegir la carpeta `Folio`.
4. «Nombre de este dispositivo».
5. «Vincular otro dispositivo»: muestra un **código QR** con `{"p":"webdav","u":"<url>","n":"<usuario>","f":"Folio"}` (sin contraseña) o, para Drive, el texto «Inicia sesión con la misma cuenta de Google en el otro dispositivo». En Android, «Escanear código» con `@capacitor-mlkit/barcode-scanning`. Para el QR en escritorio usa la librería `qrcode-generator` (npm, sin dependencias).
6. «Sincronizar ahora», «Desvincular» (no borra nada; solo olvida credenciales y estado).
7. **Primera vinculación** con datos en los dos lados: aviso «Se juntarán los documentos de este dispositivo con los de la nube. No se borra nada.» Si el remoto ya tiene datos, **no** se crea la «Guía rápida» de bienvenida en el dispositivo nuevo.

### I8. Cuándo se sincroniza

- Al abrir la app y al volver a primer plano (Android: `appStateChange`; escritorio: `visibilitychange`).
- 30 s después del último guardado (`App.save()`), agrupando cambios.
- Cada 5 minutos con la app abierta.
- Al cerrar la app de escritorio, tras `flush()` (máx. 10 s; si no termina, se cierra igual y se termina en la siguiente).
- Siempre **después** de `app.flush()`, para no subir medio documento.

En la interfaz:
- Indicador en la barra de estado (escritorio) o en la barra superior (móvil): icono de nube con el estado (sincronizado / sincronizando / sin conexión / error) y texto alternativo.
- Al recibir `sync:changed`: `app.refreshDocs()`; si el documento abierto está en `docs` y **no** tiene cambios sin guardar, recárgalo (`api.GetDoc` + `loadContent`) conservando el desplazamiento; si tiene cambios, no lo toques: la siguiente sincronización resolverá con la regla de conflictos (la versión perdedora queda en el historial). Si `agenda` es `true`, `app.agenda.state.load()` y `emit('agenda:changed')`.

### I9. Preparado para cifrado (no se implementa ahora)

Deja en `Provider` un envoltorio opcional `Encrypted(Provider, key)` que cifre `data` en `Put` y descifre en `Get` (XChaCha20-Poly1305 con clave derivada de una frase con Argon2id). No lo actives en esta guía.

### I10. Pruebas obligatorias (`internal/sync/engine_test.go`)

Proveedor en memoria (`memProvider`, con revs incrementales y `ErrConflict`). Casos:
1. Primera sincronización de A (sube todo); B vacío baja todo; contenido idéntico.
2. A edita un documento; B sincroniza y lo recibe.
3. A y B editan el **mismo** documento: gana el más reciente y el otro aparece en `versions/index.json` con la etiqueta de conflicto.
4. A borra un documento sin cambios en B: B lo borra. A lo borra mientras B lo edita: el documento **sobrevive** en los dos.
5. Agenda: A añade una tarea y B otra en el mismo mes → ambas existen. A borra una tarea que B no tocó → desaparece en B. A y B cambian la misma tarea → gana el `updated` más reciente. A marca hecha una ocurrencia de una serie y B otra → ambas hechas.
6. Temario: A valora un tema (FSRS) y B cambia su título → se conservan el título de B y la memoria de A.
7. Corte a mitad (el proveedor falla tras 3 archivos): la siguiente sincronización termina sin duplicar ni perder nada.
8. `ErrConflict` en `Put`: se reintenta y converge.
9. Archivos excluidos (`.folio-sync/`, `agenda-practica/`) no se suben nunca.

Y un test de integración de WebDAV con un servidor de prueba en Go (`golang.org/x/net/webdav` + `httptest`).

### I11. Comprobación de la fase I

```bash
go test ./internal/sync/ -v
```
Prueba manual con dos instalaciones (escritorio y Android) y una cuenta de prueba:
1. Vincula ambos a la misma carpeta.
2. Crea un documento en el escritorio → aparece en Android en < 1 min (con la app abierta).
3. Edita el mismo documento en ambos **sin conexión** en Android; reconecta → el más reciente gana y el otro está en «Versiones».
4. Crea tareas en ambos, valora un repaso en Android → el plan del escritorio lo refleja tras sincronizar.

---

## Fase J. Avisos de la agenda

Solo Android (en escritorio no se añade nada).

1. `@capacitor/local-notifications`. Canal `agenda` («Agenda de estudio», importancia por defecto).
2. Pide permiso (`LocalNotifications.requestPermissions()`) la primera vez que el usuario active «Avisarme antes de cada tarea» en Ajustes de la agenda (nuevo ajuste `remindMinutes`: 0 = desactivado, 5, 10, 15, 30).
3. Cada vez que cambie la agenda (`agenda:changed`), cancela los avisos de Folio y programa los de los **próximos 7 días**: uno por tarea con hora y sin hacer, `remindMinutes` antes. Título: tipo + título; texto: «A las 17:00 · 50 min». Id numérico estable: hash de `task.id` (32 bits positivos).
4. Al tocar el aviso, la app abre la agenda en el día de la tarea (`LocalNotifications.addListener('localNotificationActionPerformed')`).
5. Acción rápida «Hecha» en el aviso → `state.setDone(id, true)`.

---

## Fase K. Tutoriales en el móvil

El motor de `ui/tour.ts` sirve igual: resalta un elemento y muestra una tarjeta.

1. En el móvil, la tarjeta se coloca **siempre** en la mitad de la pantalla opuesta al elemento resaltado, a todo el ancho menos 16 px por lado.
2. Pasos del tutorial de documentos adaptados: «La barra de formato» (en vez de «La cinta»), «Insertar con +», «Pulsación larga en un bloque», «Exportar desde el menú ⋮». Los pasos que hablan de atajos de teclado se omiten si no hay teclado físico (`matchMedia('(pointer: fine)')` falso).
3. Tutorial de la agenda: crear con el botón +, mantener pulsado para dictar, deslizar para cambiar de semana, pulsación larga para mover, marcar hecha y valorar, temario y plan.
4. Igual que en escritorio: la práctica es aislada (`AgendaPractice(true/false)`, documento de práctica) y se borra al terminar.
5. Accesibles desde Más > Tutoriales.

---

## Fase L. Pruebas y calidad

### L1. Siempre

```bash
go vet ./... && go test ./...
(cd frontend && npx tsc --noEmit && npm run build)
```

### L2. Capturas automáticas de la interfaz móvil (Playwright)

Crea `frontend/tests/mobile-shots.mjs` (Playwright con Chrome del sistema), que
abre `http://localhost:5173/?mobile` con `viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.75`, recorre:
lista de documentos → editor (escribir texto, barra de formato) → hoja Aa →
hoja Insertar → Agenda (Lista, Día, 3 días, Mes, Año) → nueva tarea → temario →
Más → Sincronización, y guarda una captura de cada una en
`frontend/tests/out/`. Repite con `width: 360` y con tema oscuro
(`colorScheme: 'dark'`). Revisa **todas** las capturas: textos cortados, solapes,
desplazamiento horizontal, contraste.

Comprobaciones automáticas en el mismo script:
```js
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
const small = await page.evaluate(() => [...document.querySelectorAll('button, [role=button], a, input')]
  .filter((e) => e.offsetParent && (e.getBoundingClientRect().width < 44 || e.getBoundingClientRect().height < 44))
  .map((e) => e.getAttribute('aria-label') || e.textContent?.trim()).slice(0, 20));
```
`overflow` debe ser `false` y `small`, vacío (o solo elementos justificados, apuntados en las notas).

### L3. En el dispositivo

- Depuración: `chrome://inspect` en el ordenador con el móvil conectado por USB.
- Registros: `adb logcat | grep -i -E "folio|capacitor|chromium"`.
- **TalkBack:** recorre lista → editor → agenda solo con gestos de TalkBack. Todo se anuncia con nombre y función.
- **Tamaño de letra del sistema al máximo:** nada se corta.
- **Rotación y pantalla dividida:** el estado se conserva.
- **Sin conexión:** todo funciona salvo la sincronización, que lo indica.
- Rendimiento: abrir la app < 2 s en un móvil de gama media; escribir sin retraso en un documento de 30 páginas.

---

## Fase M. Compilar, firmar y publicar

### M1. `build.sh android`

Añade a `build.sh`:
```bash
android() {
  (cd frontend && npm run build && npx cap sync android)
  mkdir -p frontend/android/app/libs
  gomobile bind -target=android/arm64,android/arm -androidapi 26 -javapkg=es.folio -ldflags "-s -w" \
    -o frontend/android/app/libs/folio-core.aar ./mobile
  (cd frontend/android && ./gradlew bundleRelease assembleRelease)
  cp frontend/android/app/build/outputs/apk/release/app-release.apk "build/bin/Folio-$VERSION.apk"
  cp frontend/android/app/build/outputs/bundle/release/app-release.aab "build/bin/Folio-$VERSION.aab"
}
```
(y `android) android ;;` en el `case`; una variante `android-debug` con `assembleDebug` y `-target=android/arm64,android/amd64`).

### M2. Firma

**El usuario** crea el almacén de claves (no lo generes tú ni lo subas al repositorio):
```bash
keytool -genkeypair -v -keystore ~/folio-release.jks -alias folio -keyalg RSA -keysize 4096 -validity 10000
```
Configura `frontend/android/keystore.properties` (en `.gitignore`) con `storeFile`, `storePassword`, `keyAlias`, `keyPassword`, y en `app/build.gradle` un `signingConfigs.release` que lo lea. La huella SHA-1 (`keytool -list -v -keystore ~/folio-release.jks`) va al ID de cliente OAuth de Android (§ I7).

### M3. Publicación

- Versión: `versionName` = la de `build.sh`; `versionCode` incremental.
- `webContentsDebuggingEnabled: false` en la compilación de publicación.
- Google Play: ficha en español, política de privacidad (Folio no recoge datos; la sincronización va directamente a la nube del usuario), declaración de permisos (micrófono: dictado; notificaciones: avisos de la agenda). Lo publica **el usuario**.
- Alternativa sin Play: distribuir el `.apk` (el usuario debe permitir «instalar apps desconocidas»).

---

## Apéndice 1. Errores frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| `gomobile: ANDROID_NDK_HOME not set` | Falta el NDK | Instálalo en Android Studio y exporta la variable (§ 3.1). |
| `gomobile bind` falla con «unsupported type» | Una función exportada de `mobile/` usa structs, slices o maps | Solo `string`, `int`, `bool`, `[]byte`, `error` e interfaces del propio paquete. Todo lo demás, en JSON por `Call`. |
| La app se cierra al llamar al núcleo | Llamada en el hilo principal o núcleo sin iniciar | Usa siempre `worker.execute` (D3); espera a `Mobile.start`. |
| Las imágenes salen rotas en Android | `FolioWebViewClient` no está asignado (o se perdió al asignar otro cliente) | `bridge.setWebViewClient(…)` en `MainActivity` después de `super.onCreate` (D3). |
| El PDF sale en blanco | Se llama a `createPrintDocumentAdapter` antes de cargar fuentes e imágenes | Espera a `onPageFinished` + 300 ms (F2). |
| `SpeechRecognizer` no hace nada | Se llamó fuera del hilo principal o falta `<queries>` en el manifiesto | `runOnUiThread` y § C4. |
| El teclado tapa el editor | `Keyboard.resize` mal configurado | `resize: 'native'` (C2) y la barra de formato con `visualViewport` (H4). |
| El botón atrás sale de la app con un diálogo abierto | El diálogo no se registró en la pila de «atrás» | `pushBack()` en `modal()`/`popupMenu()` (H9). |
| Wails ya no ve una función tras la fase A | Método no promovido o firma cambiada | Envoltorio en `App` (A2) y comprueba `App.d.ts`. |
| Sincronización en bucle subiendo el mismo archivo | El hash local cambia al reescribir (por ejemplo, JSON con orden distinto) | Escribe los JSON fusionados siempre con `fsutil.WriteJSON` (orden estable) y guarda en el estado el hash **tras** escribir. |
| Tareas borradas que reaparecen | Falta la copia base de ese mes | Comprueba que se guarda `.folio-sync/base/<ruta>` tras cada operación (I3.5). |

## Apéndice 2. Lista de comprobación final

- [ ] Escritorio (Windows y Linux) igual que antes: todos los tests y compilaciones pasan.
- [ ] Android: documentos, imágenes, versiones, exportar (.docx, PDF, HTML, Markdown), imprimir, importar, unir PDF.
- [ ] Android: agenda completa (vistas, barra rápida, dictado, temario, plan, progreso, semanas tipo, varios días).
- [ ] Interfaz móvil: sin desplazamiento horizontal a 360 dp; objetivos ≥ 44 px; atrás coherente; tema oscuro; TalkBack.
- [ ] Sincronización WebDAV y Google Drive entre escritorio y Android, con los 9 casos de I10 superados.
- [ ] Avisos de la agenda en Android.
- [ ] Tutoriales adaptados.
- [ ] `./build.sh android` genera `.apk` y `.aab` firmados.
- [ ] README actualizado con Android y sincronización.
