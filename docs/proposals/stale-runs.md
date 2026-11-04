# Proposal: parking, resuming and closing runs; adrift names; worktree spaces

Status: implemented (revision 5). Section 4 records how the worktree problem was found; the code is the reference.

Feedback so far, from David (relayed by the captain, and then directly):

- An unfinished run that stays listed is fine. What is missing is an easy way to
  **resume** one, and a way to **set one aside for now** and come back to it later,
  distinct from closing it for good. A close button on the captain's pane is good.
  As few new scripts as possible.
- Parked runs **stay in the sea view**. The captain asks about gone runs **one run
  per question**. `set-status.sh`'s `question.md` check is my call (decided in 2e).
- Adrift agents should not show as "1".
- The integration worktree's space should be a proper worktree space, nested under
  its repository in the sidebar like the ones the worktree mod opens. Today it is
  flaky. Only the integration branch needs a space; task worktrees stay hidden. A
  brief view flicker is fine if `space.new` is what it takes.
- 1234-feature-b's empty `tab_id` was put down to an older skill version. It turns
  out to have the same cause as the worktree-space problem (section 4).

## 1. The problem with unfinished runs

A run counts as closed in exactly one case: `plan.md` says `finished` **and** the
orchestrator's terminal is gone. `runs.sh`, `watch-runs.sh` and Harbormaster's
`isClosed()` each apply that rule. Only the orchestrator writes `finished`. If its
terminal ends first (its tab is closed, or it crashes), the run stays open with
nobody driving it. There is no way to set a run aside on purpose, and resuming one
means typing `/herdr-app-orchestrator <run-directory>/spec.md` into a new tab by
hand.

`my-site/feature-a` shows both problems:

- its plan is `waiting for user: next instructions`, with no `question.md` (the
  skill requires one, but `set-status.sh` only warns);
- all 5 tasks are merged, PR #7 is an open draft, and the final review is deferred;
- David closed its tab, meaning "later". The run has been reported as stalled ever
  since.

Closing a terminal gives the orchestrator no chance to say anything. So the user's
intent has to be recorded when they put a run away, not guessed afterwards.

## 2. Park, resume, close

| | how | sea view and overview | the captain |
|---|---|---|---|
| **Parked** (temporary) | Park button, or ask the captain | a dimmed reef marked "parked"; a "Parked" group in the overview; **Resume** | no alerts; one line in reports |
| **Gone** (not parked) | tab closed any other way, or a crash | as now, flagged; **Resume** | asks whether to resume it, one question per run |
| **Closed** (for good) | `finished` + gone (as today), or the Close button / captain on an unfinished run | hidden ("closed" group, `--all`); **Resume** there | nothing |

### a. Park

Parking writes a `parked` file to the run directory, one line with the time and the
plan's status, and then closes the orchestrator's tab.

- The run stays listed. `runs.sh` shows `parked <time> (was: <status>)`, the
  watcher raises nothing for it, and the captain's report gives it one line under
  "Parked".
- In the sea view, it keeps its reef, dimmed, with a "parked" sign and no octopus
  or crabs. Clicking the reef resumes it, after a confirm on the reef.
- Its agents end with the orchestrator. Worktrees, branches, spaces and PRs stay.
  On resume, unfinished tasks restart from their worktrees (orchestrator §7), so
  only uncommitted work in a running task is lost.
- Keeping an orchestrator alive but hidden is not an option: Herdr has no hidden
  tabs, and an idle orchestrator keeps its agents in memory. A new orchestrator can
  rebuild the run from its directory, so real parking is simpler.

### b. Resume

Resuming starts a new orchestrator with the resume prompt
`/herdr-app-orchestrator <run-dir>/spec.md`, which §1 step 3 already treats as a
resumed run. `init-run.sh` deletes `parked` and `closed`, so the run is active
again. It starts **in the repository's own checkout, never in the integration
worktree's space** (section 4 shows why that matters).

- **Harbormaster's Resume button**: `run("tab.new", { space, folder, argv: [<kind>], task: <prompt> })`.
  - `tab.new` takes an agent and its first message, so no captain or script is
    involved.
  - `space` is the open space whose first pane's live folder *is* the run's
    `folder`, the repository's own checkout (`my-app` on `main`).
  - If that space is not open, it uses `run("space.new", { folder, argv, task })`
    instead. That one call opens the repository's space with the orchestrator as
    its first tab; the view switches to it, which is fine for a click.
  - The resumed orchestrator then runs `integration-worktree.sh` (§7), which opens,
    or finds, the integration worktree's space.
  - `kind` comes from `orchestrator.json` (recorded from now on), and otherwise
    defaults to `claude`. The prompt uses that kind's command form:
    `/herdr-app-orchestrator …` for `claude`, `/skill:herdr-app-orchestrator …`
    for `pi`.
- **The captain**, on the user's word: Start a run steps 3, 5 and 6 with the
  resume prompt. That is `start-agent.sh --no-parent` in the `primary` space, with
  a `herdr.tab` label and its existing handling of the trust prompt. When no
  `primary` space is open, step 3's `sp-<name>` id already makes Herdr create the
  repository's space with the orchestrator as its first tab.

**Who triggers it: the captain asks, the user decides.** When the captain starts,
and when the watcher reports `orchestrator gone`, it asks once per gone, unparked,
unfinished run, each as its own question: "feature-a: waiting for you, PR #7
draft, final review deferred. Resume it, park it, or close it?". It never resumes a
run by itself, so its rule against starting agents unasked stays intact. A gone
run may have been closed with the tab's own ✕ instead of Park, and each resume is
a new session that restarts unfinished tasks. The watcher's `.captain-seen` file
already makes each event fire only once.

### c. Close for good

An unfinished run can also be closed for good: abandoned, or with its PR handed
over to the user. Closing writes `closed` (time and status) and closes the tab if
one is open. The run then drops out of the views the way a finished run does, but
it can still be resumed from the closed group or through the captain. A finished
run still closes as it does today, by closing its tab.

### d. Buttons

These go on Harbormaster's run cards in the overview pane next to the captain
(`overview.js`):

- **live orchestrator:** Park and Close;
- **gone or parked run:** Resume and Close;
- **closed run:** Resume.

A finished run whose orchestrator is still there gets Close only: there is nothing
left to park. Park, Close on an unfinished run, and Resume first ask on the card
itself, naming what is left. (The app's `confirm` dialog can only run a Herdr
command, not the mod's marker write, so the card asks inline.) The mod writes markers with `exec` on the run's machine, as
`data.js` already reads run directories. It closes the tab with
`run("tab.close", { id, confirmed: true })`, using the `tab_id` from
`orchestrator.json`, or otherwise the tab of the orchestrator's pane in `panes()`.

In the captain, **Close a run** becomes **Park, resume, or close a run**. Park and
Close write the marker (with a file-writing tool, then `mv`) and close the tab.

### e. Orchestrator side: no "waiting" without a question

- §7: on resume, a `waiting for user` or `blocked` plan without `question.md` gets a
  real question (for feature-a: "Anything more for this round, or shall I run
  the deferred final review?"). If there is nothing to ask, the run finishes. So a
  resumed run comes back visibly asking something.
- §2 / §6: being idle between rounds means writing a real question, or finishing.
- **`set-status.sh` refuses** `waiting for user` without `question.md` (exit 2,
  nothing changed), instead of warning. My reasoning:
  - the warning has already been ignored once, and that ignored warning is how
    feature-a got stuck;
  - complying is cheap: write `question.md` first, which §6 already orders;
  - a refused call fails visibly in the orchestrator's own output, where it gets
    fixed.

  The live test's warning check becomes a refusal check.

### Without new scripts?

**Yes.** Resume reuses `start-agent.sh` from the captain and `tab.new` from
Harbormaster. Park and Close are a one-line file plus `tab.close`. What needs code
is the markers' readers, a few lines each in existing files:

- `lib.sh`, with one helper for `runs.sh` and `watch-runs.sh`;
- Harbormaster's `data.js`;
- `init-run.sh`, which deletes the markers on resume and records `kind`.

## 3. Naming adrift agents

Harbormaster labels adrift agents by their tab:

- the crabs in `harbor.js` use `a.tab_name || a.program?.name`;
- the Adrift rows in `overview.js` use `` `${space_name} · ${tab_name}` ``.

An unnamed tab is called by its number, hence "1".

Herdr's own Agents list (`~/.config/herdr-app/mods/agents/main.js`, `title()` and
`label()`) uses the tab's name only when someone named it. For an unnamed tab, or
one named after the program, it uses the **terminal's title**, which the program
sets. Claude Code sets it to a summary of its session. The list strips leading
symbols and skips titles that are the program's name, a path, or `user@host`. It
never shows a bare tab number unless two rows would otherwise read the same.

Harbormaster has the same data: `agents()` gives `title` and `tab`, `spaces()` gives
each tab's `named`, and `panes()` gives the lead pane. So it can copy the rule:

- **Change:** add `agentName(a)` to `live.js`, a copy of that rule, and use it for
  the crabs and the Adrift rows. Long titles truncate as they do now, with the full
  title in the tooltip.
- **Not the captain:** adrift agents are the user's own sessions, and renaming their
  tabs would change the user's window. The name would also stop following the work.
  The agents the captain starts are orchestrators, which name their own tabs and are
  never adrift.

## 4. Worktree spaces

In the sidebar's terms, a run should look like this:

- a **repository space** on the main checkout (`my-app` on `main`), where the
  orchestrator runs;
- the run's integration branch as a **worktree under it** (`└─ 1234-feature-b`),
  the same entry "Open worktree" makes.

Herdr stores that worktree entry as a space of its own, which the sidebar nests
under the repository's. That is why the text below speaks of the worktree's
"space". If the repository space is not open, it is opened first, with the
orchestrator in it; the orchestrator then opens the worktree under it.

### What happened with 1234-feature-b (verified)

`herdr-app ls` shows two spaces on `~/.herdr/worktrees/my-app/1234-feature-b`:

| space | shown as | its terminal |
|---|---|---|
| `sp-wt-my-app-1234-feature-b` | "my-app", not nested | `t7s`: argv `/bin/bash`, labels `herdr.space` only, **no `herdr.tab`**; started in the worktree, foreground now in `~/projects/my-app` |
| `spcafcf…` | "1234-feature-b", nested | `t10d`: made by the worktree mod's Open worktree, with both labels |

`t7s` is the 1234 orchestrator. In other words:

1. `integration-worktree.sh` made the space by starting a plain shell with
   `hc run --label herdr.space=sp-wt-…`, with no `herdr.tab` label, so Herdr made
   up the tab.
2. Later, an orchestrator session was started **inside that shell**, which is how
   a resumed session landed there. It moved its foreground folder to the main
   checkout.
3. The spaces mod names and nests an unnamed space by `place()`: **its first pane's
   live folder**. That folder is now the main checkout, which is not a linked
   worktree. So the space shows as "my-app", not nested, as if it were a second
   main checkout. With the main `my-app` space open, it would still sit beside
   that space, not under it.
4. The worktree mod's Open worktree also looks spaces up by live folder (`spaceOf`).
   It did not find one in the worktree, so it made a second, proper space, which is
   the duplicate.
5. `init-run.sh` reads the tab from `herdr.tab`. That shell had none, so
   `orchestrator.json` got `"tab_id": ""`. That is the defect from revision 1; the
   older skill version was not the whole story.

The diagnosis in the note you pasted is partly right. The label-made space is not
different in kind: an unknown `herdr.space` id becomes an unnamed space, like
`space.new` makes. It went wrong because its only terminal was a shell that a
session took over and moved, and because it had no `herdr.tab`. Its reuse check also
differs from the mod's: the script compares the space's creation folder
(`.spaces[].folder`), while the mod compares live folders.

### Options

**A. `space.new`, like the worktree mod, then switch back.** The script runs
`herdr-app do space.new --folder <path>` with no name, which is the worktree mod's
own call. That gives an unnamed space with both labels and the mod's grouping, so
it nests and Open worktree finds it. `space.new` always shows the new space, so the
script first records the focused space (`herdr-app status`) and then switches back
with `space.select`. That causes a brief flicker, which David has said is fine.

**B. Keep the label approach, and fix what broke**: add `herdr.tab` and
`--keep`, and use a placeholder instead of a shell that sessions take over. It
avoids the flicker, but it is not the mod's call, so whether the space is
equivalent rests on the label-adoption rule.

**C. Spaces for task worktrees too.** Dropped. David only needs to see the
integration branch. Task worktrees branch off it and stay hidden, as the skill
already says.

### Recommendation: A, for the integration worktree only

1. `integration-worktree.sh` opens the space with `space.new --folder <path>` and
   switches back to the space that was focused. Without a reachable window, it only
   prints a warning, as now.
2. Reuse:
   - if a space's first pane's **live** folder is the worktree (the mod's
     `spaceOf` rule), the script leaves it alone and opens nothing;
   - if a space was only made there (`.folder`) but has drifted elsewhere, as in
     1234, the script opens a proper space and warns about the stale one, but
     does not close it.
3. Orchestrators never run in a worktree space. They start, and resume, in the
   repository's own checkout and its space (2b). `init-run.sh` warns when its
   terminal sits in a linked worktree or has no `herdr.tab` label. §7 says to
   resume from the repository's own space.
4. The order of events when nothing is open yet, for a fresh start or a resume:
   - the captain (`sp-<name>`) or Harbormaster (`space.new`) opens the
     repository's own space, with the orchestrator as its first tab;
   - the orchestrator runs `init-run.sh`;
   - it runs `integration-worktree.sh`, which opens the integration space,
     nested under the repository's;
   - it switches the view back.
5. Test with a throwaway repo, without touching your spaces:
   - the new space nests and shows its branch;
   - the focused space is unchanged afterwards;
   - a second run of the script makes no second space;
   - Open worktree goes to the existing space.

Existing duplicate spaces are not migrated. Once 1234 is parked or closed, close its
label-made "my-app" space by hand.

## 5. What changes, by file

**`skills/herdr-app-captain/SKILL.md`**
- Find the runs: the `parked` and `closed` markers.
- Report: a "Parked" line per parked run. A gone, unparked, unfinished run comes
  under Needs you, with one question per run: resume, park, or close.
- **Park, resume, or close a run** replaces Close a run.
- Resume starts in the `primary` space (or creates it with `sp-<name>`), never in
  a worktree space.

**`skills/herdr-app-captain/scripts/lib.sh`**: document both markers. Add
`run_marker <run-dir>` (`parked`, `closed`, or nothing), `away_state <run-dir>
<plan-status> <terminal-state>`, which also counts a finished run with its terminal
gone as `closed`, and `mark_run <run-dir> parked|closed`, the marker writer the
captain and the live test use.

**`skills/herdr-app-captain/scripts/runs.sh`**: closed runs are hidden unless
`--all` is given, and parked runs are shown as parked.

**`skills/herdr-app-captain/scripts/watch-runs.sh`**: no events for parked or
closed runs.

**`skills/herdr-app-orchestrator/scripts/init-run.sh`**: on `existing`, delete
`parked` and `closed`. Record `kind`. Warn when the terminal has no `herdr.tab` or
sits in a linked worktree.

**`skills/herdr-app-orchestrator/scripts/set-status.sh`**: refuse
`waiting for user` without `question.md`.

**`skills/herdr-app-orchestrator/scripts/integration-worktree.sh`**:
- `space.new --folder`, with the focus restored;
- reuse by live folder, with a warning about a drifted space;
- an updated header comment.

**`skills/herdr-app-orchestrator/SKILL.md`**
- The Invariants line about `integration-worktree.sh`, and §1 step 6: how the space
  is made, that only the integration worktree gets one, and that the view switches
  back after a short flicker.
- §2 and §6: a real question, or finish.
- §7: resume from the repository's own space, and give a waiting plan without
  `question.md` a question.
- §8 step 4: park, close, resume.

**`herdr-app/mods/harbormaster/data.js`**:
- read the markers;
- make `isClosed()` read the markers;
- add `parked` to `stats()`;
- add `putAway(run, how, orch)`, which refuses when the orchestrator is there but
  its tab cannot be found, and `resumeRun` (`tab.new` in the repository's space,
  or `space.new` when it is not open).

**`herdr-app/mods/harbormaster/overview.js`**: the buttons and a "Parked" group.
The gone message becomes "resume or close", the gone card's buttons. Adrift rows
use `agentNames()`, which adds the tab's name where two rows read the same.

**`herdr-app/mods/harbormaster/harbor.js`**: parked runs as dimmed reefs, with a
reef that resumes them. Crab labels use `agentNames()`.

**`herdr-app/mods/harbormaster/live.js`**: `agentName(a)` and `agentNames(list)`;
`tabOf` and `homeSpace`, which read the live layout.

**`docs/herdr-app-harbormaster.md`**: the buttons, parked reefs, and adrift names.

**`tests/herdr-app-captain/runs-live.sh`**
- markers: a parked run is listed and raises no events, a closed run is hidden
  except with `--all`, and `init-run.sh` deletes the markers and records `kind`;
- the `set-status.sh` refusal;
- `integration-worktree.sh`: one space with both labels, the focused space
  unchanged, no second space on a second run, and reuse by live folder.

These checks are done by hand: the sidebar nesting, Open worktree finding the
space, and Resume, both with the repository's space open and with it closed.

## 6. Existing runs

- **feature-a:** the next captain start asks about it. Resume brings it back
  asking whether there is more for this round or whether to run the final review.
  Park keeps it for later, and Close drops it.
- **1234-feature-b:** its orchestrator runs in the label-made shell and has no
  `tab_id`. Once it is parked or closed, close the duplicate "my-app" space. A
  resume then starts it properly in the `my-app` space, and the nested
  `1234-feature-b` space it already has is reused.

## Open questions

None left from my side. Ready to implement on your go-ahead.
