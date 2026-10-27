#!/usr/bin/env bash
# Prueba el esquema de Folio (permisos por filas y funciones) en un PostgreSQL
# desechable que imita lo justo de Supabase. Necesita podman (o docker).
set -euo pipefail
cd "$(dirname "$0")"
run=$(command -v podman || command -v docker)
name=folio-pg-test
$run rm -f "$name" >/dev/null 2>&1 || true
$run run -d --rm --name "$name" -e POSTGRES_PASSWORD=pruebas-locales docker.io/library/postgres:16 >/dev/null
trap '$run stop "$name" >/dev/null 2>&1' EXIT
until $run exec "$name" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 1
psql() { $run exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql < supabase_stub.sql
psql < ../migrations/20261027000000_folio_circulos.sql 2>&1 | grep -v NOTICE || true
psql < rls_test.sql 2>&1 | grep -E "ok:|FALLO|ERROR|TODO" | sed 's/^psql:<stdin>:[0-9]*: //'
