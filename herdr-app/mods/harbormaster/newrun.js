// The "+ New run" dialog (role "newrun") and the one-click review: start an orchestrator in a
// repository's own space as a new tab, without the captain and without switching the user's
// view, as herdr-app-captain's "Start a run" does. openNewRun({repo, kind, input}) opens the
// dialog (Crew's header button and the Review buttons call it); startReview({repo, pr}) starts
// a review with the remembered settings and no dialog. The prompt, arguments and the remembered
// choices are in startrun.js.

import { div } from "gpui-kit";
import { InputState, Input, v_flex, h_flex } from "gpui-base";
import { exec, focused, openOverlay, closeOverlay, props, notify, readTextFile, writeTextFile } from "herdr";
import { repoSpaces, knownRepos, spaceIdFor } from "./repospaces.js";
import {
  KINDS, DRAFTS, profileText, parseProfile, profileFor, buildPrompt, inputProblem, runAgentName, startArgs,
  startOutcome, parsePrefs, draftsFor, remember, markReviewStarted, clearReviewStarted,
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

// Starts the run: {ok, address} or {ok: false, error, started?}; it never throws. `repo` is a
// repoSpaces() entry, or a clone's ({space: null}: start-agent.sh then opens its space).
export async function launch(args) {
  try { return await launchRun(args); }
  catch (e) { return { ok: false, error: `Could not start it: ${String(e?.message ?? e).split("\n")[0].slice(0, 160)}` }; }
}

async function launchRun({ repo, kind, input, profile, drafts }) {
  const problem = inputProblem(kind, input);
  if (problem) return { ok: false, error: problem };
  if (!repo) return { ok: false, error: "Open the repository in a space first, then start the run there" };
  const script = await findScript();
  if (!script) return { ok: false, error: "The orchestrator skill is not installed: npx skills add dlebech/skills --skill herdr-app-orchestrator" };
  const name = runAgentName(repo.name, kind, input);
  const taskFile = `${await rootDir()}/.newrun-${name}.txt`;
  // A fresh machine may have no runs root yet (the captain, which makes it, is optional).
  await sh('mkdir -p "$(dirname "$1")"', [taskFile]);
  await writeTextFile(taskFile, buildPrompt({ kind, input, profile, drafts }) + "\n", null);
  // start-agent.sh waits for the agent to take its task, up to two minutes.
  const res = await exec("bash", [script, ...startArgs({ name, cwd: repo.root, taskFile, spaceId: repo.space ?? spaceIdFor(repo.name) })], { timeout: 150000 }).catch((e) => ({ code: -1, stdout: "", stderr: e?.message ?? String(e) }));
  await sh('rm -f "$1"', [taskFile]).catch(() => {});
  const out = startOutcome(res.code, res.stdout, res.stderr);
  if (out.ok || out.started) {
    // Remembered once it started, so a typo'd start leaves the last good profile alone.
    await updatePrefs((prefs) => remember(prefs, { kind, profile, repo: repo.root, drafts })).catch(() => {});
  }
  return out;
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

// Opens the dialog; every field is optional. `repo` is a folder or a repository's name.
export function openNewRun({ repo, kind, input } = {}) {
  return openOverlay({ mod: "harbormaster", kind: "dialog", width: 520, height: 560, props: { role: "newrun", repo, kind, input } });
}

// ---- the dialog ----

// Called from the view's init: the fields, and the repositories and remembered choices read async.
export function initNewRun(view, cx) {
  const p = props() ?? {};
  const kind = KINDS.some((k) => k.id === p.kind) ? p.kind : "issue";
  const nr = view.nr = { kind, repos: [], repo: null, picking: false, drafts: "herdr", prefs: null, error: null, busy: false, prefill: "" };
  nr.text = InputState.new({ placeholder: "" });
  nr.profile = InputState.new({ placeholder: "implementer=sonnet reviewer=opus specialist=opus autonomy=L1" });
  nr.text.set_value(String(p.input ?? ""));
  nr.text.on("submit", (_e, cx) => start(view, cx));
  nr.profile.on("submit", (_e, cx) => start(view, cx));
  nr.text.focus();
  cx.spawn(async (cx) => {
    const [repos, prefs] = await Promise.all([repoSpaces().catch(() => []), loadPrefs()]);
    nr.repos = repos;
    nr.prefs = prefs;
    nr.repo = chooseRepo(repos, p.repo);
    nr.drafts = draftsFor(prefs, nr.repo?.root);
    setProfile(nr);
    cx.notify();
  });
}

// The repository asked for, else the focused space's, else the first open.
function chooseRepo(repos, want) {
  const f = (() => { try { return focused(); } catch { return null; } })();
  const by = (fn) => repos.find(fn);
  return (want && by((r) => r.root === want || r.name === want || r.origin === String(want).toLowerCase()))
    || (f && (by((r) => r.space === f.space) || by((r) => f.cwd && (f.cwd === r.root || f.cwd.startsWith(`${r.root}/`)))))
    || repos[0] || null;
}

// Prefills the profile line, unless the user has edited it since the last prefill.
function setProfile(nr) {
  if (nr.profile.value() !== nr.prefill && nr.profile.value() !== "") return;
  nr.prefill = profileText(profileFor(nr.kind, nr.prefs?.profile));
  nr.profile.set_value(nr.prefill);
}

async function start(view, cx) {
  const nr = view.nr;
  if (nr.busy) return;
  const { profile, bad } = parseProfile(nr.profile.value(), profileFor(nr.kind, nr.prefs?.profile));
  const problem = bad.length ? `Not understood: ${bad.join(" ")}` : inputProblem(nr.kind, nr.text.value());
  if (problem) { nr.error = problem; nr.hint = true; cx.notify(); return; }
  nr.busy = true; nr.error = null; nr.hint = false; cx.notify();
  let out;
  try { out = await launch({ repo: nr.repo, kind: nr.kind, input: nr.text.value(), profile, drafts: nr.drafts }); }
  catch (e) { out = { ok: false, error: String(e?.message ?? e) }; }
  finally { nr.busy = false; }
  // Started: the new tab is the confirmation. Not quite (the trust prompt, a dialog): say where, calmly.
  if (out.ok) { try { closeOverlay(props().overlay); } catch { /* closed */ } return; }
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

export function newRunView(view, t) {
  const nr = view.nr;
  if (!nr) return div();
  const kind = KINDS.find((k) => k.id === nr.kind);
  const set = (patch, cx) => { Object.assign(nr, patch, { error: null }); cx.notify(); };
  const repoRow = h_flex().id("nr-repo").items_center().gap(8).px(10).h(30).rounded(6).bg(t.raised).cursor_pointer()
    .on_click((_e, cx) => set({ picking: !nr.picking }, cx))
    .child(div().flex_1().min_w(0).text_size(13).text_color(nr.repo ? t.foreground : t.dim).child(nr.repo?.name ?? (nr.prefs ? "No repository open" : "…")))
    .child(div().text_size(11).text_color(t.dim).child(nr.picking ? "▴" : "▾"));
  const list = nr.picking && v_flex().gap(2).p(4).rounded(6).bg(t.raised)
    .children(nr.repos.map((r, i) => h_flex().id(`nr-r-${i}`).px(8).h(26).items_center().rounded(5).text_size(12.5)
      .text_color(r === nr.repo ? t.accent : t.muted).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { nr.repo = r; nr.drafts = draftsFor(nr.prefs, r.root); set({ picking: false }, cx); })
      .child(r.name)));
  const drafts = nr.kind === "review" && field(t, "Review comments",
    h_flex().gap(6).children(DRAFTS.map((d) => pill(t, `nr-d-${d.id}`, d.label, nr.drafts === d.id, (cx) => set({ drafts: d.id }, cx), d.tip))),
    nr.drafts === "direct" && div().text_size(11).text_color(t.dim).child("Posted in your name at once. Not remembered as this repository's default."));
  return v_flex().size_full().p(20).gap(16).bg(t.background)
    .child(div().text_size(15).font_semibold().text_color(t.foreground).child("New run"))
    .child(field(t, "Repository", repoRow, list || null))
    .child(field(t, "What", h_flex().gap(6).children(KINDS.map((k) => pill(t, `nr-k-${k.id}`, k.label, nr.kind === k.id,
      (cx) => { nr.kind = k.id; setProfile(nr); nr.drafts = draftsFor(nr.prefs, nr.repo?.root); set({}, cx); })))))
    .child(field(t, kind.hint, framed(t, nr.text), div().text_size(11).text_color(t.dim).child(kind.example)))
    .child(field(t, "Profile", framed(t, nr.profile)))
    .children([drafts].filter(Boolean))
    .child(div().flex_1())
    .children([nr.error && div().text_size(12).text_color(nr.done || nr.hint ? t.muted : t.blocked).child(nr.error)].filter(Boolean))
    .child(h_flex().gap(8).justify_end()
      .child(pill(t, "nr-cancel", nr.done ? "Close" : "Cancel", false, () => { try { closeOverlay(props().overlay); } catch { /* closed */ } }))
      .child(div().id("nr-start").px(14).h(28).rounded(6).flex().items_center().text_size(12.5).font_semibold()
        .bg(t.accent).text_color(t.background).when(nr.busy || nr.done || !nr.repo, (e) => e.opacity(0.45))
        .when(!nr.busy && !nr.done && nr.repo, (e) => e.cursor_pointer().on_click((_e, cx) => { start(view, cx); }))
        .child(nr.busy ? "Starting…" : "Start")));
}
