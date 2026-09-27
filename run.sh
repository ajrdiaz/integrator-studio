#!/usr/bin/env bash
# Compila la interfaz web y levanta el servidor de Integrator Video Studio.
# Usa PORT (3000 por defecto); si está ocupado, elige un puerto libre al azar.
set -euo pipefail

cd "$(dirname "$0")"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3000}"

port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

if port_in_use "$PORT"; then
  echo "El puerto $PORT está ocupado; buscando uno libre..."
  for _ in $(seq 1 50); do
    candidate=$(( (RANDOM % 55000) + 10000 ))
    if ! port_in_use "$candidate"; then
      PORT="$candidate"
      break
    fi
  done
  if port_in_use "$PORT"; then
    echo "No se encontró un puerto libre." >&2
    exit 1
  fi
fi

[ -d node_modules ] || npm install

echo "Usando http://$HOST:$PORT"
npx vite build web
HOST="$HOST" PORT="$PORT" exec npx tsx src/server/index.ts
