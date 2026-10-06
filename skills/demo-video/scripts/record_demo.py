# /// script
# requires-python = ">=3.10"
# dependencies = ["playwright>=1.45"]
# ///
"""Record a narrated feature demo from a storyboard JSON file.

    uv run record_demo.py storyboard.json --out demo.mp4

Each scene's narration is synthesized first, then the browser performs the
scene's actions while the narration plays, and holds until it is done. The
result is an MP4 with a visible mouse cursor, voiceover and soft subtitles.
"""

import argparse
import array
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import wave
from pathlib import Path

SAMPLE_RATE = 48000
SCENE_GAP = 0.35  # seconds of quiet between scenes
END_HOLD = 0.8
ACTION_TIMEOUT_MS = 10_000

PIPER_VOICES_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main"
PIPER_PREFERRED = {
    "en": "en_US-lessac-medium",
    "en-us": "en_US-lessac-medium",
    "en-gb": "en_GB-alan-medium",
    "da": "da_DK-talesyntese-medium",
    "de": "de_DE-thorsten-medium",
    "sv": "sv_SE-nst-medium",
    "no": "no_NO-talesyntese-medium",
    "nb": "no_NO-talesyntese-medium",
    "fr": "fr_FR-siwis-medium",
    "es": "es_ES-davefx-medium",
}
KOKORO_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
KOKORO_VOICES = {  # language -> (Kokoro language code, voice)
    "en": ("en-us", "af_heart"),
    "en-us": ("en-us", "af_heart"),
    "en-gb": ("en-gb", "bf_emma"),
    "es": ("es", "ef_dora"),
    "fr": ("fr-fr", "ff_siwis"),
    "it": ("it", "if_sara"),
    "pt": ("pt-br", "pf_dora"),
    "hi": ("hi", "hf_alpha"),
}
CHATTERBOX_LANGS = {"ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it", "ja", "ko", "ms", "nl", "no",
                    "pl", "pt", "ru", "sv", "sw", "tr", "zh"}
NEURAL_ENVS = {
    "kokoro": ["--with", "kokoro-onnx", "--with", "soundfile"],
    "chatterbox": ["--python", "3.11", "--with", "chatterbox-tts", "--with", "setuptools<81"],
}
SAY_PREFERRED = {"en": "Samantha", "en-us": "Samantha", "en-gb": "Daniel", "da": "Sara"}


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def die(msg):
    log(f"error: {msg}")
    sys.exit(1)


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, **kw)


# --------------------------------------------------------------------------- TTS


def norm_lang(lang):
    return (lang or "en").strip().lower().replace("_", "-")


def has_cuda():
    if os.environ.get("CUDA_VISIBLE_DEVICES") in ("", "-1"):
        return False
    return bool(shutil.which("nvidia-smi")) and subprocess.run(["nvidia-smi", "-L"], capture_output=True).returncode == 0


def kokoro_lang(lang):
    return KOKORO_VOICES.get(lang) or KOKORO_VOICES.get(lang.split("-")[0])


def chatterbox_lang(lang):
    base = {"nb": "no", "nn": "no"}.get(lang.split("-")[0], lang.split("-")[0])
    return base if base in CHATTERBOX_LANGS else None


def engine_available(name):
    if name in ("kokoro", "chatterbox"):
        return bool(shutil.which("uv"))
    if name == "say":
        return platform.system() == "Darwin" and bool(shutil.which("say"))
    return bool(shutil.which(name))


def engine_speaks(name, lang):
    return {"kokoro": kokoro_lang, "chatterbox": chatterbox_lang}.get(name, lambda _: True)(lang)


def pick_engine(requested, lang):
    # An engine named in the storyboard wins, then the user's DEMO_VIDEO_TTS, then auto.
    if requested in (None, "", "auto"):
        requested = os.environ.get("DEMO_VIDEO_TTS") or "auto"
    if requested != "auto":
        if not engine_available(requested):
            die(f"TTS engine '{requested}' is not available" + (" (it needs uv)" if requested in ("kokoro", "chatterbox") else ""))
        if not engine_speaks(requested, lang):
            die(f"TTS engine '{requested}' doesn't support language '{lang}'")
        return requested
    candidates = [
        ("kokoro", kokoro_lang(lang)),
        ("chatterbox", chatterbox_lang(lang) and has_cuda()),
        ("piper", True), ("say", True), ("espeak-ng", True),
    ]
    for name, ok in candidates:
        if ok and engine_available(name):
            if name in ("piper", "say", "espeak-ng") and chatterbox_lang(lang) and engine_available("chatterbox"):
                log(f"note: Chatterbox sounds much better for '{lang}'. It runs on CPU at about 2.5x real time "
                    "and downloads ~3 GB plus PyTorch on first use. Set \"engine\": \"chatterbox\" to use it.")
            return name
    die("no TTS engine found; install uv (for Kokoro/Chatterbox) or piper (`uv tool install piper-tts`), "
        "or use macOS `say` or espeak-ng")


def kokoro_models():
    d = Path(os.environ.get("KOKORO_DIR", "~/.cache/kokoro")).expanduser()
    d.mkdir(parents=True, exist_ok=True)
    missing = [n for n in ("kokoro-v1.0.onnx", "voices-v1.0.bin") if not (d / n).exists()]
    if missing:
        log(f"downloading the Kokoro model to {d} (~340 MB, one-time)")
    for name in missing:
        urllib.request.urlretrieve(f"{KOKORO_URL}/{name}", d / (name + ".part"))
        (d / (name + ".part")).rename(d / name)
    return d


def piper_voice_dirs():
    dirs = [os.environ.get("PIPER_VOICES_DIR"), "~/.cache/piper", "~/.local/share/piper", "~/.local/share/piper-voices"]
    return [Path(d).expanduser() for d in dirs if d]


def piper_model(lang, voice):
    lang = norm_lang(lang)
    if voice and voice.endswith(".onnx") and Path(voice).expanduser().exists():
        return Path(voice).expanduser()
    if not voice:
        voice = PIPER_PREFERRED.get(lang) or PIPER_PREFERRED.get(lang.split("-")[0])
    if voice:
        for d in piper_voice_dirs():
            if (d / f"{voice}.onnx").exists() and (d / f"{voice}.onnx.json").exists():
                return d / f"{voice}.onnx"
    # Look up (or pick) the voice in the public index and download it.
    with urllib.request.urlopen(f"{PIPER_VOICES_URL}/voices.json") as r:
        index = json.load(r)
    if not voice or voice not in index:
        family, region = lang.split("-")[0], lang.split("-")[1:] and lang.split("-")[1].upper()
        candidates = [v for v in index.values() if v["language"]["family"] == family]
        if not candidates:
            die(f"no Piper voice for language '{lang}'")
        rank = {"medium": 0, "high": 1, "low": 2, "x_low": 3}
        candidates.sort(key=lambda v: (v["language"]["region"] != region if region else 0, rank.get(v["quality"], 9), v["key"]))
        voice = candidates[0]["key"]
    dest = piper_voice_dirs()[0] if os.environ.get("PIPER_VOICES_DIR") else Path("~/.cache/piper").expanduser()
    dest.mkdir(parents=True, exist_ok=True)
    for path in index[voice]["files"]:
        if path.endswith((".onnx", ".onnx.json")):
            log(f"downloading Piper voice file {path}")
            urllib.request.urlretrieve(f"{PIPER_VOICES_URL}/{path}", dest / Path(path).name)
    return dest / f"{voice}.onnx"


def say_voice(lang, voice):
    if voice:
        return voice
    lang = norm_lang(lang)
    out = run(["say", "-v", "?"], text=True).stdout
    voices = []
    for line in out.splitlines():
        m = re.match(r"^(.+?)\s+([a-z]{2,3}[_-][A-Za-z0-9]+)\s+#", line)
        if m:
            voices.append((m.group(1).strip(), m.group(2).lower().replace("_", "-")))
    preferred = SAY_PREFERRED.get(lang) or SAY_PREFERRED.get(lang.split("-")[0])
    for name, loc in voices:
        if name == preferred and loc.startswith(lang.split("-")[0]):
            return name
    for match in (lambda loc: loc == lang, lambda loc: loc.split("-")[0] == lang.split("-")[0]):
        for name, loc in voices:
            if match(loc):
                return name
    die(f"no macOS `say` voice for language '{lang}'; install one in System Settings > Accessibility > Spoken Content")


def trim_silence(path, head=0.1, tail=0.2, head_db=32, tail_db=22):
    """Cut quiet from both ends, relative to the clip's loudest part. Returns the new length.

    The start keeps soft sounds (a breathy "h"); the end is cut harder, because neural voices
    often trail off into breaths or murmur well below the speech.
    """
    with wave.open(str(path)) as w:
        rate = w.getframerate()
        samples = array.array("h", w.readframes(w.getnframes()))
    win = rate // 50  # 20 ms
    levels = [sum(x * x for x in samples[i:i + win]) / max(1, len(samples[i:i + win])) for i in range(0, len(samples), win)]
    if not levels or max(levels) == 0:
        return len(samples) / rate
    peak = max(levels)
    first = next(i for i, lv in enumerate(levels) if lv >= peak * 10 ** (-head_db / 10))
    last = max(i for i, lv in enumerate(levels) if lv >= peak * 10 ** (-tail_db / 10))
    start = max(0, first * win - int(head * rate))
    end = min(len(samples), (last + 1) * win + int(tail * rate))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(samples[start:end].tobytes())
    return (end - start) / rate


class TTS:
    def __init__(self, engine, lang, voice, rate):
        self.lang = norm_lang(lang)
        self.engine = pick_engine(engine, self.lang)
        self.rate = rate
        if self.engine == "piper":
            self.voice = str(piper_model(self.lang, voice))
        elif self.engine == "say":
            self.voice = say_voice(self.lang, voice)
        elif self.engine == "kokoro":
            self.voice = voice or kokoro_lang(self.lang)[1]
        elif self.engine == "chatterbox":
            self.voice = str(Path(voice).expanduser()) if voice else None
        else:
            self.voice = voice or self.lang
        log(f"TTS: {self.engine}, voice {self.voice or 'default'}, rate {rate}")

    def raw_path(self, out_wav):
        return out_wav.with_name(out_wav.stem + ".raw" + (".aiff" if self.engine == "say" else ".wav"))

    def synth_all(self, items, workdir):
        """items: [(text, out_wav)]. Returns each clip's duration in seconds."""
        if self.engine in NEURAL_ENVS:
            self.synth_neural(items, workdir)
        else:
            for text, out_wav in items:
                self.synth_cli(text, self.raw_path(out_wav), workdir)
        # Chatterbox has no speed setting, so stretch its output instead.
        tempo = f"atempo={self.rate}" if self.engine == "chatterbox" and self.rate != 1 else ""
        durations = []
        for _, out_wav in items:
            run(["ffmpeg", "-y", "-i", str(self.raw_path(out_wav)), *(["-af", tempo] if tempo else []),
                 "-ar", str(SAMPLE_RATE), "-ac", "1", "-sample_fmt", "s16", str(out_wav)])
            durations.append(trim_silence(out_wav))
        return durations

    def synth_cli(self, text, raw, workdir):
        txt = workdir / (raw.stem + ".txt")
        txt.write_text(text)
        if self.engine == "piper":
            with open(txt) as f:
                run(["piper", "--model", self.voice, "--output_file", str(raw), "--length_scale", f"{1 / self.rate:.3f}"], stdin=f)
        elif self.engine == "say":
            run(["say", "-v", self.voice, "-r", str(int(185 * self.rate)), "-o", str(raw), "-f", str(txt)])
        else:
            run(["espeak-ng", "-v", self.voice, "-s", str(int(170 * self.rate)), "-w", str(raw), "-f", str(txt)])

    def synth_neural(self, items, workdir):
        job = {"voice": self.voice, "rate": self.rate, "items": [{"text": t, "out": str(self.raw_path(o))} for t, o in items]}
        if self.engine == "kokoro":
            job["lang"] = kokoro_lang(self.lang)[0]
            job["model_dir"] = str(kokoro_models())
        else:
            job["lang"] = chatterbox_lang(self.lang)
            hub = Path(os.environ.get("HF_HOME", "~/.cache/huggingface")).expanduser() / "hub"
            if not (hub / "models--ResembleAI--chatterbox").exists():
                log("first Chatterbox run: downloading ~3 GB of model plus PyTorch, this takes a while")
            if not has_cuda():
                log("Chatterbox on CPU: expect about 2.5 s of work per second of narration")
        job_file = workdir / "tts-job.json"
        job_file.write_text(json.dumps(job))
        helper = Path(__file__).with_name("tts_neural.py")
        cmd = ["uv", "run", "-q", *NEURAL_ENVS[self.engine], "python", "-I", str(helper), self.engine, str(job_file)]
        # Run from the workdir so the project's own pyproject/venv isn't picked up.
        result = subprocess.run(cmd, cwd=workdir, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        if result.returncode != 0:
            die(f"{self.engine} failed:\n" + "\n".join(result.stderr.strip().splitlines()[-15:]))
        for line in result.stderr.splitlines():
            if line.startswith(f"{self.engine}:"):
                log(line)


# ----------------------------------------------------------------------- browser

CURSOR_JS = r"""
(() => {
  if (window !== window.top || window.__demoCursor) return;
  window.__demoCursor = true;
  const KEY = '__demoCursorPos';
  let pos = { x: innerWidth / 2, y: innerHeight / 2 };
  try { const s = JSON.parse(sessionStorage.getItem(KEY)); if (s) pos = s; } catch (e) {}
  let el;
  const place = () => { if (el) el.style.transform = `translate(${pos.x - 3}px, ${pos.y - 2}px)`; };
  const install = () => {
    if (el && el.isConnected) return;
    el = document.createElement('div');
    el.id = '__demo_cursor';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M3 2 L3 19 L7.6 14.9 L10.6 21.6 L13.4 20.4 L10.5 13.9 L16.6 13.6 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    el.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))';
    document.documentElement.appendChild(el);
    place();
  };
  if (document.documentElement) install(); else document.addEventListener('DOMContentLoaded', install);
  document.addEventListener('DOMContentLoaded', install);
  addEventListener('mousemove', (e) => {
    pos = { x: e.clientX, y: e.clientY };
    install(); place();
    try { sessionStorage.setItem(KEY, JSON.stringify(pos)); } catch (e) {}
  }, true);
  addEventListener('mousedown', (e) => {
    const r = document.createElement('div');
    r.style.cssText = `position:fixed;left:${e.clientX - 18}px;top:${e.clientY - 18}px;width:36px;height:36px;border-radius:50%;` +
      'background:rgba(255,200,0,.45);border:2px solid rgba(255,170,0,.9);z-index:2147483646;pointer-events:none;' +
      'transition:transform .45s ease-out,opacity .45s ease-out;transform:scale(.3);opacity:1';
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = 'scale(1.4)'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 600);
  }, true);
})();
"""

OVERLAY_JS = r"""
([html, kind]) => {
  let o = document.getElementById('__demo_overlay');
  if (!o) {
    o = document.createElement('div');
    o.id = '__demo_overlay';
    o.style.cssText = 'position:fixed;inset:0;z-index:2147483645;display:flex;align-items:center;justify-content:center;' +
      'opacity:0;transition:opacity .25s;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;';
    document.documentElement.appendChild(o);
    requestAnimationFrame(() => requestAnimationFrame(() => { o.style.opacity = '1'; }));
  }
  o.style.background = kind === 'card' ? 'linear-gradient(135deg,#0f172a,#1e293b)' : '#fff';
  o.style.color = kind === 'card' ? '#f8fafc' : '#0f172a';
  o.style.fontSize = kind === 'card' ? '' : '22px';
  o.innerHTML = html;
  const c = document.getElementById('__demo_cursor');
  if (c) c.style.visibility = 'hidden';
}
"""

REMOVE_OVERLAY_JS = r"""
() => new Promise((done) => {
  const o = document.getElementById('__demo_overlay');
  if (!o) return done();
  const c = document.getElementById('__demo_cursor');
  if (c) c.style.visibility = '';
  o.style.opacity = '0';
  setTimeout(() => { o.remove(); done(); }, 260);
})
"""


def esc(s):
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def card_html(card):
    if isinstance(card, str):
        card = {"title": card}
    sub = f'<div style="font-size:26px;opacity:.75;margin-top:18px">{esc(card.get("subtitle"))}</div>' if card.get("subtitle") else ""
    kicker = f'<div style="font-size:18px;letter-spacing:.12em;text-transform:uppercase;opacity:.6;margin-bottom:18px">{esc(card.get("kicker"))}</div>' if card.get("kicker") else ""
    return f'<div style="text-align:center;max-width:80%">{kicker}<div style="font-size:52px;font-weight:700;line-height:1.15">{esc(card.get("title"))}</div>{sub}</div>'


class Director:
    def __init__(self, page, base_url):
        self.page = page
        self.base_url = (base_url or "").rstrip("/")
        vp = page.viewport_size
        self.x, self.y = vp["width"] / 2, vp["height"] / 2

    def url(self, u):
        if re.match(r"^[a-z]+:", u) or not self.base_url:
            return u
        return self.base_url + "/" + u.lstrip("/")

    def ensure_cursor(self):
        try:
            self.page.evaluate(CURSOR_JS)
        except Exception:
            pass

    def move_to(self, x, y, min_dur=0.25, max_dur=0.7):
        dist = ((x - self.x) ** 2 + (y - self.y) ** 2) ** 0.5
        dur = min(max_dur, max(min_dur, dist / 1400))
        steps = max(2, int(dur * 60))
        sx, sy = self.x, self.y
        for i in range(1, steps + 1):
            t = i / steps
            e = t * t * (3 - 2 * t)  # smoothstep
            self.page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e)
            time.sleep(dur / steps)
        self.x, self.y = x, y

    def locate(self, sel):
        loc = self.page.locator(sel).first
        loc.wait_for(state="visible", timeout=ACTION_TIMEOUT_MS)
        loc.scroll_into_view_if_needed(timeout=ACTION_TIMEOUT_MS)
        box = loc.bounding_box()
        return loc, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

    def point(self, sel):
        loc, x, y = self.locate(sel)
        self.move_to(x, y)
        return loc

    def click(self, sel):
        self.point(sel)
        time.sleep(0.12)
        self.page.mouse.click(self.x, self.y)
        time.sleep(0.25)
        self.ensure_cursor()

    def action(self, a):
        p = self.page
        kind, arg = next(((k, v) for k, v in a.items() if k != "note"), (None, None))
        if kind == "goto":
            p.goto(self.url(arg), wait_until="load")
            self.ensure_cursor()
            p.mouse.move(self.x, self.y)
        elif kind == "click":
            self.click(arg)
        elif kind == "hover":
            self.point(arg)
        elif kind == "type":
            sel, text = arg
            self.click(sel)
            p.keyboard.type(text, delay=45)
        elif kind == "fill":
            sel, text = arg
            self.point(sel)
            p.locator(sel).first.fill(text)
        elif kind == "select":
            sel, value = arg
            self.point(sel)
            p.locator(sel).first.select_option(value)
        elif kind == "press":
            p.keyboard.press(arg)
            time.sleep(0.15)
        elif kind == "scroll":
            if isinstance(arg, str):
                loc = p.locator(arg).first
                loc.evaluate("el => el.scrollIntoView({behavior: 'smooth', block: 'center'})")
                time.sleep(0.7)
            else:
                steps = 12
                for _ in range(steps):
                    p.mouse.wheel(0, arg / steps)
                    time.sleep(0.04)
                time.sleep(0.25)
        elif kind == "move":
            self.move_to(*arg)
        elif kind == "wait":
            time.sleep(float(arg))
        elif kind == "wait_for":
            p.locator(arg).first.wait_for(state="visible", timeout=ACTION_TIMEOUT_MS)
        elif kind == "eval":
            p.evaluate(arg)
        else:
            raise ValueError(f"unknown action {a!r}")


# ------------------------------------------------------------------------ output


def mix_narration(clips, total, out_wav):
    buf = array.array("h", bytes(2 * int(total * SAMPLE_RATE)))
    for start, path in clips:
        with wave.open(str(path)) as w:
            data = array.array("h", w.readframes(w.getnframes()))
        i = int(start * SAMPLE_RATE)
        data = data[: max(0, len(buf) - i)]
        buf[i : i + len(data)] = data
    with wave.open(str(out_wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(buf.tobytes())


def srt_time(t):
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"


def write_srt(entries, path):
    lines = []
    for i, (start, end, text) in enumerate(entries, 1):
        lines += [str(i), f"{srt_time(start)} --> {srt_time(end)}", text, ""]
    path.write_text("\n".join(lines))


def contact_sheet(video, times, workdir):
    frames = workdir / "frames"
    shutil.rmtree(frames, ignore_errors=True)
    frames.mkdir()
    for i, t in enumerate(times, 1):
        run(["ffmpeg", "-y", "-ss", f"{max(0, t):.2f}", "-i", str(video), "-frames:v", "1",
             "-vf", "scale=640:-2", str(frames / f"scene-{i:02}.png")])
    cols = 3 if len(times) > 4 else 2
    rows = -(-len(times) // cols)
    sheet = workdir / "contact-sheet.png"
    run(["ffmpeg", "-y", "-framerate", "1", "-i", str(frames / "scene-%02d.png"),
         "-vf", f"tile={cols}x{rows}:padding=6:color=white", "-frames:v", "1", str(sheet)])
    return sheet


# -------------------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("storyboard")
    ap.add_argument("--out", required=True, help="output .mp4 path")
    ap.add_argument("--workdir", help="where intermediate files go (default: a temp dir)")
    ap.add_argument("--headed", action="store_true", help="show the browser while recording")
    args = ap.parse_args()

    sb = json.loads(Path(args.storyboard).read_text())
    scenes = sb["scenes"]
    out = Path(args.out).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    workdir = Path(args.workdir or tempfile.mkdtemp(prefix="demo-video-")).expanduser()
    workdir.mkdir(parents=True, exist_ok=True)

    # 1. Narration first: scene length is driven by how long the voice talks.
    tts = TTS(sb.get("engine", "auto"), sb.get("lang", "en"), sb.get("voice"), float(sb.get("rate", 1.0)))
    for i, sc in enumerate(scenes, 1):
        sc["_audio"] = workdir / f"scene-{i:02}.wav"
        sc["_dur"] = 0.0
    spoken = [sc for sc in scenes if sc.get("say")]
    for sc, dur in zip(spoken, tts.synth_all([(sc["say"], sc["_audio"]) for sc in spoken], workdir)):
        sc["_dur"] = dur

    # 2. Record.
    from playwright.sync_api import sync_playwright

    vp = sb.get("viewport") or {"width": 1280, "height": 720}
    video_dir = workdir / "raw"
    shutil.rmtree(video_dir, ignore_errors=True)
    timeline = []
    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch(headless=not args.headed)
        except Exception as e:
            if "Executable doesn't exist" not in str(e):
                raise
            log("installing Playwright Chromium (one-time)")
            subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=True)
            browser = pw.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(viewport=vp, record_video_dir=str(video_dir), record_video_size=vp,
                                  color_scheme=sb.get("color_scheme", "light"), **(sb.get("context") or {}))
        ctx.add_init_script(CURSOR_JS)
        page = ctx.new_page()
        t0 = time.monotonic()
        page.set_default_timeout(ACTION_TIMEOUT_MS)
        d = Director(page, sb.get("base_url"))

        # Setup is recorded but trimmed off the final video.
        if sb.get("base_url"):
            d.action({"goto": sb["base_url"]})
        else:
            page.set_content("<html><body style='margin:0;background:#0f172a'></body></html>")
        d.ensure_cursor()
        page.mouse.move(d.x, d.y)
        for a in sb.get("setup", []):
            d.action(a)
        if scenes and (scenes[0].get("card") or scenes[0].get("html")):
            page.evaluate(OVERLAY_JS, [card_html(scenes[0]["card"]) if scenes[0].get("card") else scenes[0]["html"],
                                       "card" if scenes[0].get("card") else "html"])
        time.sleep(0.4)

        start = time.monotonic()
        overlay = False
        try:
            for i, sc in enumerate(scenes, 1):
                s = time.monotonic()
                if sc.get("card") or sc.get("html"):
                    d.ensure_cursor()
                    kind = "card" if sc.get("card") else "html"
                    page.evaluate(OVERLAY_JS, [card_html(sc["card"]) if kind == "card" else sc["html"], kind])
                    overlay = True
                elif overlay:
                    page.evaluate(REMOVE_OVERLAY_JS)
                    overlay = False
                for a in sc.get("actions", []):
                    try:
                        d.action(a)
                    except Exception as e:
                        raise SystemExit(f"error: scene {i} action {json.dumps(a)} failed: {str(e).splitlines()[0]}")
                acted = time.monotonic() - s
                end = s + max(sc["_dur"], acted) + float(sc.get("hold", 0)) + SCENE_GAP
                time.sleep(max(0, end - time.monotonic()))
                timeline.append({"scene": i, "start": s - start, "audio": sc["_dur"], "actions": acted,
                                 "end": time.monotonic() - start})
            time.sleep(END_HOLD)
        finally:
            video_path = Path(page.video.path())
            ctx.close()
            browser.close()
    total = time.monotonic() - start
    offset = start - t0

    # 3. Mix narration, write subtitles, mux.
    narration = workdir / "narration.wav"
    mix_narration([(t["start"], sc["_audio"]) for t, sc in zip(timeline, scenes) if sc["_dur"]], total, narration)
    srt = workdir / "subtitles.srt"
    write_srt([(t["start"], t["start"] + sc["_dur"], sc["say"]) for t, sc in zip(timeline, scenes) if sc["_dur"]], srt)
    run(["ffmpeg", "-y", "-ss", f"{offset:.3f}", "-i", str(video_path), "-i", str(narration), "-i", str(srt),
         "-map", "0:v", "-map", "1:a", "-map", "2:s", "-t", f"{total:.3f}",
         "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "25",
         "-c:a", "aac", "-b:a", "128k", "-c:s", "mov_text", "-movflags", "+faststart", str(out)])
    shutil.copy(srt, out.with_suffix(".srt"))
    sheet = contact_sheet(out, [t["end"] - SCENE_GAP - 0.15 for t in timeline], workdir)

    # 4. Report, flagging dead air.
    print(f"video: {out}  ({total:.1f}s)")
    print(f"subtitles: {out.with_suffix('.srt')}")
    print(f"contact sheet (one frame per scene, at its end): {sheet}")
    print("scene  start  voice  actions")
    for t in timeline:
        flag = "  <- silent for {:.1f}s: shorten actions or lengthen narration".format(t["actions"] - t["audio"]) \
            if t["actions"] - t["audio"] > 1.0 else ""
        print(f"{t['scene']:>5}  {t['start']:5.1f}  {t['audio']:5.1f}  {t['actions']:7.1f}{flag}")


if __name__ == "__main__":
    main()
