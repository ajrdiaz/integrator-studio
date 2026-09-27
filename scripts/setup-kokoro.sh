#!/usr/bin/env bash
# Instala Kokoro TTS (local, sin API) y descarga el modelo desde GitHub (~350 MB).
# kokoro-onnx necesita Python 3.10–3.13: se instala en un entorno propio (models/kokoro/venv).
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=models/kokoro
mkdir -p "$DIR"

PY=""
for c in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$c" >/dev/null && "$c" -c 'import sys; sys.exit(not ((3, 10) <= sys.version_info[:2] < (3, 14)))'; then
    PY="$c"
    break
  fi
done
if [ -z "$PY" ]; then
  echo "Se necesita Python 3.10–3.13 (p. ej. brew install python@3.12)." >&2
  exit 1
fi

[ -x "$DIR/venv/bin/python" ] || "$PY" -m venv "$DIR/venv"
"$DIR/venv/bin/python" -m pip install -q --upgrade pip
"$DIR/venv/bin/python" -m pip install -q kokoro-onnx soundfile

BASE=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
for f in kokoro-v1.0.onnx voices-v1.0.bin; do
  [ -s "$DIR/$f" ] || curl -fL --retry 3 -o "$DIR/$f" "$BASE/$f"
done
echo "Kokoro listo en $DIR (Python: $DIR/venv). Usa TTS_PROVIDER=kokoro (voces: em_alex, em_santa, ef_dora)."
