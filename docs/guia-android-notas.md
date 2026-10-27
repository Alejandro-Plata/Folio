# Notas de la implementación de Android

Desviaciones respecto a `guia-android.md` y puntos que hay que revisar al
compilar por primera vez (en el equipo donde se escribió no había JDK, Android
SDK ni NDK, así que **el código Android no se ha compilado todavía**).

## Desviaciones

- **Plugins en Java, no en Kotlin.** Capacitor 7 genera el proyecto en Java y
  no incluye el plugin de Kotlin de Gradle; escribir los plugins en Java evita
  tocar la configuración de Gradle. Rutas: `frontend/android/app/src/main/java/es/folio/app/`.
- **`minSdkVersion` 26** (Capacitor 7 pone 23).
- **`BuildConfig` no se usa**: AGP 8 no lo genera por defecto; la versión se
  lee con `PackageManager`.

## A comprobar al compilar

1. `gomobile bind` genera `es.folio.mobile.Mobile` y `EventSink`. Los nombres de
   método Java son los de Go con la primera letra en minúscula (`Mobile.start`,
   `Mobile.call`, `Mobile.assetPath`, `Mobile.stop`, `Mobile.setEventSink`;
   `EventSink.emit`). Si algún nombre difiere, corrígelo en `FolioCorePlugin`
   y `FolioWebViewClient`.
2. `Bridge.setWebViewClient` y `BridgeWebViewClient(Bridge)` (Capacitor 7).
3. `PdfWriter` (`android.print`): puede avisar el *lint* de API privada; está
   permitido porque solo usa API pública con callbacks de paquete.
4. `FolioAuthPlugin`: necesita el ID de cliente OAuth de Android y la huella
   SHA-1 de la clave de firma (guía § I.7 y § M.2). Sin ellos, vincular con
   Google Drive falla; WebDAV funciona sin nada de eso.
5. Todo el flujo de la guía § L.3 (en el dispositivo).

## Estado de la compilación (26 oct 2026)

- Entorno instalado sin sudo: JDK 21 Temurin en `~/.local/jdk-21`, Android SDK en `~/Android/Sdk` (plataforma 35, build-tools 35.0.0, NDK 27.2.12479018, emulador e imagen x86_64 API 35, AVD `folio_test`), `gomobile`/`gobind` en `~/go/bin`. `build.sh` los detecta solo (`android_env`).
- `./build.sh android-debug` compila: `folio-core.aar` (gomobile) y el APK de depuración (`build/bin/Folio-1.0.0-debug.apk`) sin errores de Java ni de Gradle.
- `tools.go` mantiene `golang.org/x/mobile` en `go.mod` (si no, `go mod tidy` lo quita y gomobile falla).
- **No probado en ejecución**: el emulador de este equipo se cierra con un fallo de segmentación (Fedora 44, emulator 37.2.12) tras arrancar el kernel. Falta instalar el APK en un móvil real (`adb install -r build/bin/Folio-1.0.0-debug.apk`) y recorrer la lista de comprobaciones de arriba.
