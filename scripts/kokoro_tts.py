"""Puente Node → Kokoro. Lee JSON por stdin: {"chunks": [...], "voice", "speed", "lang", "out", "pause"}.
Escribe un WAV con los fragmentos concatenados y devuelve por stdout la duración de cada fragmento."""
import json
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

req = json.load(sys.stdin)
k = Kokoro(req["model"], req["voices"])
pause = float(req.get("pause", 0.12))
parts, spans, t, sr = [], [], 0.0, 24000
for chunk in req["chunks"]:
    samples, sr = k.create(chunk, voice=req["voice"], speed=float(req.get("speed", 1.0)), lang=req.get("lang", "es"))
    # recorta silencios de los bordes para que los tiempos por fragmento sean precisos
    idx = np.where(np.abs(samples) > 0.01)[0]
    if len(idx):
        samples = samples[max(0, idx[0] - int(0.03 * sr)) : idx[-1] + int(0.05 * sr)]
    dur = len(samples) / sr
    spans.append({"start": t, "end": t + dur})
    parts.append(samples)
    parts.append(np.zeros(int(pause * sr), dtype=samples.dtype))
    t += dur + pause
sf.write(req["out"], np.concatenate(parts) if parts else np.zeros(1), sr)
json.dump({"spans": spans}, sys.stdout)
