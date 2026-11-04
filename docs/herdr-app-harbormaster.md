# Harbormaster: see your runs in the Herdr app

Harbormaster is a Herdr app mod with two layouts. It shows what `herdr-app-captain` and its `herdr-app-orchestrator` runs are doing, so you don't have to read the Agents list row by row. Everything in it is written from scratch: it uses Herdr's mod API and leaves Herdr's own mods and layouts unchanged.

- **Crew block.** The 🧑‍✈️ captain and every 🐙 orchestrator, as cards with a colored edge, then **Adrift**: every other agent, on any machine, that isn't one of their workers. It sits above Herdr's own Agents list.
  - The captain's card says whether its watcher is running and how many runs it watches, running and finished. Its pane button pins the runs overview beside the captain, or unpins it.
  - Each orchestrator's card shows its progress, its status when it isn't running, its number of 🦀 workers and its PRs. A run that needs you turns red and says what for. Finished ones come last, with a green edge and their PR numbers.
  - Each Adrift line shows the agent's space and its name as Herdr's own Agents list gives it: the tab's name when someone named it, otherwise the agent's own title (Claude Code sets one from its session), never a bare tab number like "1". Clicking it focuses the agent.
- **Runs overview.** The totals across runs on top (running, need you, finished, agents, tasks merged, open PRs and failing checks; clicking "need you" focuses the first run that needs you), then the captain, then one card per run:
  - its branch and repository, a status pill, the progress line, and a task bar from `plan.md` (merged, in progress, blocked);
  - its issues, and every PR with its state, checks and review decision;
  - what the run needs you for, shown first: its open question, the dialog it is blocked on, or the reason in its status;
  - and, when they apply: relayed messages the orchestrator hasn't read, agents waiting on an answer, "No pull request yet", and a note when the run's orchestrator is gone;
  - buttons to **Park**, **Resume**, or **Close** the run (see Parked, resumed, and closed runs). Each asks on the card first, naming what is left.

  Clicking a card focuses the orchestrator. Clicking a PR or issue opens it in the browser. Finished runs stay, after the running ones, until you close their orchestrator's tab. Parked runs come next, under **Parked**. Closed runs fold away at the bottom.
- **`harbormaster-main` layout.** Herdr's main layout with the Crew block added.
- **`harbormaster-sea` layout** (fun):
  - The captain rides a boat on the surface and drops anchor while watching. The captain calls "Ahoy!" when a run needs you, and raises the anchor and naps when nothing is being watched.
  - Each run is a reef with its branch on a sign. A finished run's reef goes quiet, its octopus asleep and its PR flags up, until you close the orchestrator's tab; then it leaves the harbor. A parked run keeps its reef, dimmed and without its octopus. Clicking a parked reef, or one whose orchestrator is gone, offers to resume it. A run that needs you says what for in a bubble. The orchestrator is an octopus and its workers are crabs. Working crabs scuttle, blocked ones jump, and crabs whose turn is done sleep.
  - Buoys along the bottom are the run's tasks and turn green as they merge.
  - Signal flags on the mast are its PRs. Clicking one opens it.
  - Agents outside any run drift on the right, named as in the Crew block. The active tab's terminals sit below deck.
  - While it shows, `alt-up` / `alt-down` step through agents in the harbor's order (captain, each run's octopus and crabs, then drifters), through Herdr's `setAgentOrder`. Other layouts set their own order again.

The skills work the same with or without any of this. Tested with Herdr 0.1.12.

![harbormaster-sea](../herdr-app/layouts/harbormaster-sea.svg)

## Install

Needs `jq`. Run this from any terminal while the Herdr app is open, in a checkout of this repository:

```sh
herdr-app/install.sh
```

It does four things:
- copies `herdr-app/mods/harbormaster` and the sea layout into the app's home (`~/.config/herdr-app`, or `$HERDR_APP_HOME`). It refuses to replace a mod or layout of the same name that isn't Harbormaster's, as Herdr asks. It removes the `harbormaster-board` layout earlier versions installed, if it is Harbormaster's;
- clones your Herdr's `main` layout as `harbormaster-main`, and inserts the Crew block above its Agents block with `jq`;
- binds `ctrl-shift-h` to `mod.open:harbormaster` under `global` in `keys.json`. It skips this and tells you how to add a key yourself if `ctrl-shift-h` is already bound in any section, or if there is no `keys.json` yet;
- runs `herdr-app check` on the mod.

To update, pull and run it again. It overwrites the mod and the sea layout. It leaves `harbormaster-main` alone once it has the Crew block, and the key binding alone once it exists.

Note: install copies files and deletes only what earlier versions of Harbormaster installed and it knows about (`board.js` and the `harbormaster-board` layout). Any other file removed from the mod in a later version stays in `mods/harbormaster` until you delete it.

To switch layouts, press `ctrl-shift-l`. You can also run `herdr-app do layout.switch '{"name":"harbormaster-sea"}'`, with any of `harbormaster-main`, `harbormaster-sea`, or Herdr's own `main`. The sea has a "Back to main" button.

To glance at the runs from anywhere, press `ctrl-shift-h`. It opens the overview as a popup over the window, and pressing it again, or Esc, closes it.

To keep the overview open beside the captain, click **Pin beside captain** on the captain's card in the overview (or the pane icon on the captain's Crew card). It opens a `harbormaster` pane to the right of the captain's terminal, in the captain's tab, and is saved with that tab. The same button then says **Unpin** and closes it. While the captain's terminal isn't on screen (for example, parked), the button is greyed out and its tooltip says why. You can also close the pane like any pane: its header, or `ctrl-shift-x` while it has focus.

To use the Crew block in a layout of your own, add a block with `{ "mod": "harbormaster", "props": { "role": "crew" } }`.

## Another computer, connected over ssh

Layouts and mods belong to the window, not to the machine the agents run on. Say a laptop adds this machine with Add machine (`hc machine add`). It sees this machine's spaces and terminals, but draws them with the laptop's own `~/.config/herdr-app`. So **install on every computer whose window you use**: clone this repository there and run `herdr-app/install.sh`.

Harbormaster is built for that:
- It reads run directories and asks `gh` on every connected machine (`exec(..., {on: machine})`). So the laptop shows the desktop's runs, with a machine tag on each card.
- It opens links on the computer you are looking at (`open` on macOS, `xdg-open` on Linux).
- `gh` must be logged in on the machine where the runs live, not where the window is.

## What it reads

The mod runs programs and reads files outside its folder. Herdr's AGENTS.md asks mods to list those, so here they are:

- **Every 5 seconds, per machine:** one `sh -c` script. For each run under `~/.herdr/hc-orchestration/*/*/` (or `$HERDR_ORCHESTRATION_ROOT`), it prints `orchestrator.json`, `status.json`, `plan.md`, `question.md`, and the `parked` and `closed` markers, and counts the unhandled `inbox/*.message` files.
- **Every minute per open run (running or finished), every 15 minutes per closed one:**
  - `gh pr view <url>` for each PR in `status.json`;
  - `gh pr list --head <branch>` in the run's folder, so a PR shows up before the orchestrator records it.

  The results are kept in Herdr's shared state (`harbormaster.prs`), so every copy of the mod and every layout uses the same ones.
- **Live from herdr-core:** the terminal labels `role`, `run.status`, `progress` and `run.prs`, and the `captain-watch` terminal.

It writes to a run directory only when you press Park or Close: one `parked` or `closed` file, with the time and the plan's status then, the same marker the captain writes.

## Parked, resumed, and closed runs

An orchestrator sets `finished` once its work is done, its PRs are up and their CI is green. The run stays open: in every view, in the captain's `runs.sh`, and on the captain's watch. It is **closed** once its orchestrator's terminal is gone, which is when you close its tab.

Before that, you can put a run away yourself, with the card's buttons or by asking the captain:

- **Park** sets an unfinished run aside for later. It writes `parked` and closes the orchestrator's tab, which ends it and its agents. The run stays in the overview under **Parked** and as a dimmed reef in the sea, but needs nothing: the captain's watcher stays quiet about it.
- **Close** ends a run for good, finished or not. It writes `closed` (unless the run is finished) and closes the tab. The run folds away with the other closed runs.
- **Resume** brings back a parked, closed, or gone run. It starts a new orchestrator of the run's kind with the resume command, in a new tab in the repository's own space, the space on its main checkout, never the integration worktree's. If that space is not open, it opens one for the repository with the orchestrator as its first tab. The orchestrator deletes the marker, restarts unfinished tasks from their worktrees, and opens the integration worktree under the repository's space again.

Parking and closing leave the run directory, worktrees, branches, spaces and PRs in place. An unfinished run whose orchestrator is gone without a marker, because its tab was closed some other way or it crashed, shows as gone. The captain asks you about it, one run at a time: resume it, park it, or close it.

"Needs you" means an open question, a blocker, or a dialog, never a finished run, and the views show which.

## Files

| Path | What |
| --- | --- |
| `herdr-app/mods/harbormaster/main.js` | Picks the view by `props().role`: none (the runs overview), `crew`, `harbor`, `harbor-rail`, `harbor-pane` |
| `herdr-app/mods/harbormaster/data.js` | Run directories, tasks, PRs from `gh`, and the totals the views share |
| `herdr-app/mods/harbormaster/live.js` | Live facts from herdr-core (status, workers, captain, panes) and the focus, pin and open-link actions |
| `herdr-app/mods/harbormaster/ui.js` | Emoji, program icons, zoom, and text formatting |
| `herdr-app/mods/harbormaster/overview.js` | The runs overview (totals, captain, run cards) and the Crew block |
| `herdr-app/mods/harbormaster/harbor.js` | The sea, the reefs, the captain's boat, the rail and the pane headers |
| `herdr-app/mods/harbormaster/*.svg` | Art and icons: captain, octopus, crab, sleeping crab, anchor, seabed, waves, PR, pin, spinner, chevrons. All original, CC0 like the rest of this repository |
| `herdr-app/layouts/harbormaster-sea.json` (+ `.svg` preview) | The sea layout. `harbormaster-main` is made by `install.sh` |
| `herdr-app/install.sh` | Install or update |

## Remove

1. Switch to `main`.
2. Delete these from the app's home: `mods/harbormaster`, and `layouts/harbormaster-*`.
3. In `keys.json`, delete the `"ctrl-shift-h": "mod.open:harbormaster"` line (or whichever key you bound to it).
4. Close any `harbormaster` pane still beside the captain.
