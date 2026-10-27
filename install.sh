#!/usr/bin/env bash
# Instala Folio para el usuario actual (sin sudo): binario, icono, menú de
# aplicaciones y acceso directo en el escritorio. Repetir tras recompilar.
set -euo pipefail
cd "$(dirname "$0")"
[ -x build/bin/folio ] || { echo "Primero compila con ./build.sh linux" >&2; exit 1; }

BIN="$HOME/.local/bin/folio"
ICONS="$HOME/.local/share/icons/hicolor"
APPS="$HOME/.local/share/applications"
DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"

install -Dm755 build/bin/folio "$BIN"
# Motor de dictado (si se ha compilado con ./build.sh whisper)
if [ -x build/bin/whisper-cli ]; then
  install -Dm755 build/bin/whisper-cli "${XDG_DATA_HOME:-$HOME/.local/share}/folio/bin/whisper-cli"
fi
for size in 48 64 128 256 512; do
  mkdir -p "$ICONS/${size}x${size}/apps"
  magick build/appicon.png -resize ${size}x${size} "$ICONS/${size}x${size}/apps/folio.png" 2>/dev/null \
    || cp build/appicon.png "$ICONS/${size}x${size}/apps/folio.png"
done
install -Dm644 build/appicon.svg "$ICONS/scalable/apps/folio.svg"

mkdir -p "$APPS"
sed "s|^Exec=.*|Exec=$BIN|" build/linux-folio.desktop > "$APPS/folio.desktop"
chmod 644 "$APPS/folio.desktop"

mkdir -p "$DESKTOP_DIR"
cp "$APPS/folio.desktop" "$DESKTOP_DIR/folio.desktop"
chmod 755 "$DESKTOP_DIR/folio.desktop"
# GNOME solo lanza accesos del escritorio marcados como de confianza
gio set "$DESKTOP_DIR/folio.desktop" metadata::trusted true 2>/dev/null || true

update-desktop-database "$APPS" 2>/dev/null || true
gtk-update-icon-cache -q -t "$ICONS" 2>/dev/null || true
echo "Folio instalado: $BIN"
echo "Acceso directo: $DESKTOP_DIR/folio.desktop y en el menú de aplicaciones."
