#!/bin/sh
# Folio @VERSION@ para Linux: lanzador autoextraíble. La primera vez descomprime
# Folio en ~/.local/share/folio/@BUILD@; después lo abre directamente.
# Se actualiza sustituyendo este archivo por el de la versión nueva.
set -e
VERSION="@VERSION@"
BASE="${XDG_DATA_HOME:-$HOME/.local/share}/folio"
DIR="$BASE/@BUILD@"  # versión y huella del contenido: cada compilación tiene su carpeta
if [ ! -x "$DIR/folio" ]; then
  mkdir -p "$BASE"
  TMP="$(mktemp -d "$BASE/.instalando-XXXXXX")"
  LINE=$(awk '/^__FOLIO_ARCHIVO__$/ { print NR + 1; exit 0 }' "$0")
  tail -n +"$LINE" "$0" | tar -xzf - -C "$TMP"
  rm -rf "$DIR"
  mv "$TMP" "$DIR"
  # Versiones anteriores ya no hacen falta
  for old in "$BASE"/*/; do
    case "$old" in "$DIR"/|"$BASE"/bin/) ;; *) rm -rf "$old" ;; esac
  done
fi
# Con espacios de usuario restringidos (Ubuntu 24.04+), Chromium no puede aislar procesos así
FLAGS=""
if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = "1" ]; then FLAGS="--no-sandbox"; fi
FOLIO_LAUNCHER="$(readlink -f "$0")"
export FOLIO_LAUNCHER
exec "$DIR/folio" $FLAGS "$@"
__FOLIO_ARCHIVO__
