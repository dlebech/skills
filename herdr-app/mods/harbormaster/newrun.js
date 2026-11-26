// The "+ New run" dialog (role "newrun"): start an orchestrator in a repository's own space as a
// new tab, without the captain and without switching the user's view, as herdr-app-captain's
// "Start a run" does. openNewRun({repo, kind, input, url}) opens the dialog (Crew's header button
// and the Review buttons call it; a Review button prefills the folder, the PR and the kind, and
// nothing starts until Start). The prompt, arguments and the remembered choices are in startrun.js.

import { div } from "gpui-kit";
import { InputState, Input, TextareaState, Textarea, v_flex, h_flex } from "gpui-base";
import { exec, focused, terminals, openOverlay, closeOverlay, props, notify, readTextFile, writeTextFile, spaces, panes, home, checking } from "herdr";
import { repoRoot, openFolders, runFolders, scanFolders, isFolder } from "./repospaces.js";
import { recentFolders, listFolders, matchFolders, literalFolder, tilde, base, newSpaceId, spaceAt, ownId, machineLabel } from "./folders.js";
import {
  KINDS, DRAFTS, profileText, parseProfile, profileFor, buildPrompt, inputProblem, runAgentName, startArgs,
  startOutcome, parsePrefs, AGENTS, agentFor, agentLabel, lastProfile, prefillProfile, roleValue, modelProblems, setRole, parsePiModels, parseOpencodeModels, CAPTAIN_PROMPT, captainProblem, captainName, captainArgs, draftsFor, remember, markReviewStarted, clearReviewStarted, reviewStarting,
} from "./startrun.js";
export { reviewStarting } from "./startrun.js";

// `on`: the machine to run it on (a space's `machine`), null for this one. A run in another
// machine's folder is started there: its start-agent.sh, its runs root, its agents.
const sh = (script, args = [], timeout, on = null) => {
  const o = { ...(timeout ? { timeout } : {}), ...(on ? { on } : {}) };
  return exec("sh", ["-c", script, "_", ...args], Object.keys(o).length ? o : undefined);
};

// The runs root, where the remembered choices (this machine's) and the prompt file (the run's machine's) go.
const rootDir = async (on = null) => (await sh('printf %s "${HERDR_ORCHESTRATION_ROOT:-$HOME/.herdr/hc-orchestration}"', [], on ? 10000 : undefined, on)).stdout.trim();
const prefsFile = async () => `${await rootDir()}/.newrun.json`;

export async function loadPrefs() {
  return parsePrefs(await readTextFile(await prefsFile()).catch(() => null) ?? "");
}
// Herdr's write is atomic and rejects a stale snapshot (another start saved first): read again, once.
async function updatePrefs(change) {
  const file = await prefsFile();
  await sh('mkdir -p "$(dirname "$1")"', [file]);
  for (let tries = 0; ; tries++) {
    const text = await readTextFile(file).catch(() => null);
    try { return await writeTextFile(file, JSON.stringify(change(parsePrefs(text ?? "")), null, 2) + "\n", text); }
    catch (e) { if (tries) throw e; }
  }
}

// The orchestrator skill's start-agent.sh: beside the installed captain skill, else where Claude
// Code or `npx skills` put skills. Run through bash, so a lost exec bit does not matter.
const findScript = async (on = null) => {
  const r = await sh('for d in "$HOME/.claude/skills" "$HOME/.agents/skills"; do for c in "$d/herdr-app-captain/../herdr-app-orchestrator" "$d/herdr-app-orchestrator"; do s="$c/scripts/start-agent.sh"; [ -f "$s" ] && { printf %s "$s"; exit 0; }; done; done; exit 1', [], on ? 10000 : undefined, on).catch(() => null);
  return r?.code === 0 ? r.stdout : null;
};

// The agents start-agent.sh knows that are installed here, in AGENTS' order. Herdr's own PATH can
// lack what the user's shell adds (opencode's ~/.opencode/bin, say), so the login shell's PATH counts too.
const AGENT_IDS = AGENTS.map((a) => a.id);
// Puts the login shell's PATH after Herdr's, for what follows in the same script.
const LOGIN_PATH = `p=$("\${SHELL:-sh}" -lic 'printf "\n__PATH__%s\n" "$PATH"' </dev/null 2>/dev/null | sed -n 's/^__PATH__//p' | tail -n 1)
PATH="$PATH\${p:+:$p}"
`;
export async function installedAgents(on = null) {
  const r = await sh(`${LOGIN_PATH}for a in "$@"; do command -v "$a" >/dev/null 2>&1 && printf '%s\n' "$a"; done; exit 0`, AGENT_IDS, on ? 15000 : 8000, on).catch(() => null);
  const found = new Set((r?.stdout ?? "").split("\n").map((l) => l.trim()));
  return AGENT_IDS.filter((a) => found.has(a));
}

// Each installed agent's model list ({opencode: [...], pi: [...]}), so the profile line is checked
// before a start instead of the orchestrator finding out. Claude Code has no list; one that fails is left out (not checked).
const LISTS = { opencode: ["models", parseOpencodeModels], pi: ["--list-models", parsePiModels] };
export async function agentModels(installed, on = null) {
  const out = {};
  await Promise.all(installed.filter((a) => LISTS[a]).map(async (a) => {
    const [arg, parse] = LISTS[a];
    const r = await sh(`${LOGIN_PATH}"$1" "$2" 2>/dev/null`, [a, arg], 20000, on).catch(() => null);
    const list = r?.code === 0 ? parse(r.stdout) : [];
    if (list.length) out[a] = list;
  }));
  return out;
}

// Starts the run: {ok, address} or {ok: false, error, started?}; it never throws. `repo` is
// {space, name, root, machine}: the folder's open space, or {space: null} for a folder with none, where
// start-agent.sh makes Herdr open one (sp-<name>) in the background, as the captain's Start a run does.
// `machine` (null: this one) is where it starts.
export async function launch(args) {
  try { return await launchRun(args); }
  catch (e) { return { ok: false, error: `Could not start it: ${String(e?.message ?? e).split("\n")[0].slice(0, 160)}` }; }
}

async function launchRun({ repo, kind, input, profile, drafts, agent = "claude" }) {
  const problem = inputProblem(kind, input);
  if (problem) return { ok: false, error: problem };
  if (!repo) return { ok: false, error: "Pick a folder first" };
  const name = runAgentName(repo.name, kind, input);
  return startAgent({
    // The orchestrator's own model, when the line gives one; else the agent's default.
    repo, name, prompt: buildPrompt({ kind, input, profile, drafts, agent }), args: (a) => startArgs({ ...a, kind: agent, model: roleValue(profile.orchestrator, agent).model }),
    // Remembered once it started, so a typo'd start leaves the last good profile alone.
    remembered: async () => ({ kind, profile, repo: draftsKey(await repoRoot(repo.root, repo.machine ?? null), repo.machine), recent: !repo.machine, drafts, agent }),
  });
}

// Starts the captain in a folder, the same way: {ok, address} or {ok: false, error, started?}; never throws.
export async function launchCaptain({ repo }) {
  try {
    const live = terminals();
    const problem = captainProblem(live);
    if (problem) return { ok: false, error: problem };
    if (!repo) return { ok: false, error: "Pick a folder first" };
    return await startAgent({
      repo, name: captainName(live), prompt: CAPTAIN_PROMPT, args: captainArgs,
      remembered: async () => ({ kind: "captain", profile: null, repo: draftsKey(repo.root, repo.machine), recent: !repo.machine, drafts: "herdr" }),
    });
  } catch (e) { return { ok: false, error: `Could not start it: ${String(e?.message ?? e).split("\n")[0].slice(0, 160)}` }; }
}

// The one start path of a run and the captain: the prompt in a task file, start-agent.sh with
// `args({name, cwd, taskFile, spaceId})`, the file removed, and on a start `remembered()` (the choices to keep) saved.
async function startAgent({ repo, name, prompt, args, remembered }) {
  const on = repo.machine ?? null;
  const script = await findScript(on);
  if (!script) return { ok: false, error: `The orchestrator skill is not installed${on ? ` on ${on}` : ""}: npx skills add dlebech/skills --skill herdr-app-orchestrator` };
  const taskFile = `${await rootDir(on)}/.newrun-${name}.txt`;
  // A fresh machine may have no runs root yet (the captain, which makes it, is optional). A task file
  // left by an interrupted start is removed: Herdr's write of a new file refuses one that exists.
  await sh('mkdir -p "$(dirname "$1")" && rm -f "$1"', [taskFile], on ? 10000 : undefined, on);
  // Herdr's writeTextFile is this machine's; another machine's file is written through sh.
  if (on) { const w = await sh('printf %s "$2" > "$1"', [taskFile, prompt + "\n"], 10000, on); if (w.code !== 0) throw new Error(w.stderr || "could not write the task file"); }
  else await writeTextFile(taskFile, prompt + "\n", null);
  // start-agent.sh waits for the agent to take its task, up to two minutes. Its space id is as the
  // run's machine names it (Herdr prefixes another machine's ids with "<machine>/").
  const spaceId = ownId(repo.space ?? repo.spaceId ?? newSpaceId(repo.root, spaces(), on), on);
  // On another machine Herdr's shell there has a bare PATH (no ~/.local/bin, where hc and the agents
  // usually are): the login shell's PATH is added first, as for the agents' check.
  const argv = [script, ...args({ name, cwd: repo.root, taskFile, spaceId })];
  const res = await (on
    ? exec("sh", ["-c", `${LOGIN_PATH}export PATH; exec bash "$@"`, "_", ...argv], { timeout: 150000, on })
    : exec("bash", argv, { timeout: 150000 })).catch((e) => ({ code: -1, stdout: "", stderr: e?.message ?? String(e) }));
  await sh('rm -f "$1"', [taskFile], on ? 10000 : undefined, on).catch(() => {});
  const out = startOutcome(res.code, res.stdout, res.stderr);
  if (out.ok || out.started) {
    const what = await remembered().catch(() => null);
    if (what) await updatePrefs((prefs) => remember(prefs, what)).catch(() => {});
  }
  return out;
}

// Reviews being started from a dialog, by PR url. A second Start of the same PR (another
// dialog, a double click) must not start a second review.
const starting = new Set();

// The guard around a review's start from the dialog: marks its PR (`url`) "starting…" at once and
// clears the mark when nothing started. `run` is the start; the guard answers a repeat without running it.
export async function guardReview({ id, url, run }) {
  // Refused while one is in flight, and while the PR is marked starting (a start that already returned, from another dialog).
  if (starting.has(id) || reviewStarting(url)) { try { notify({ title: "Already starting", body: "That review is being started", level: "info", timeout: 4000 }); } catch { /* no toast mod */ } return { ok: false, error: "already starting" }; }
  starting.add(id);
  markReviewStarted(url);
  try {
    const out = await run();
    if (!out.ok && !out.started) clearReviewStarted(url);
    return out;
  } catch (e) {
    clearReviewStarted(url);
    throw e;
  } finally { starting.delete(id); }
}

// The key a folder's drafts mode and recents are remembered under: the folder on this machine,
// "<machine>:<folder>" on another (the same path there is another checkout).
export const draftsKey = (folder, machine) => (machine && folder ? `${machine}:${folder}` : folder);

// Whether an entry is the folder asked for (a path or a name), on the machine asked for when one is
// (`machine` undefined: any).
const isWanted = (e, want, machine) => (machine === undefined || (e.machine ?? null) === machine) && (e.folder === want || base(e.folder) === want || e.name === want);

// The entries with the folder asked for (an absolute path) added when none lists it, so a clone
// that has no space and is not a recent folder can still be chosen; on `machine` when given; pure.
export function withFolder(entries, want, machine) {
  if (!want || !String(want).startsWith("/") || entries.some((e) => isWanted(e, want, machine))) return entries;
  return [...entries, { ...literalFolder(want, ""), machine: machine ?? null }];
}

// Opens the dialog; every field is optional. `repo` is a folder or its name, on `machine` (null or
// undefined: this one, or any when only a name is given). `url`: a review's PR, marked "starting…"
// in Next for you once its Start starts it.
export function openNewRun({ repo, machine, kind, input, url } = {}) {
  return openOverlay({ mod: "harbormaster", kind: "dialog", width: 560, height: 760, props: { role: "newrun", repo, ...(machine !== undefined ? { machine } : {}), kind, input, url } });
}

// The same dialog with only the folder, for starting the captain (the "no captain running" spots).
export function openStartCaptain() {
  return openOverlay({ mod: "harbormaster", kind: "dialog", width: 520, height: 440, props: { role: "newrun", kind: "captain" } });
}

// ---- the dialog ----

let bound = false;
const ROWS = 7; // list rows that fit; the rest scroll in with the highlight

// Called from the view's init: the fields, and the folders and remembered choices read async.
export function initNewRun(view, cx) {
  const p = props() ?? {};
  const kind = p.kind === "captain" || KINDS.some((k) => k.id === p.kind) ? p.kind : "issue";
  const nr = view.nr = { kind, entries: [], found: [], typedDir: null, folder: null, open: false, sel: 0, query: "", shown: "",
    home: home(), top: 0, memo: null, drafts: "herdr", prefs: null, error: null, busy: false, prefill: "", agent: "claude", agents: [], models: {}, modelsReady: false };
  // The work can run to a few lines: a textarea that grows with it (Enter is a new line).
  nr.text = TextareaState.new({ placeholder: "" });
  nr.text.set_auto_grow(3, 8);
  nr.profile = InputState.new({ placeholder: "implementer=sonnet reviewer=opus specialist=opus autonomy=L1" });
  nr.where = InputState.new({ placeholder: "Type to find a folder" });
  nr.text.set_value(String(p.input ?? ""));
  nr.text.on("submit", (_e, cx) => start(view, cx));
  nr.profile.on("submit", (_e, cx) => start(view, cx));
  nr.profile.on("change", (_e, cx) => { nr.error = null; cx.notify(); }); // its suggestions follow the typing
  nr.where.on("submit", (_e, cx) => (nr.open && shownList(nr).length ? choose(view, shownList(nr)[nr.sel], cx) : start(view, cx, true)));
  nr.where.on("change", (_e, cx) => typed(view, cx));
  nr.where.on("focus", (_e, cx) => { if (nr.quiet) nr.quiet = false; else openList(view, cx); });
  // The captain dialog has only the folder: focus it, without opening the list over Start.
  if (kind === "captain") { nr.quiet = true; nr.where.focus(); } else nr.text.focus();
  // Escape closes the list before it closes the dialog: bound to an action inside the open list's own context.
  if (!bound) { try { bound = cx.bind_keys([{ keystroke: "escape", action: "harbormaster-folder-list-close", context: "HarborFolderList" }]) > 0; } catch { /* no binding: Esc closes the dialog */ } }
  if (checking()) return; // herdr-app check runs init for real: no find, git or jq then
  cx.spawn(async (cx) => {
    const [spaceEntries, prefs] = await Promise.all([openFolders().catch(() => []), loadPrefs()]);
    const runs = await runFolders(await rootDir());
    nr.prefs = prefs;
    nr.entries = withFolder(listFolders({ spaces: spaceEntries, recents: recentFolders(prefs.folders, runs) }), p.repo, p.machine);
    const pick = chooseFolder(nr.entries, p.repo, p.machine);
    if (pick) setFolder(view, pick);
    // The agents of the machine the folder is on (a review of another machine's checkout starts there).
    const on = pick?.machine ?? null;
    nr.agentsOn = on;
    nr.agentsPending = true;
    nr.drafts = draftsFor(prefs, draftKey(nr));
    // The folders typed text may find: scanned once the lists are known, cheap and cached; with the agents, in parallel.
    const scan = scanFolders(nr.entries, nr.home).catch(() => []).then((found) => { nr.found = found; cx.notify(); });
    const agents = await installedAgents(on).catch(() => []);
    // Another machine's folder chosen meanwhile: agentsFor asks that machine, and its answer is the one kept.
    if (nr.agentsOn === on) {
      nr.agents = agents;
      nr.agent = agentFor(prefs, agents);
      nr.agentsPending = false;
      setProfile(nr);
      cx.notify();
      // The models, to check the line against.
      const got = await agentModels(agents, on).catch(() => ({}));
      if (nr.agentsOn === on) { nr.models = got; nr.modelsReady = true; cx.notify(); }
    }
    await scan;
  });
}

// The folder asked for (a path or a name, on its machine when one is given), else the focused space's, else the first listed.
function chooseFolder(entries, want, machine) {
  const f = (() => { try { return focused(); } catch { return null; } })();
  const by = (fn) => entries.find(fn);
  return (want && by((e) => isWanted(e, want, machine)))
    || (f && (by((e) => e.space && e.space === f.space) || by((e) => f.cwd && (f.cwd === e.folder || f.cwd.startsWith(`${e.folder}/`)))))
    || entries[0] || null;
}

// The input's text for an entry: its folder, after "<machine>: " when it is another machine's.
export const shownText = (entry, home) => `${entry.machine ? `${entry.machine}: ` : ""}${entry.machine ? entry.folder : tilde(entry.folder, home)}`;

// Makes it the chosen folder and shows it in the input without that counting as typing.
function setFolder(view, entry, cx = null) {
  const nr = view.nr;
  nr.folder = entry;
  nr.shown = shownText(entry, nr.home);
  nr.where.set_value(nr.shown);
  nr.drafts = draftsFor(nr.prefs, draftsKey(entry.folder, entry.machine));
  // Drafts are remembered per repository root, not per folder: refine once git has said which.
  nr.root = null;
  repoRoot(entry.folder, entry.machine ?? null).then((root) => { if (nr.folder === entry) { nr.root = draftsKey(root, entry.machine); nr.drafts = draftsFor(nr.prefs, nr.root); } }).catch(() => {});
  if (cx) agentsFor(view, cx);
}

// The agents (and their models) of the chosen folder's machine: asked again when it moves to another machine.
function agentsFor(view, cx) {
  const nr = view.nr, on = nr.folder?.machine ?? null;
  if (nr.agentsOn === undefined || nr.agentsOn === on || checking()) return;
  nr.agentsOn = on;
  nr.agentsPending = true;
  nr.modelsReady = false;
  cx.spawn(async (cx) => {
    const agents = await installedAgents(on).catch(() => []);
    if (nr.agentsOn !== on) return;
    nr.agentsPending = false;
    nr.agents = agents;
    nr.agent = agentFor(nr.prefs, agents);
    setProfile(nr);
    cx.notify();
    const models = await agentModels(agents, on).catch(() => ({}));
    if (nr.agentsOn !== on) return;
    nr.models = models;
    nr.modelsReady = true;
    cx.notify();
  });
}

// The dialog still holds the PR it was opened for: only then is that PR's row the one being started.
export const sameReview = (kind, text, opened) => kind === "review" && String(text).trim() === String(opened ?? "").trim();
const sameAsOpened = (nr) => sameReview(nr.kind, nr.text.value(), props()?.input);

// Until git has said which repository root, the folder itself (on its machine).
const draftKey = (nr) => nr.root ?? draftsKey(nr.folder?.folder, nr.folder?.machine);

function choose(view, entry, cx) {
  const nr = view.nr;
  if (!entry) return;
  setFolder(view, entry, cx);
  nr.open = false; nr.error = null;
  cx.notify();
}

// Opens the list with everything in it and selects the text, so typing replaces the folder.
function openList(view, cx) {
  const nr = view.nr;
  if (nr.open || !nr.entries.length) return;
  nr.open = true; nr.sel = 0; nr.top = 0; nr.query = "";
  nr.where.set_selected_range({ start: 0, end: nr.where.value().length });
  cx.notify();
}

// What the list shows: everything listed while the text is the chosen folder, else the matches.
// Memoised on what it depends on: render, keys and Start all ask.
export function shownList(nr) {
  const k = [nr.query, nr.entries, nr.found, nr.typedDir];
  if (nr.memo && nr.memo.k.every((x, i) => x === k[i])) return nr.memo.list;
  const hits = matchFolders(nr.query, nr.entries, nr.found, 20, nr.home);
  const list = nr.typedDir && !hits.some((h) => h.folder === nr.typedDir.folder) ? [...hits, nr.typedDir] : hits;
  nr.memo = { k, list };
  return list;
}

// The folder input changed: typing opens the list and matches; a typed path is checked on disk.
function typed(view, cx) {
  const nr = view.nr, text = nr.where.value();
  if (text === nr.shown) return;
  nr.open = true; nr.sel = 0; nr.top = 0; nr.error = null;
  nr.query = text.trim();
  const lit = literalFolder(nr.query, nr.home);
  nr.typedDir = null;
  cx.notify();
  if (lit) cx.spawn(async (cx) => {
    if (await isFolder(lit.folder) && nr.query === text.trim()) { nr.typedDir = lit; cx.notify(); }
  });
}

// Prefills the profile line, unless the user has edited it since the last prefill.
function setProfile(nr) {
  if (nr.profile.value() !== nr.prefill && nr.profile.value() !== "") return;
  nr.prefill = profileText(prefillProfile(nr.prefs, nr.kind, nr.agent));
  nr.profile.set_value(nr.prefill);
}

// What Start runs in, or null: the chosen folder; a typed text that names a listed folder exactly
// (its path, ~ path or name); or, when Enter was pressed in the folder input with the list open, the row
// highlighted. Never a guess: Enter in another field does not take a row the user never picked.
export function target(nr, fromList = false) {
  const text = nr.where.value().trim();
  if (text === nr.shown) return nr.folder;
  if (!text) return null;
  const exact = nr.entries.find((e) => (!e.machine && (e.folder === text || tilde(e.folder, nr.home) === text || (e.name === text && e.space))) || (e.machine && shownText(e, nr.home) === text));
  return exact ?? (fromList && nr.open ? shownList(nr)[nr.sel] ?? null : null);
}

// Start (the button, or Enter): what is wrong is said at once; else "Starting…" and the start
// runs in a task. The click's cx is gone after its first await (a stale-context error that
// nothing shows), so everything after one uses the task's own.
// What the profile line names that is not installed or not in its agent's list; none while the lists load.
const lineProblems = (nr, profile) => (profile ? modelProblems(profile, { agent: nr.agent, models: nr.modelsReady ? nr.models : Object.fromEntries(nr.agents.map((a) => [a, null])), installed: nr.agents.length ? nr.agents : ["claude"] }) : []);

const lineProblem = (nr, profile) => { const w = lineProblems(nr, profile)[0]; return w ? `${w.role}: ${w.why}` : null; };

function start(view, cx, fromList = false) {
  const nr = view.nr;
  if (nr.busy || nr.done) return;
  const pick = target(nr, fromList);
  if (pick && pick !== nr.folder) setFolder(view, pick, cx);
  const captain = nr.kind === "captain";
  const { profile, bad } = captain ? { profile: null, bad: [] } : parseProfile(nr.profile.value(), prefillProfile(nr.prefs, nr.kind, nr.agent));
  const problem = !pick ? "Pick a folder from the list"
    // Another machine's agents are still being asked for: a start now would use the wrong machine's pick.
    : nr.agentsPending && pick.machine && nr.agentsOn === pick.machine ? `Checking the agents on ${pick.machine}…`
    : captain ? captainProblem(terminals())
    : bad.length ? `Not understood: ${bad.join(" ")}`
    : lineProblem(nr, profile) || inputProblem(nr.kind, nr.text.value());
  if (problem) { nr.error = problem; nr.hint = true; nr.open = false; cx.notify(); return; }
  nr.busy = true; nr.error = null; nr.hint = false; nr.open = false;
  const ask = { pick, profile, kind: nr.kind, input: nr.text.value(), drafts: nr.drafts, agent: nr.agent, overlay: props()?.overlay, url: sameAsOpened(nr) ? props()?.url : null };
  cx.notify();
  cx.spawn((cx) => startNow(view, cx, ask));
}

async function startNow(view, cx, { pick, profile, kind, input, drafts, agent, overlay, url }) {
  const nr = view.nr;
  let out;
  try {
    // A space opened meanwhile counts; and a new space's id must not be another folder's. All on the folder's own machine.
    const open = spaces(), on = pick.machine ?? null;
    if (!pick.space) pick = (await openFolders().catch(() => [])).find((e) => e.folder === pick.folder && e.space && (e.machine ?? null) === on) ?? pick;
    // A space whose folder is stale still has the folder's terminal: that is the space the tab goes in.
    const space = pick.space || spaceAt(pick.folder, open, panes(), on);
    const repo = { space, name: base(pick.folder), root: pick.folder, machine: on, spaceId: space ? null : newSpaceId(pick.folder, open, on) };
    const go = () => launch({ repo, kind, input, profile, drafts, agent });
    out = kind === "captain" ? await launchCaptain({ repo })
      : kind === "review" && url ? await guardReview({ id: url, url, run: go }) : await go();
  } catch (e) { out = { ok: false, error: `Could not start it: ${String(e?.message ?? e).split("\n")[0].slice(0, 160)}` }; }
  nr.busy = false;
  // Started: the new tab is the confirmation. Not quite (the trust prompt, a dialog): say where, calmly.
  if (out.ok) { try { closeOverlay(overlay); } catch { /* closed */ } return; }
  nr.error = out.error;
  if (out.started) nr.done = true;
  cx.notify();
}

const pill = (t, id, label, on, onClick, tip) => div().id(id).flex_none().px(10).h(24).rounded(6).flex().items_center().text_size(12)
  .bg(on ? t.accent + "26" : t.raised).text_color(on ? t.accent : t.muted).when(on, (e) => e.font_semibold())
  .cursor_pointer().hover((s) => s.text_color(t.foreground)).when(Boolean(tip), (e) => e.tooltip(tip))
  .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); }).child(label);

// The text input has no frame of its own.
const framed = (t, state) => div().px(10).py(4).rounded(6).bg(t.raised).child(Input.new(state));
const framedArea = (t, state) => div().px(10).py(6).rounded(6).bg(t.raised).child(Textarea.new(state));

const field = (t, label, ...kids) => v_flex().gap(6).child(div().text_size(11).font_medium().text_color(t.dim).child(label)).children(kids.filter(Boolean));

// Which machine a row is on, as a tag at its start: "this computer" dim, another machine's name in
// the accent colour, so two checkouts of one folder never look alike.
const machineTag = (t, e) => div().flex_none().px(6).h(18).flex().items_center().rounded(4).text_size(10.5).font_medium()
  .bg(e.machine ? t.accent + "22" : t.raised).text_color(e.machine ? t.accent : t.dim).child(machineLabel(e));

// One row of the folder list: which machine, the folder's name, where it is, and which it is (space or recent).
const folderRow = (t, nr, e, i, pick) => h_flex().id(`nr-f-${i}`).px(8).h(30).gap(8).items_center().rounded(5).text_size(12.5)
  .when(i === nr.sel, (el) => el.bg(t.hover)).cursor_pointer().hover((s) => s.bg(t.hover))
  .on_click((_e, cx) => { cx.stop_propagation(); pick(e, cx); })
  .when(nr.machines, (el) => el.child(machineTag(t, e)))
  .child(div().flex_none().text_color(e === nr.folder ? t.accent : t.foreground).child(base(e.folder)))
  .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim)
    .child(`${e.space && e.name !== base(e.folder) ? `${e.name} · ` : ""}${e.machine ? e.folder : tilde(e.folder, nr.home)}`))
  .child(div().flex_none().text_size(11).text_color(t.dim).child(e.space ? "space" : e.recent ? "recent" : ""));

export function newRunView(view, t) {
  const nr = view.nr;
  if (!nr) return div();
  const captain = nr.kind === "captain";
  const kind = KINDS.find((k) => k.id === nr.kind) ?? KINDS[0];
  const set = (patch, cx) => { Object.assign(nr, patch, { error: null }); cx.notify(); };
  const items = nr.open ? shownList(nr) : [];
  // Machine tags only when there is another machine to tell apart.
  nr.machines = nr.entries.some((e) => e.machine);
  const pick = (e, cx) => choose(view, e, cx);
  // Up, Down, Escape move in the list the input opens under it; Enter is the input's own submit.
  const keys = (ev, cx) => {
    if (!nr.open) { if (ev.key === "down") openList(view, cx); return; }
    if (ev.key === "down" || ev.key === "up") {
      const n = shownList(nr).length;
      if (n) {
        nr.sel = (nr.sel + (ev.key === "down" ? 1 : n - 1)) % n;
        nr.top = Math.max(0, Math.min(nr.top, nr.sel), nr.sel - ROWS + 1); // the highlight stays in view
      }
      cx.stop_propagation(); cx.notify();
    }
  };
  const top = Math.min(nr.top, Math.max(0, items.length - ROWS));
  const more = items.length - top - ROWS;
  const list = nr.open && v_flex().gap(2).p(4).rounded(6).bg(t.raised)
    .children(items.length ? [...items.slice(top, top + ROWS).map((e, i) => folderRow(t, nr, e, top + i, pick)),
      ...(more > 0 ? [div().px(8).h(20).text_size(11).text_color(t.dim).child(`+${more} more: keep typing or press Down`)] : [])]
      : [div().px(8).h(28).flex().items_center().text_size(12).text_color(t.dim).child(nr.entries.length ? "No folder matches" : "…")]);
  const drafts = nr.kind === "review" && field(t, "Review comments",
    h_flex().gap(6).children(DRAFTS.map((d) => pill(t, `nr-d-${d.id}`, d.label, nr.drafts === d.id, (cx) => set({ drafts: d.id }, cx), d.tip))),
    nr.drafts === "direct" && div().text_size(11).text_color(t.dim).child("Posted in your name at once. Not remembered as this folder's default."));
  // Only a choice when more than one is installed; with one (or none found) it is that, unsaid.
  const agentRow = nr.agents.length > 1 && field(t, "Agent", h_flex().gap(6).flex_wrap().children(AGENTS.filter((a) => nr.agents.includes(a.id))
    .map((a) => pill(t, `nr-a-${a.id}`, a.label, nr.agent === a.id, (cx) => { nr.agent = a.id; setProfile(nr); set({}, cx); }, a.tip))));
  // The line checked as it is typed: the first role it can't use, and the models that match it, one click each.
  const parsed = captain ? null : parseProfile(nr.profile.value(), prefillProfile(nr.prefs, nr.kind, nr.agent));
  const wrong = parsed && !parsed.bad.length ? lineProblems(nr, parsed.profile)[0] : null;
  const fix = wrong && v_flex().gap(6)
    .child(div().text_size(11).text_color(t.blocked).child(`${wrong.role}: ${wrong.why}${wrong.suggestions.length ? ". Did you mean:" : ""}`))
    .when(wrong.suggestions.length > 0, (el) => el.child(h_flex().gap(6).flex_wrap().children(wrong.suggestions.map((v, i) =>
      pill(t, `nr-m-${i}`, v, false, (cx) => { nr.profile.set_value(setRole(nr.profile.value(), wrong.role, v)); set({}, cx); }, `${wrong.role}=${v}`)))));
  const profileNote = fix || div().text_size(11).text_color(t.dim).child(nr.agent === "claude"
    ? "Another agent for a role: implementer=opencode:<model>. orchestrator=<model> sets the orchestrator's own"
    : `Models as provider/id; a role left out uses ${agentLabel(nr.agent)}'s default, which can change between runs`);
  const startable = Boolean(target(nr));
  const note = !nr.open && (startable
    ? (target(nr).machine ? div().text_size(11).text_color(t.accent).child(`Starts on ${target(nr).machine}${!target(nr).space && !spaceAt(target(nr).folder, spaces(), panes(), target(nr).machine) ? ", in a new space there" : ""}`)
      : !target(nr).space && !spaceAt(target(nr).folder, spaces(), panes()) && div().text_size(11).text_color(t.dim).child("No space for it yet: Herdr opens one in the background"))
    : nr.where.value().trim() && div().text_size(11).text_color(t.dim).child("Pick a folder from the list"));
  return v_flex().size_full().p(20).gap(16).bg(t.background)
    .child(div().text_size(15).font_semibold().text_color(t.foreground).child(captain ? "Start captain" : "New run"))
    .child(field(t, "Folder", div().when(nr.open, (e) => e.key_context("HarborFolderList").on_action("harbormaster-folder-list-close", (_e, cx) => { nr.open = false; cx.notify(); })).on_key_down(keys).on_mouse_down("left", (_e, cx) => openList(view, cx)).child(framed(t, nr.where)), list || note || null))
    .children(captain ? [div().text_size(11).text_color(t.dim).child("Runs /herdr-app-captain in a new tab of that folder's space, without switching your view")] : [])
    .children(captain ? [] : [agentRow, field(t, "What", h_flex().gap(6).children(KINDS.map((k) => pill(t, `nr-k-${k.id}`, k.label, nr.kind === k.id,
      (cx) => { nr.kind = k.id; setProfile(nr); nr.drafts = draftsFor(nr.prefs, draftKey(nr)); set({}, cx); })))),
      field(t, kind.hint, framedArea(t, nr.text), div().text_size(11).text_color(t.dim).child(kind.example)),
      field(t, "Profile", framed(t, nr.profile), profileNote), drafts].filter(Boolean))
    .child(div().flex_1())
    .children([nr.error && div().text_size(12).text_color(nr.done || nr.hint ? t.muted : t.blocked).child(nr.error)].filter(Boolean))
    .child(h_flex().gap(8).justify_end()
      .child(pill(t, "nr-cancel", nr.done ? "Close" : "Cancel", false, () => { try { closeOverlay(props().overlay); } catch { /* closed */ } }))
      .child(div().id("nr-start").px(14).h(28).rounded(6).flex().items_center().text_size(12.5).font_semibold()
        .bg(t.accent).text_color(t.background).when(nr.busy || nr.done || !startable, (e) => e.opacity(0.45))
        // Dim without a folder, but still clickable: the click says what is missing.
        .when(!nr.busy && !nr.done, (e) => e.cursor_pointer().on_click((_e, cx) => { start(view, cx); }))
        .child(nr.busy ? "Starting…" : "Start")));
}
