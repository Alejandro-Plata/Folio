# Actualizaciones desde la app

Al abrir Folio se comprueba si hay versión nueva en GitHub Releases. Si la hay,
aparece un diálogo con tres opciones: **Instalar**, **Ver los cambios** (las notas
de la versión) y **Más tarde** (vuelve a preguntar la próxima vez que se abra).
También se busca a mano desde **Archivo › Buscar actualizaciones**, **Ajustes** o
**Más › Actualizaciones**. Al pulsar **Instalar**:

- comprueba la suma SHA-256 del archivo con `SHA256SUMS`;
- si la app lleva clave pública, comprueba además la firma de `SHA256SUMS`;
- **Linux**: sustituye el ejecutable y vuelve a abrir Folio;
- **Windows**: lanza el instalador en silencio, que espera a que Folio se cierre;
- **Android**: abre el instalador del sistema (la primera vez pide permitir esta fuente).

## Preparación (una vez)

1. Crea un repositorio en GitHub para publicar las versiones, por ejemplo
   `tu-usuario/folio`. Las versiones tienen que ser públicas (la app las descarga sin
   iniciar sesión); el código puede estar en otro repositorio privado si prefieres.
2. Pon su nombre en `internal/update/update.go`:

   ```go
   var Repo = "tu-usuario/folio"
   ```

3. **Clave de firma** (recomendado): `go run ./cmd/releasekey gen`.
   - La privada queda en `~/.config/folio-release/release.key`. Haz copia de
     seguridad y no la subas a ningún sitio.
   - La pública se escribe en `internal/update/publickey.txt` y va en el repositorio.
   - Si pierdes la privada, las apps instaladas no aceptarán versiones nuevas hasta
     instalarlas a mano.
4. **Firma de Android** (para que los APK se puedan actualizar unos sobre otros):

   ```sh
   keytool -genkeypair -v -keystore ~/.config/folio-release/folio.jks -alias folio \
     -keyalg RSA -keysize 4096 -validity 10000
   ```

   y crea `~/.config/folio-release/android-signing.properties`:

   ```
   storeFile=/home/TU_USUARIO/.config/folio-release/folio.jks
   storePassword=…
   keyAlias=folio
   keyPassword=…
   ```

   Usa siempre la misma: Android rechaza actualizar una app firmada con otra clave.
   Un APK de depuración (`android-debug`) va firmado con otra clave, así que hay que
   desinstalarlo antes de instalar la primera versión publicada.
5. Instala y autentica la CLI de GitHub: `gh auth login`.

## Publicar una versión

```sh
./build.sh release 1.2.0
gh release create v1.2.0 build/release/* --title "Folio 1.2.0" --notes-file NOTAS.md
```

`build/release/` contiene `folio-linux-amd64`, `Folio-Setup-1.2.0.exe`,
`Folio-1.2.0.apk` (si hay firma de Android), `SHA256SUMS` y `SHA256SUMS.sig`.
El texto de `NOTAS.md` es lo que se ve en Folio al pulsar «Ver los cambios». Cada
versión agrupa varias mejoras, no un único cambio; usa secciones de Markdown:

```markdown
## Novedades
- …
## Rendimiento
- …
## Correcciones
- …
```

Los nombres de los archivos importan: la app busca `folio-linux-amd64`,
`Folio-Setup-*.exe` y `*.apk` (sin «debug»).
