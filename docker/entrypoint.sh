#!/bin/sh
set -e
cd /app

echo "[entrypoint] Aguardando Postgres e aplicando migrações…"
prisma migrate deploy

if [ "${RUN_SEED:-true}" = "true" ]; then
  echo "[entrypoint] Seed (categorias do sistema)…"
  prisma db seed
fi

echo "[entrypoint] Iniciando app…"
exec "$@"
