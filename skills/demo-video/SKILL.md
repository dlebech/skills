---
name: demo-video
description: Record a short narrated demo video of a feature, with a visible mouse cursor, voiceover and subtitles.
disable-model-invocation: true
argument-hint: "[what to show, language, audience, detail, TTS engine — all optional]"
---

Make an MP4 that shows a feature working in the browser while a voice explains it. Keep it as short as it can be while still showing the feature. It should be good, not perfect: no dead air, straight to the point.

## 1. Read the request

`$ARGUMENTS` is free text and may be empty. Pick out:

- **Language**: use one the user names ("in Danish", `da`, `de-DE`). Otherwise use English. Turn it into a code such as `en`, `en-GB` or `da`.
- **Audience**:
  - `colleague` (default): a teammate or end user. Explain what the feature does and why it matters, using the product's own words. No file names, branches or internals.
  - `dev`: the developer, or an orchestrator agent reporting back (for example from herdr). Use this when the user says "for me" or "dev", or asks for a review or status across branches/worktrees. Keep it terse and technical. Name each branch on a card, and say what is unfinished or what to check. Speak about 10% faster (`"rate": 1.1`).
- **Detail**:
  - `brief` (default): only the main path, meaning what's new and how to use it. Skip edge cases and extras.
  - `full`: use this when the user asks for a detailed, full or thorough walkthrough. Also cover guard rails (limits, confirmations), edge cases and extras.

  Either way, show each thing once and cut anything the viewer doesn't need.
- **TTS engine**: set `engine` only if the user names one. Otherwise leave it `auto`, which respects the user's `DEMO_VIDEO_TTS` environment variable if set, and otherwise picks:

  | Engine | Sound | Languages | Cost |
  |---|---|---|---|
  | `kokoro` (auto default where supported) | natural | en, en-GB, es, fr, it, pt, hi | ~340 MB, fast on CPU |
  | `supertonic` (auto otherwise, where supported) | natural | 31, incl. da, de, sv, nl, fi (not no) | ~390 MB, very fast on CPU |
  | `piper` | clear but synthetic | most | ~60 MB per voice |
  | `say` (macOS), `espeak-ng` | robotic, last resort | many | none |

  Kokoro and Supertonic need `uv`.
- **What to show**: if it isn't named, use the current branch's changes (`git log` and `git diff` against the default branch).
- **Anything else** (a phone-sized screen, dark mode, a male voice, "redo yesterday's video"): map it onto the storyboard fields below, or edit and re-record an existing storyboard.

## 2. Get the app running

Find out how the project starts (README, `package.json`, `Makefile`, etc.). Reuse a server that is already running, or start one in the background and wait for its port. Get it into a state worth showing: seed data, a logged-in user, a populated list. Use demo data only; no real customer data, secrets or personal accounts on screen. Any logging in or clicking needed to reach that state goes in `setup`, which is cut from the video. Each take must start from the same state, so `setup` also undoes whatever a previous take created: delete the demo's rows, close panels, clear filters (use `eval` or the app's API if that's easier).

**Several branches or worktrees** (orchestrator case): for each one, gather what changed with `git -C <worktree> log --oneline <base>..HEAD`. Start its app on its own port, or reuse one that is running. Make one video covering all of them, with a card per branch (`repo · branch`) followed by that branch's scenes. Only read from and run servers in other agents' worktrees; don't edit them.

**Nothing to see in a UI** (CLI, API, refactor): use `html` scenes that show terminal output, a request/response, or a before/after table, and keep it short.

Before writing selectors, open the pages yourself (with any browser tool you have, or `curl`). Use selectors that will hold up: roles, text and ids. Avoid long CSS paths.

## 3. Write the storyboard

Write `storyboard.json` (layout below). Rules for good pacing:

- Each scene has 1–2 short spoken sentences, and its actions take about as long as saying them. The voice and the actions run together, and the scene ends when both are done.
- Use as few scenes as the detail level needs. Open with a card that says what the video shows, end on the result, not on "thanks".
- For `colleague`, lead with what's new and why it matters, then show how.
- Say what the viewer is looking at as it happens. Name buttons and fields exactly as they appear on screen ("click Archive"), so viewers can follow along.
- No filler ("So, now we're going to…"). Write numbers and abbreviations the way they should be said out loud.
- Put the cursor on whatever is being talked about: `hover` an element before talking about it, and `click` instead of pressing keys where possible.
- Write `say` text in the chosen language. Card text can stay in English where it names code, such as branch names.

```json
{
  "lang": "en",
  "engine": "auto",
  "rate": 1.0,
  "base_url": "http://localhost:3000",
  "viewport": {"width": 1280, "height": 720},
  "setup": [{"goto": "/login"}, {"fill": ["#email", "demo@example.com"]}, {"click": "text=Sign in"}],
  "scenes": [
    {"card": {"kicker": "Acme · feat/bulk-edit", "title": "Bulk editing", "subtitle": "Change many rows at once"},
     "say": "Here's the new bulk editing in the orders table."},
    {"say": "Select a few orders, and an action bar appears.",
     "actions": [{"goto": "/orders"}, {"click": "tr:nth-child(1) input[type=checkbox]"}, {"click": "tr:nth-child(2) input[type=checkbox]"}]},
    {"say": "Pick a new status, and both orders update together.",
     "actions": [{"select": ["#bulk-status", "shipped"]}, {"click": "role=button[name='Apply']"}, {"hover": "tr:nth-child(1) .status"}]},
    {"html": "<pre style='font-size:20px'>$ npm test\n✓ 128 passed</pre>", "say": "All tests pass."}
  ]
}
```

- Top level: `lang`, `engine` (`auto|kokoro|supertonic|piper|say|espeak-ng`), `voice` (optional: a Kokoro voice such as `af_heart` or `am_michael`, a Supertonic voice `F1`–`F5` or `M1`–`M5` (default `F1`), a Piper voice name such as `en_GB-alan-medium` or an `.onnx` path, a `say` voice name, or an espeak voice), `rate` (1.0 = normal speed), `base_url`, `viewport`, `color_scheme`, `setup`, `scenes`. `context` passes extra Playwright context options, such as `{"storage_state": "auth.json"}`.
- Scene: `say`, `actions`, optional `hold` (extra seconds), and either `card` (a title card: `title`, optional `kicker` and `subtitle`) or `html` (any HTML on a white full-screen panel). Card and html scenes hide the app and the cursor. Put the next `goto` in the following scene.
- Actions, one key each: `goto` (path or URL), `click`, `hover`, `type` (`[selector, text]`, typed visibly), `fill` (`[selector, text]`, instant), `select` (`[selector, value]`), `press` (key), `scroll` (pixels, or a selector to scroll to), `move` (`[x, y]`), `wait` (seconds), `wait_for` (selector), `eval` (JS).

## 4. Record

Save the video to `~/Videos/demos/` (on macOS, `~/Movies/demos/`) as `YYYY-MM-DD-<slug>.mp4`, unless the user named a different place. Keep the storyboard next to it as `<slug>.storyboard.json` so it can be recorded again.

```sh
uv run <skill-dir>/scripts/record_demo.py <slug>.storyboard.json --out <dir>/<date>-<slug>.mp4
```

(Without `uv`, run `pip install playwright` and use `python3`.) The first run downloads Playwright's Chromium, and the voice model for the chosen engine. The script prints the size before a large download. The script needs `ffmpeg`.

The script prints the video path, an `.srt` file next to the video (the subtitles are also embedded), a contact sheet with one frame from the end of each scene, and a timing table per scene.

## 5. Check it, then fix and record again

- Look at the contact sheet. Is each scene showing what its narration says, with the cursor visible? Are there error pages, empty lists, or a login screen?
- Fix every scene that is flagged as silent: cut or speed up actions, split the scene, or add a sentence.
- If a selector fails, the script stops and names the scene and action. Fix the selector and run it again.
- Stop when the video is good enough; it doesn't have to be polished.

Finally, print the video path, how long it is, and the scene list (one line each).
