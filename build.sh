#!/usr/bin/env bash
# Compila Folio. Uso: ./build.sh [linux|windows|installer|whisper|llama|android|android-debug|release|all] [versión]
# linux/windows: ventana de escritorio con Electron (Chromium) y el núcleo Go (cmd/folio-core).
#   Necesita Node ≥ 20; la primera vez descarga Electron para cada sistema.
# android: necesita JDK 21, Android SDK + NDK y gomobile (ver docs/guia-android.md, § 3)
# whisper: motor de dictado whisper-cli para Linux (necesita g++ y cmake: dnf install gcc-c++ cmake)
# llama: motor de Folito (llama-server de llama.cpp), con las mismas herramientas
# installer: folio.exe + instalador de un clic (necesita makensis: dnf install mingw32-nsis)
set -euo pipefail
cd "$(dirname "$0")"
TARGET="${1:-linux}"
VERSION="${2:-$(git describe --tags --always 2>/dev/null || echo 1.0.0)}"
export PATH="$HOME/.local/go/bin:$HOME/go/bin:$PATH"
VERSION="${VERSION#v}"

# Interfaz y proceso principal de la ventana (una vez por compilación)
frontend() {
  [ -d frontend/node_modules ] || (cd frontend && npm ci)
  [ -d desktop/node_modules ] || (cd desktop && npm ci)
  (cd frontend && npm run build)
  (cd desktop && npm run build)
}
# build/desktop/linux/Folio y build/bin/folio (lanzador autoextraíble de un solo archivo)
linux() {
  frontend
  (cd desktop && node package.mjs linux "$VERSION" "$PWD/../build/bin/whisper-cli" "$PWD/../build/bin/llama-server")
}
# build/desktop/win32/Folio (Folio.exe y sus archivos)
windows() {
  [ "${FRONTEND_DONE:-}" = 1 ] || frontend
  (cd desktop && node package.mjs win32 "$VERSION" "$PWD/../build/bin/whisper-cli.exe" "$PWD/../build/bin/llama-server.exe")
}
# Motores de Linux (whisper, llama): dentro de Ubuntu 22.04 con podman (ver
# build/linux/Containerfile), sin OpenMP y con libstdc++ dentro, para que no
# dependan de la versión de las bibliotecas de quien compila. Sin podman, se
# compilan aquí (solo valen para esta distribución o más nuevas).
engine_linux() {  # engine_linux <fuentes> <objetivo> <opciones de cmake…>
  local src=$1 target=$2; shift 2
  local opts=("$@" -DGGML_OPENMP=OFF "-DCMAKE_EXE_LINKER_FLAGS=-static-libgcc -static-libstdc++")
  local cmd="cmake -S $src -B $src/build-linux $(printf '%q ' "${opts[@]}") && cmake --build $src/build-linux -j$(nproc) --target $target"
  if command -v podman >/dev/null; then
    podman image exists folio-build:22.04 || podman build -t folio-build:22.04 build/linux
    podman run --rm --security-opt label=disable -v "$PWD:/src" -w /src folio-build:22.04 sh -c "$cmd"
  else
    sh -c "$cmd"
  fi
  install -m755 "$src/build-linux/bin/$target" "build/bin/$target"
}
whisper() {
  local tag=v1.9.5 src=build/whisper.cpp
  [ -d "$src" ] || git clone --depth 1 --branch "$tag" https://github.com/ggml-org/whisper.cpp "$src"
  # Estático y sin optimizaciones de este procesador concreto: funciona en cualquier PC x86-64
  local opts=(-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DGGML_NATIVE=OFF)
  engine_linux "$src" whisper-cli "${opts[@]}"
  # Windows con MinGW (dnf install mingw64-gcc-c++), enlazado estático: sin DLL extra
  if command -v x86_64-w64-mingw32-g++ >/dev/null; then
    cmake -S "$src" -B "$src/build-win" "${opts[@]}" -DGGML_OPENMP=OFF \
      -DCMAKE_TOOLCHAIN_FILE="$PWD/build/windows/mingw64.cmake" -DCMAKE_EXE_LINKER_FLAGS="-static -static-libgcc -static-libstdc++"
    cmake --build "$src/build-win" -j"$(nproc)" --target whisper-cli
    x86_64-w64-mingw32-strip -o build/bin/whisper-cli.exe "$src/build-win/bin/whisper-cli.exe"
  fi
}
# Motor de Folito: llama-server de llama.cpp, estático y para cualquier x86-64 (como whisper)
llama() {
  local tag=b11900 src=build/llama.cpp
  [ -d "$src" ] || git clone --depth 1 --branch "$tag" https://github.com/ggml-org/llama.cpp "$src"
  local opts=(-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_CURL=OFF -DLLAMA_OPENSSL=OFF)
  engine_linux "$src" llama-server "${opts[@]}"
  if command -v x86_64-w64-mingw32-g++ >/dev/null; then
    cmake -S "$src" -B "$src/build-win" "${opts[@]}" -DGGML_OPENMP=OFF \
      -DCMAKE_TOOLCHAIN_FILE="$PWD/build/windows/mingw64.cmake" -DCMAKE_EXE_LINKER_FLAGS="-static -static-libgcc -static-libstdc++"
    cmake --build "$src/build-win" -j"$(nproc)" --target llama-server
    x86_64-w64-mingw32-strip -o build/bin/llama-server.exe "$src/build-win/bin/llama-server.exe"
  fi
}
# Herramientas de Android: las del entorno o, si no, las instaladas en ~/.local y ~/Android
android_env() {
  [ -z "${JAVA_HOME:-}" ] && [ -x "$HOME/.local/jdk-21/bin/javac" ] && export JAVA_HOME="$HOME/.local/jdk-21"
  [ -n "${JAVA_HOME:-}" ] && export PATH="$JAVA_HOME/bin:$PATH"
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
  [ -z "${ANDROID_NDK_HOME:-}" ] && [ -d "$ANDROID_HOME/ndk" ] && export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/$(ls "$ANDROID_HOME/ndk" | sort -V | tail -1)"
  export PATH="$HOME/go/bin:$PATH"
  echo "sdk.dir=$ANDROID_HOME" > frontend/android/local.properties
}
# Núcleo Go para Android (.aar) con gomobile
android_core() {
  android_env
  local targets="${1:-android/arm64,android/arm}"
  mkdir -p frontend/android/app/libs
  gomobile bind -target="$targets" -androidapi 26 -javapkg=es.folio -ldflags "-s -w" \
    -o frontend/android/app/libs/folio-core.aar ./mobile
}
android_debug() {
  android_env
  (cd frontend && npm run build && npx cap sync android)
  android_core android/arm64,android/amd64
  (cd frontend/android && ./gradlew assembleDebug -PfolioVersion="$VERSION")
  cp frontend/android/app/build/outputs/apk/debug/app-debug.apk "build/bin/Folio-$VERSION-debug.apk"
}
android() {
  android_env
  (cd frontend && npm run build && npx cap sync android)
  android_core android/arm64,android/arm
  (cd frontend/android && ./gradlew assembleRelease bundleRelease -PfolioVersion="$VERSION")
  cp frontend/android/app/build/outputs/apk/release/app-release*.apk "build/bin/Folio-$VERSION.apk"
  cp frontend/android/app/build/outputs/bundle/release/app-release.aab "build/bin/Folio-$VERSION.aab"
}
# Prepara una versión para GitHub Releases en build/release/: binario de Linux,
# instalador de Windows, APK firmado (si hay firma configurada), SHA256SUMS y su
# firma. No publica nada: al final muestra la orden de gh para subirla.
release() {
  [[ "$VERSION" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Indica la versión: ./build.sh release 1.2.3" >&2; exit 1; }
  local out=build/release
  rm -rf "$out" && mkdir -p "$out"
  linux
  # Mismo nombre que antes: las versiones instaladas se actualizan sustituyendo este archivo
  cp build/bin/folio "$out/folio-linux-amd64"
  FRONTEND_DONE=1 installer
  cp "build/bin/Folio-Setup-$VERSION.exe" "$out/"
  if [ -f "$HOME/.config/folio-release/android-signing.properties" ]; then
    android
    cp build/bin/Folio-$VERSION.apk "$out/Folio-$VERSION.apk"
  else
    echo "Aviso: sin firma de Android (~/.config/folio-release/android-signing.properties): la versión no lleva APK." >&2
  fi
  (cd "$out" && sha256sum -- * > SHA256SUMS)
  if [ -s internal/update/publickey.txt ]; then
    go run ./cmd/releasekey sign "$out/SHA256SUMS"
  fi
  echo
  echo "Versión $VERSION lista en $out. Para publicarla:"
  echo "  gh release create v$VERSION $out/* --title \"Folio $VERSION\" --notes-file NOTAS.md"
}
# Instalador de un clic para Windows (el motor de dictado ya va dentro de la carpeta)
installer() {
  windows
  makensis -V2 -DVERSION="$VERSION" -DAPPDIR="$PWD/build/desktop/win32/Folio" -DOUT="$PWD/build/bin/Folio-Setup-$VERSION.exe" build/windows/installer/folio-setup.nsi
}

case "$TARGET" in
  linux) linux ;;
  windows) windows ;;
  installer) installer ;;
  whisper) whisper ;;
  llama) llama ;;
  android) android ;;
  android-debug) android_debug ;;
  release) release ;;
  all) linux; FRONTEND_DONE=1 installer ;;
  *) echo "Uso: $0 [linux|windows|installer|whisper|llama|android|android-debug|release|all] [versión]" >&2; exit 1 ;;
esac
ls -lh build/bin
