"""Synthesize narration with Kokoro or Supertonic. Called by record_demo.py.

    python tts_neural.py kokoro|supertonic job.json

The job file holds {"lang", "voice", "rate", "model_dir", "items": [{"text", "out"}]}.
The model is loaded once and every item is written to its own WAV file. Runs in
its own uv environment so these heavy dependencies stay out of the recorder.
"""

import json
import sys


def kokoro(job):
    import soundfile as sf
    from kokoro_onnx import Kokoro

    d = job["model_dir"]
    k = Kokoro(f"{d}/kokoro-v1.0.onnx", f"{d}/voices-v1.0.bin")
    for item in job["items"]:
        samples, sr = k.create(item["text"], voice=job["voice"], speed=job["rate"], lang=job["lang"])
        sf.write(item["out"], samples, sr)


def supertonic(job):
    from supertonic import TTS

    tts = TTS()  # downloads the model to ~/.cache/supertonic3 on first use
    # A voice is a preset name (F1-F5, M1-M5) or a voice-style .json file.
    v = job["voice"]
    style = tts.get_voice_style_from_path(v) if v.endswith(".json") else tts.get_voice_style(v)
    for item in job["items"]:
        wav, _ = tts.synthesize(item["text"], voice_style=style, lang=job["lang"], speed=job["rate"])
        tts.save_audio(wav, item["out"])


if __name__ == "__main__":
    engine, path = sys.argv[1:3]
    with open(path) as f:
        job = json.load(f)
    {"kokoro": kokoro, "supertonic": supertonic}[engine](job)
