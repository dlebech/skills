# skills
Shareable agent skills

## Install

```sh
# Pick skills interactively
npx skills add dlebech/skills

# Or install everything globally, no prompts
npx skills add dlebech/skills --all -g
```

## Skills

| Skill | What it does |
| --- | --- |
| [`demo-video`](skills/demo-video/SKILL.md) | Records a short narrated demo video of a feature: browser actions with a visible cursor, local TTS voiceover (Kokoro, Supertonic, Piper, macOS `say` or espeak-ng) in any language, and subtitles. Can also cover several branches/worktrees in one video for a developer review. Invoke manually with `/demo-video [what, language, audience, detail]`. |
| [`herdr-app-captain`](skills/herdr-app-captain/SKILL.md) | Oversees several `herdr-app-orchestrator` runs, on this computer and every machine in `hc machine ls`, says which need you, watches them in the background, relays your instructions and answers (and, for runs at autonomy L1 or L2, answers their routine questions with the recommended option), keeps nothing in its head that the run files hold, so it can be cleared at any time, tells you which tab to answer a permission prompt in, keeps a list of the decisions it is waiting on you for, with their options and recommendation (Harbormaster shows them in its Needs-you queue, beside the runs' questions), and starts new runs in any repository. Tabs show `⚓` for the captain and `🐙` for orchestrators. Invoke manually with `/herdr-app-captain [question or instruction]`. |
| [`herdr-app-orchestrator`](skills/herdr-app-orchestrator/SKILL.md) | Orchestrates a larger implementation through the Herdr app and `hc`: role-specific agent kinds and models, independent review and fix cycles per task or of the whole branch, and a single integration branch that is the only PR branch. The work comes from the current session's discussion (default), a description, a plan file, or one or more GitHub issues and their chosen sub-issues. Agents are hidden `hc` terminals that show under the orchestrator in the Agents list. The integration worktree opens as a space under its repository, which shows its branch and changes. `claude`, `pi` and `opencode` all work. Reviewers use an installed code-review skill when there is one. `autonomy=L0|L1|L2` sets how much it decides itself (default `L0`); `budget=50M` sets a soft token budget; `grunt=<kind> grunt-model=<model>` runs agents that only watch tests, lint, builds and CI on a cheaper model; test output is recorded per commit and reused, task agents run only targeted tests, and T0 and small tasks skip the task review; what it decided for you is listed in Harbormaster. Examples: `/herdr-app-orchestrator 185 implementer=claude implementer-model=sonnet`; `/herdr-app-orchestrator agent=pi model=ollama/ornith-1.5:9b`. |
| [`pr-humanize`](skills/pr-humanize/SKILL.md) | Rewrites a PR description into a short "For humans" section and a detailed "For AI" section, keeping `## Evidence` and `## Merge danger` as they are. Works with GitHub (`gh`), GitLab (`glab`), or plain git (prints the text to paste). Invoke manually with `/pr-humanize [PR number]`. |
| [`pr-squash`](skills/pr-squash/SKILL.md) | Squash-merges a PR with a short commit message written for the main branch's log, instead of the concatenated branch commits or the PR description. Invoke manually with `/pr-squash [PR number]`. |
| [`proving`](skills/proving/SKILL.md) | Captures proof that a change works for a tier T0–T3 (test suite, test output, screenshots, demo video), writes `proof.md` and the PR's `## Evidence` section, and never commits the proof. Works inside an orchestrator run or on its own. Invoke manually with `/proving [tier] [what to prove]`. |

## Herdr app

The `herdr-app-*` skills also want Herdr's own `herdr-core` skill, which steers agents to `hc` rather than the older `herdr`:

```sh
npx skills add https://github.com/herdrdev/herdr-core --skill herdr-core
```

To see your runs at a glance in the Herdr app, install Harbormaster with `herdr-app/install.sh` (see [docs/herdr-app-harbormaster.md](docs/herdr-app-harbormaster.md)). It adds a Crew block that shows every orchestrator (and a small link to the captain), grouped into what needs you, what is working, what waits on a reviewer or someone you named and done (and can't tell when a run can't be read), with each run's next step (`approved — merge`, `review from anna`) or current step and that step's own age, one meaning per colour (red: act, amber: look soon, cyan: a reviewer, none: fine), a Needs-you box that says what to do (`Merge #42 · approved by anna 1h ago`, `CI failed on #42: lint`) with the buttons that do it, review comments counted on approved PRs (`approved · 3 comments`) with one click to have the orchestrator ask you about them or handle them, close every merged run at once and set each project's review flow (peer or self), a toast when a run starts needing you (off with one click), decisions counted as new since you last looked, and the agents outside any run, the Bridge, one view with or without a captain (open it from the sidebar's `⚓ Harbormaster` title): one queue of everything waiting on you with one-click answers (the captain's decisions too, from the sidebar as well), runs folded to a line that opens to a card with PRs, checks and the open question to read in full and answer, parked runs saying what their PRs wait on, this week's figures and the captain, each run's proof tier and evidence (with screenshot thumbnails that open in a viewer), how many tokens each run and its agents used against an optional soft budget (crossing it asks you to continue, compact or stop), a stats view of where the time, tokens, CPU and memory go per run, task and agent, across open and past runs, a run pane that starts with a path-to-merge strip (built, proven, AI review, human review, merge: which are done and which wait on you) and lets you ask a reviewer from inside Herdr (Harbor 3D, a 3D view of the runs in your browser, is separate and not installed: run it by hand from `herdr-app/harbor3d`), and two layouts: `harbormaster-main`, a calm sidebar (a header with **+ New run** and a quiet `captain ↗` link, the Needs-you box with one obvious button per item, **Next for you** with review requests and your own PRs that need something, the Crew, and Herdr's own Spaces list with a new space per machine; no Agents list) and `harbormaster-sea`, a calm strip of the harbor above your terminals. **+ New run** starts a run (issues, a PR review or a described task) in a folder you pick (an open space, a recent one, or a typed name) without the captain. Orchestrators also label their terminals with `run.dir`, `run.status`, `run.type`, `run.topic`, `progress` and `run.prs`, and keep a `status.json` in each run directory, so you can shape Harbormaster further by asking an agent in the app, for example:

> In the harbormaster mod's Crew block, put a ✓ before each orchestrator whose `run.status` label is `finished`.

## Tests

Run the `herdr-app` tests from an agent in a Herdr app tab, with the window open:

- `tests/herdr-app-orchestrator/agent-kinds-live.sh` starts a hidden agent of each kind, delivers a task, and receives its report, including Claude's trust prompt and default permission mode. It uses Haiku, and `ollama/ornith-1.5:9b` for `pi` and `opencode`.
- `tests/herdr-app-captain/runs-live.sh` checks run directories, tab names, parked and closed runs and their resume, the integration worktree's space, the watcher and its `hc events` wake-up, and `--no-parent`, with plain programs in a throwaway space. It costs no model turns.
- `tests/herdr-app-captain/runs-remote.sh` checks the captain's runs on another machine (`MACHINE`, default `local-ssh`): `runs.sh` listing them and saying when a machine cannot be read, `mark_run` and `post-message.sh` writing there, and the watcher, against a throwaway runs root on that machine. `--local` runs only the checks that need no other machine.

`tests/herdr-app-orchestrator/in-shell.sh` checks that `start-agent.sh` starts an agent through the user's interactive shell, which execs it: it sees a PATH folder only `~/.bashrc` adds, with a fake `hc`, a throwaway HOME and a stub agent. It needs no Herdr and costs no model turns.
