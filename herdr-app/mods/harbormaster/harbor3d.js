// Starting Harbor 3D (the browser view in herdr-app/harbor3d) from Harbormaster's "3D ↗" button:
// find its server's output line, start the server in a terminal named harbor3d when there is
// none, open the private URL. The helpers are pure, so the tests drive them.

import { exec, checking } from "herdr";
import { openUrl } from "./live.js";
import { setNote } from "./note.js";

export const TERMINAL = "harbor3d";

// The private URL in the server's output ("Harbor 3D: http://127.0.0.1:<port>/"), or null.
// Only that exact shape counts, so no other text a terminal prints can send the browser elsewhere.
export function urlFromOutput(text) {
  const m = /^Harbor 3D: (http:\/\/127\.0\.0\.1:(\d{1,5})\/)\s*$/m.exec(String(text ?? ""));
  return m && Number(m[2]) > 0 && Number(m[2]) < 65536 ? m[1] : null;
}

// Where install.sh puts the server's entry point.
export const serverPath = (home) => `${String(home).replace(/\/+$/, "")}/harbor3d/bin/harbor3d.js`;

// A live terminal named harbor3d in `hc ls --json`'s output, or false.
export function hasServer(json) {
  try { return (JSON.parse(json).terminals ?? []).some((t) => t.name === TERMINAL && t.state === "live"); } catch { return false; }
}

const NOT_INSTALLED = "Harbor 3D is not installed: run herdr-app/install.sh again";

// The last non-empty line of a terminal's output, cut to 120 characters, or "".
export function lastLine(text) {
  const lines = String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return (lines.at(-1) ?? "").slice(0, 120);
}

// `hc run` arguments that start the server in a terminal named harbor3d: no parent, no notes, and `--` so
// nothing after it is read as an hc option (as wake.js does).
export const startArgs = (home) => ["run", "--bg", "--no-notify", "--no-parent", "--name", TERMINAL, "--", "node", serverPath(home), "serve"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The app's home: $HERDR_APP_HOME or ~/.config/herdr-app.
const appHome = () => exec("sh", ["-c", 'printf "%s" "${HERDR_APP_HOME:-$HOME/.config/herdr-app}"']).then((r) => r.stdout.trim()).catch(() => "");

// The URL in what the server terminal shows now, or null.
const outputNow = () => exec("hc", ["read", "--lines", "20", TERMINAL]).then((r) => r.stdout).catch(() => "");
const urlNow = () => outputNow().then(urlFromOutput);

// Opens Harbor 3D in the browser, starting its server first when it is not running.
// On failure the view shows `note` (a one-line instruction).
export async function openHarbor3d(view) {
  if (checking()) return;
  const fail = (text) => setNote(view, text);
  const ls = await exec("hc", ["ls", "--json"]).catch(() => null);
  let url = hasServer(ls?.stdout) ? await urlNow() : null;
  if (!url) {
    const home = await appHome();
    if (!home) return fail(NOT_INSTALLED);
    const r = await exec("hc", startArgs(home)).catch(() => null);
    if (!r || r.code !== 0) return fail("Harbor 3D could not start: it needs Node 22+ (node on the PATH)");
    for (let i = 0; i < 10 && !url; i++) { await sleep(500); url = await urlNow(); }
  }
  if (url) openUrl(url);
  else {
    // The server says why in its last line (three.js missing, no free port, a crash).
    const why = lastLine(await outputNow());
    fail(why ? `Harbor 3D did not start: ${why}` : NOT_INSTALLED);
  }
}

export const HARBOR3D_TIP = "Open Harbor 3D in the browser: the runs as a 3D harbor. Share it with harbor3d share in a terminal.";
