#!/usr/bin/env bash
# Instala Kokoro TTS (local, sin API) y descarga el modelo desde GitHub (~350 MB).
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=models/kokoro
mkdir -p "$DIR"
python3 -m pip install -q kokoro-onnx soundfile
BASE=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
for f in kokoro-v1.0.onnx voices-v1.0.bin; do
  [ -s "$DIR/$f" ] || curl -fL --retry 3 -o "$DIR/$f" "$BASE/$f"
done
echo "Kokoro listo en $DIR. Usa TTS_PROVIDER=kokoro (voces: em_alex, em_santa, ef_dora)."
