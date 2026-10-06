"""Synthesize narration with Kokoro or Chatterbox. Called by record_demo.py.

    python tts_neural.py kokoro|chatterbox job.json

The job file holds {"lang", "voice", "rate", "model_dir", "items": [{"text", "out"}]}.
The model is loaded once and every item is written to its own WAV file. Runs in
its own uv environment so these heavy dependencies stay out of the recorder.
"""

import json
import sys
import time


def kokoro(job):
    import soundfile as sf
    from kokoro_onnx import Kokoro

    d = job["model_dir"]
    k = Kokoro(f"{d}/kokoro-v1.0.onnx", f"{d}/voices-v1.0.bin")
    for item in job["items"]:
        samples, sr = k.create(item["text"], voice=job["voice"], speed=job["rate"], lang=job["lang"])
        sf.write(item["out"], samples, sr)


def chatterbox(job):
    import torch
    import torchaudio
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    device = "cuda" if torch.cuda.is_available() else "cpu"
    t = time.monotonic()
    model = ChatterboxMultilingualTTS.from_pretrained(device=device)
    print(f"chatterbox: loaded on {device} in {time.monotonic() - t:.0f}s", file=sys.stderr, flush=True)
    # A voice is a short reference recording to clone; without one the default voice is used.
    prompt = {"audio_prompt_path": job["voice"]} if job.get("voice") else {}
    for item in job["items"]:
        wav = model.generate(item["text"], language_id=job["lang"], **prompt)
        torchaudio.save(item["out"], wav, model.sr)


if __name__ == "__main__":
    engine, path = sys.argv[1:3]
    with open(path) as f:
        job = json.load(f)
    {"kokoro": kokoro, "chatterbox": chatterbox}[engine](job)
