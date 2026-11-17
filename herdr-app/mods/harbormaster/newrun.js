// The "+ New run" dialog (role "newrun") and the one-click review: start an orchestrator in a
// repository's own space as a new tab, without the captain and without switching the user's
// view, as herdr-app-captain's "Start a run" does. openNewRun({repo, kind, input}) opens the
// dialog (Crew's header button and the Review buttons call it); startReview({repo, pr}) starts
// a review with the remembered settings and no dialog. The prompt, arguments and the remembered
// choices are in startrun.js.

import { div } from "gpui-kit";
import { InputState, Input, v_flex, h_flex } from "gpui-base";
import { exec, focused, terminals, openOverlay, closeOverlay, props, notify, readTextFile, writeTextFile, spaces, home, checking } from "herdr";
import { repoSpaces, knownRepos, repoRoot, openFolders, runFolders, scanFolders, isFolder } from "./repospaces.js";
import { recentFolders, listFolders, matchFolders, literalFolder, tilde, base, newSpaceId } from "./folders.js";
import {
  KINDS, DRAFTS, profileText, parseProfile, profileFor, buildPrompt, inputProblem, runAgentName, startArgs,
  startOutcome, parsePrefs, CAPTAIN_PROMPT, captainProblem, captainName, captainArgs, draftsFor, remember, markReviewStarted, clearReviewStarted,
} from "./startrun.js";
export { reviewStarting } from "./startrun.js";

const sh = (script, args = [], timeout) => exec("sh", ["-c", script, "_", ...args], timeout ? { timeout } : undefined);

// The runs root, where the remembered choices and the prompt file go.
const rootDir = async () => (await sh('printf %s "${HERDR_ORCHESTRATION_ROOT:-$HOME/.herdr/hc-orchestration}"')).stdout.trim();
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
const findScript = async () => {
  const r = await sh('for d in "$HOME/.claude/skills" "$HOME/.agents/skills"; do for c in "$d/herdr-app-captain/../herdr-app-orchestrator" "$d/herdr-app-orchestrator"; do s="$c/scripts/start-agent.sh"; [ -f "$s" ] && { printf %s "$s"; exit 0; }; done; done; exit 1').catch(() => null);
  return r?.code === 0 ? r.stdout : null;
};

// Starts the run: {ok, address} or {ok: false, error, started?}; it never throws. `repo` is
// {space, name, root}: the folder's open space, or {space: null} for a folder with none, where
// start-agent.sh makes Herdr open one (sp-<name>) in the background, as the captain's Start a run does.
export async function launch(args) {
  try { return await launchRun(args); }
  catch (e) { return { ok: false, error: `Could not start it: ${String(e?.message ?? e).split("\n")[0].slice(0, 160)}` }; }
}

async function launchRun({ repo, kind, input, profile, drafts }) {
  const problem = inputProblem(kind, input);
  if (problem) return { ok: false, error: problem };
  if (!repo) return { ok: false, error: "Pick a folder first" };
  const script = await findScript();
  if (!script) return { ok: false, error: "The orchestrator skill is not installed: npx skills add dlebech/skills --skill herdr-app-orchestrator" };
  const name = runAgentName(repo.name, kind, input);
  const taskFile = `${await rootDir()}/.newrun-${name}.txt`;
  // A fresh machine may have no runs root yet (the captain, which makes it, is optional).
  await sh('mkdir -p "$(dirname "$1")"', [taskFile]);
  await writeTextFile(taskFile, buildPrompt({ kind, input, profile, drafts }) + "\n", null);
  // start-agent.sh waits for the agent to take its task, up to two minutes.
  const res = await exec("bash", [script, ...startArgs({ name, cwd: repo.root, taskFile, spaceId: repo.space ?? repo.spaceId ?? newSpaceId(repo.root, spaces()) })], { timeout: 150000 }).catch((e) => ({ code: -1, stdout: "", stderr: e?.message ?? String(e) }));
  await sh('rm -f "$1"', [taskFile]).catch(() => {});
  const out = startOutcome(res.code, res.stdout, res.stderr);
  if (out.ok || out.started) {
    // Remembered once it started, so a typo'd start leaves the last good profile alone.
    const key = await repoRoot(repo.root);
    await updatePrefs((prefs) => remember(prefs, { kind, profile, repo: key, drafts })).catch(() => {});
  }
  return out;
}

// Starts the captain in a folder, the same way: {ok, address} or {ok: false, error, started?}; never throws.
export async function launchCaptain({ repo }) {
  try {
    const live = terminals();
    const problem = captainProblem(live);
    if (problem) return { ok: false, error: problem };
    if (!repo) return { ok: false, error: "Pick a folder first" };
    const script = await findScript();
    if (!script) return { ok: false, error: "The orchestrator skill is not installed: npx skills add dlebech/skills --skill herdr-app-orchestrator" };
    const name = captainName(live);
    const taskFile = `${await rootDir()}/.newrun-${name}.txt`;
    await sh('mkdir -p "$(dirname "$1")"', [taskFile]);
    await writeTextFile(taskFile, CAPTAIN_PROMPT + "\n", null);
    const res = await exec("bash", [script, ...captainArgs({ name, cwd: repo.root, taskFile, spaceId: repo.space ?? repo.spaceId ?? newSpaceId(repo.root, spaces()) })], { timeout: 150000 }).catch((e) => ({ code: -1, stdout: "", stderr: e?.message ?? String(e) }));
    await sh('rm -f "$1"', [taskFile]).catch(() => {});
    const out = startOutcome(res.code, res.stdout, res.stderr);
    if (out.ok || out.started) await updatePrefs((prefs) => remember(prefs, { kind: "captain", profile: null, repo: repo.root, drafts: "herdr" })).catch(() => {});
    return out;
  } catch (e) { return { ok: false, error: `Could not start it: ${String(e?.message ?? e).split("\n")[0].slice(0, 160)}` }; }
}

// The review of one PR with the remembered settings: the one-click path. `repo` is the Review
// row's `local` ({space, root}) or a repository folder; a toast says how it went.
const starting = new Set(); // "<root>#<pr>" being started: a second click must not start a second review

// `url`: the PR's, to mark it started from the click on (reviewStarting); a start that fails clears it.
export async function startReview({ repo, pr, url = null }) {
  const root = typeof repo === "string" ? repo : repo?.root;
  const id = `${root}#${pr}`;
  if (starting.has(id)) { try { notify({ title: "Already starting", body: `PR ${pr} is being started`, level: "info", timeout: 4000 }); } catch { /* no toast mod */ } return { ok: false, error: "already starting" }; }
  starting.add(id);
  markReviewStarted(url);
  try {
    const out = await reviewNow(root, repo, pr);
    if (!out.ok && !out.started) clearReviewStarted(url);
    return out;
  } catch (e) {
    clearReviewStarted(url);
    throw e;
  } finally { starting.delete(id); }
}

// The repository to review in: its open space, else the clone as given (`repo.root`), whose
// space start-agent.sh opens (as herdr-app-captain's Start a run does for a repository with none).
async function reviewRepo(root, repo) {
  const open = (await repoSpaces().catch(() => [])).find((r) => r.root === root || (repo?.space && r.space === repo.space));
  if (open || !root) return open ?? null;
  const clone = (await knownRepos().catch(() => [])).find((r) => r.root === root);
  return clone ?? { space: null, name: root.split("/").pop(), root, origin: null };
}

async function reviewNow(root, repo, pr) {
  let out;
  let found = null;
  try {
    found = await reviewRepo(root, repo);
    const prefs = await loadPrefs();
    out = await launch({
      repo: found, kind: "review", input: String(pr),
      profile: profileFor("review", prefs.profile), drafts: draftsFor(prefs, found?.root),
    });
  } catch (e) { out = { ok: false, error: String(e?.message ?? e).split("\n")[0].slice(0, 160) }; }
  try {
    notify(out.ok ? { title: "Review started", body: `${found.name}: PR ${pr} in a new tab`, level: "success", timeout: 6000 }
      : { title: "Review not started", body: out.error, level: "warning" });
  } catch { /* no toast mod */ }
  return out;
}

// Opens the dialog; every field is optional. `repo` is a folder or its name.
export function openNewRun({ repo, kind, input } = {}) {
  return openOverlay({ mod: "harbormaster", kind: "dialog", width: 520, height: 620, props: { role: "newrun", repo, kind, input } });
}

// The same dialog with only the folder, for starting the captain (the "no captain running" spots).
export function openStartCaptain() {
  return openOverlay({ mod: "harbormaster", kind: "dialog", width: 520, height: 260, props: { role: "newrun", kind: "captain" } });
}

// ---- the dialog ----

let bound = false;
const ROWS = 7; // list rows that fit; the rest scroll in with the highlight

// Called from the view's init: the fields, and the folders and remembered choices read async.
export function initNewRun(view, cx) {
  const p = props() ?? {};
  const kind = p.kind === "captain" || KINDS.some((k) => k.id === p.kind) ? p.kind : "issue";
  const nr = view.nr = { kind, entries: [], found: [], typedDir: null, folder: null, open: false, sel: 0, query: "", shown: "",
    home: home(), top: 0, memo: null, drafts: "herdr", prefs: null, error: null, busy: false, prefill: "" };
  nr.text = InputState.new({ placeholder: "" });
  nr.profile = InputState.new({ placeholder: "implementer=sonnet reviewer=opus specialist=opus autonomy=L1" });
  nr.where = InputState.new({ placeholder: "Type to find a folder" });
  nr.text.set_value(String(p.input ?? ""));
  nr.text.on("submit", (_e, cx) => start(view, cx));
  nr.profile.on("submit", (_e, cx) => start(view, cx));
  nr.where.on("submit", (_e, cx) => (nr.open && shownList(nr).length ? choose(view, shownList(nr)[nr.sel], cx) : start(view, cx, true)));
  nr.where.on("change", (_e, cx) => typed(view, cx));
  nr.where.on("focus", (_e, cx) => openList(view, cx));
  if (kind !== "captain") nr.text.focus();
  // Escape closes the list before it closes the dialog: bound to an action inside the open list's own context.
  if (!bound) { try { bound = cx.bind_keys([{ keystroke: "escape", action: "harbormaster-folder-list-close", context: "HarborFolderList" }]) > 0; } catch { /* no binding: Esc closes the dialog */ } }
  if (checking()) return; // herdr-app check runs init for real: no find, git or jq then
  cx.spawn(async (cx) => {
    const [spaceEntries, prefs] = await Promise.all([openFolders().catch(() => []), loadPrefs()]);
    const runs = await runFolders(await rootDir());
    nr.prefs = prefs;
    nr.entries = listFolders({ spaces: spaceEntries, recents: recentFolders(prefs.folders, runs) });
    const pick = chooseFolder(nr.entries, p.repo);
    if (pick) setFolder(view, pick);
    nr.drafts = draftsFor(prefs, draftKey(nr));
    setProfile(nr);
    cx.notify();
    // The folders typed text may find: scanned once the lists are known, cheap and cached.
    nr.found = await scanFolders(nr.entries, nr.home).catch(() => []);
    cx.notify();
  });
}

// The folder asked for (a path or a name), else the focused space's, else the first listed.
function chooseFolder(entries, want) {
  const f = (() => { try { return focused(); } catch { return null; } })();
  const by = (fn) => entries.find(fn);
  return (want && by((e) => e.folder === want || base(e.folder) === want || e.name === want))
    || (f && (by((e) => e.space && e.space === f.space) || by((e) => f.cwd && (f.cwd === e.folder || f.cwd.startsWith(`${e.folder}/`)))))
    || entries[0] || null;
}

// Makes it the chosen folder and shows it in the input without that counting as typing.
function setFolder(view, entry) {
  const nr = view.nr;
  nr.folder = entry;
  nr.shown = tilde(entry.folder, nr.home);
  nr.where.set_value(nr.shown);
  nr.drafts = draftsFor(nr.prefs, entry.folder);
  // Drafts are remembered per repository root, not per folder: refine once git has said which.
  nr.root = null;
  repoRoot(entry.folder).then((root) => { if (nr.folder === entry) { nr.root = root; nr.drafts = draftsFor(nr.prefs, root); } }).catch(() => {});
}

const draftKey = (nr) => nr.root ?? nr.folder?.folder;

function choose(view, entry, cx) {
  const nr = view.nr;
  if (!entry) return;
  setFolder(view, entry);
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
  const hits = matchFolders(nr.query, nr.entries, nr.found);
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
  nr.prefill = profileText(profileFor(nr.kind, nr.prefs?.profile));
  nr.profile.set_value(nr.prefill);
}

// What Start runs in, or null: the chosen folder; a typed text that names a listed folder exactly
// (its path, ~ path or name); or, when Enter was pressed in the folder input with the list open, the row
// highlighted. Never a guess: Enter in another field does not take a row the user never picked.
export function target(nr, fromList = false) {
  const text = nr.where.value().trim();
  if (text === nr.shown) return nr.folder;
  if (!text) return null;
  const exact = nr.entries.find((e) => !e.machine && (e.folder === text || tilde(e.folder, nr.home) === text || (e.name === text && e.space)));
  return exact ?? (fromList && nr.open ? shownList(nr)[nr.sel] ?? null : null);
}

// Start (the button, or Enter): what is wrong is said at once; else "Starting…" and the start
// runs in a task. The click's cx is gone after its first await (a stale-context error that
// nothing shows), so everything after one uses the task's own.
function start(view, cx, fromList = false) {
  const nr = view.nr;
  if (nr.busy || nr.done) return;
  const pick = target(nr, fromList);
  if (pick && pick !== nr.folder) setFolder(view, pick);
  const captain = nr.kind === "captain";
  const { profile, bad } = captain ? { profile: null, bad: [] } : parseProfile(nr.profile.value(), profileFor(nr.kind, nr.prefs?.profile));
  const problem = !pick ? "Pick a folder from the list"
    : pick.machine ? `That space is on ${pick.machine}: start ${captain ? "the captain" : "the run"} from the Herdr window there`
    : captain ? captainProblem(terminals())
    : bad.length ? `Not understood: ${bad.join(" ")}` : inputProblem(nr.kind, nr.text.value());
  if (problem) { nr.error = problem; nr.hint = true; nr.open = false; cx.notify(); return; }
  nr.busy = true; nr.error = null; nr.hint = false; nr.open = false;
  const ask = { pick, profile, kind: nr.kind, input: nr.text.value(), drafts: nr.drafts, overlay: props()?.overlay };
  cx.notify();
  cx.spawn((cx) => startNow(view, cx, ask));
}

async function startNow(view, cx, { pick, profile, kind, input, drafts, overlay }) {
  const nr = view.nr;
  let out;
  try {
    // A space opened meanwhile counts; and a new space's id must not be another folder's.
    const open = spaces();
    if (!pick.space) pick = (await openFolders().catch(() => [])).find((e) => e.folder === pick.folder && e.space && !e.machine) ?? pick;
    const repo = { space: pick.space, name: base(pick.folder), root: pick.folder, spaceId: pick.space ? null : newSpaceId(pick.folder, open) };
    out = kind === "captain" ? await launchCaptain({ repo }) : await launch({ repo, kind, input, profile, drafts });
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

const field = (t, label, ...kids) => v_flex().gap(6).child(div().text_size(11).font_medium().text_color(t.dim).child(label)).children(kids.filter(Boolean));

// One row of the folder list: the folder's name, where it is, and which it is (space or recent).
const folderRow = (t, nr, e, i, pick) => h_flex().id(`nr-f-${i}`).px(8).h(30).gap(8).items_center().rounded(5).text_size(12.5)
  .when(i === nr.sel, (el) => el.bg(t.hover)).cursor_pointer().hover((s) => s.bg(t.hover))
  .on_click((_e, cx) => { cx.stop_propagation(); pick(e, cx); })
  .child(div().flex_none().text_color(e === nr.folder ? t.accent : t.foreground).child(base(e.folder)))
  .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim)
    .child(`${e.space && e.name !== base(e.folder) ? `${e.name} · ` : ""}${e.machine ? `${e.machine}:` : ""}${tilde(e.folder, nr.home)}`))
  .child(div().flex_none().text_size(11).text_color(t.dim).child(e.space ? "space" : e.recent ? "recent" : ""));

export function newRunView(view, t) {
  const nr = view.nr;
  if (!nr) return div();
  const captain = nr.kind === "captain";
  const kind = KINDS.find((k) => k.id === nr.kind) ?? KINDS[0];
  const set = (patch, cx) => { Object.assign(nr, patch, { error: null }); cx.notify(); };
  const items = nr.open ? shownList(nr) : [];
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
  const startable = Boolean(target(nr));
  const note = !nr.open && (startable
    ? !target(nr).space && !target(nr).machine && div().text_size(11).text_color(t.dim).child("No space for it yet: Herdr opens one in the background")
    : nr.where.value().trim() && div().text_size(11).text_color(t.dim).child("Pick a folder from the list"));
  return v_flex().size_full().p(20).gap(16).bg(t.background)
    .child(div().text_size(15).font_semibold().text_color(t.foreground).child(captain ? "Start captain" : "New run"))
    .child(field(t, "Folder", div().when(nr.open, (e) => e.key_context("HarborFolderList").on_action("harbormaster-folder-list-close", (_e, cx) => { nr.open = false; cx.notify(); })).on_key_down(keys).on_mouse_down("left", (_e, cx) => openList(view, cx)).child(framed(t, nr.where)), list || note || null))
    .children(captain ? [div().text_size(11).text_color(t.dim).child("Runs /herdr-app-captain in a new tab of that folder's space, without switching your view")] : [])
    .children(captain ? [] : [field(t, "What", h_flex().gap(6).children(KINDS.map((k) => pill(t, `nr-k-${k.id}`, k.label, nr.kind === k.id,
      (cx) => { nr.kind = k.id; setProfile(nr); nr.drafts = draftsFor(nr.prefs, draftKey(nr)); set({}, cx); })))),
      field(t, kind.hint, framed(t, nr.text), div().text_size(11).text_color(t.dim).child(kind.example)),
      field(t, "Profile", framed(t, nr.profile)), drafts].filter(Boolean))
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
