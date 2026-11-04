# skills
Shareable agent skills

## Install

```sh
# Pick skills interactively
npx skills add dlebech/skills

# Or install everything globally, no prompts
npx skills add dlebech/skills --all -g
```

The `herdr-app-*` skills also want Herdr's own `herdr-core` skill, which steers agents to `hc` rather than the older `herdr`:

```sh
npx skills add https://github.com/herdrdev/herdr-core --skill herdr-core
```

To see your runs at a glance in the Herdr app, install Harbormaster with `herdr-app/install.sh` (see [docs/herdr-app-harbormaster.md](docs/herdr-app-harbormaster.md)). It adds a Crew block that shows the captain and every orchestrator with their progress, and the agents outside any run, a runs overview with PRs, checks and open questions, and two layouts: `harbormaster-main` and the nautical `harbormaster-sea`. Orchestrators also label their terminals with `run.status`, `progress` and `run.prs`, and keep a `status.json` in each run directory, so you can shape Harbormaster further by asking an agent in the app, for example:

> In the harbormaster mod's Crew block, put a ✓ before each orchestrator whose `run.status` label is `finished`.

## Skills

| Skill | What it does |
| --- | --- |
| [`demo-video`](skills/demo-video/SKILL.md) | Records a short narrated demo video of a feature: browser actions with a visible cursor, local TTS voiceover (Kokoro, Supertonic, Piper, macOS `say` or espeak-ng) in any language, and subtitles. Can also cover several branches/worktrees in one video for a developer review. Invoke manually with `/demo-video [what, language, audience, detail]`. |
| [`herdr-app-captain`](skills/herdr-app-captain/SKILL.md) | `herdr-captain` for the Herdr app and `hc`: oversees several `herdr-app-orchestrator` runs, says which need you, watches them in the background, relays your instructions and answers, tells you which tab to answer a permission prompt in, and starts new runs in any repository. Tabs show `⚓` for the captain and `🐙` for orchestrators. Runs of the two captains do not see each other. Invoke manually with `/herdr-app-captain [question or instruction]`. |
| [`herdr-app-orchestrator`](skills/herdr-app-orchestrator/SKILL.md) | `herdr-orchestrator` for the Herdr app and `hc`: the same process, with agents as hidden `hc` terminals that show under the orchestrator in the Agents list instead of as tabs. The integration worktree opens as a space under its repository, which shows its branch and changes. `claude`, `pi` and `opencode` all work. Examples: `/herdr-app-orchestrator 185 implementer=claude implementer-model=sonnet`; `/herdr-app-orchestrator agent=pi model=ollama/ornith-1.5:9b`. |
| [`herdr-captain`](skills/herdr-captain/SKILL.md) | Oversees several running `herdr-orchestrator` runs across Herdr: says which need you, reports progress per run, watches them in the background and alerts you (with a Herdr notification) when one needs attention, relays your instructions and answers to the right orchestrator, including its open question and permission dialogs, and starts new `/herdr-orchestrator` runs in any repository. Finds runs through their run directories and `🐙` tabs. Tabs are marked for scanning Herdr's Agent panel: `⚓` captain, `🐙` orchestrator, `🦀` worker, `🔍` reviewer. Invoke manually with `/herdr-captain [question or instruction]`, e.g. `/herdr-captain how are we doing?` or `/herdr-captain start issue 185 in my-api`. |
| [`herdr-orchestrator`](skills/herdr-orchestrator/SKILL.md) | Manually orchestrates a larger implementation through Herdr worktrees: role-specific agent kinds and models, independent review and fix cycles per task or of the whole branch, and a single integration branch that is the only PR branch. It asks you in plain text, so `herdr-captain` can carry the question; say “ask interactively” to get dialogs instead. The work comes from the current session's discussion (default), a description, a plan file, or one or more GitHub issues: it finds their open sub-issues, asks which to solve in this run, and links the issues from the final PR. Requires the `herdr` skill. Examples: after discussing a feature, `/herdr-orchestrator implementer=claude implementer-model=sonnet reviewer=claude reviewer-model=haiku`; for issues, `/herdr-orchestrator 185 start with #175 specialist=claude specialist-model=opus`. |
| [`pr-humanize`](skills/pr-humanize/SKILL.md) | Rewrites a PR description into a short "For humans" section and a detailed "For AI" section. Works with GitHub (`gh`), GitLab (`glab`), or plain git (prints the text to paste). Invoke manually with `/pr-humanize [PR number]`. |
| [`pr-squash`](skills/pr-squash/SKILL.md) | Squash-merges a PR with a short commit message written for the main branch's log, instead of the concatenated branch commits or the PR description. Invoke manually with `/pr-squash [PR number]`. |

## Tests

Run the `herdr-app` tests from an agent in a Herdr app tab, with the window open:

- `tests/herdr-app-orchestrator/agent-kinds-live.sh` starts a hidden agent of each kind, delivers a task, and receives its report, including Claude's trust prompt and default permission mode. It uses Haiku, and `ollama/ornith-1.5:9b` for `pi` and `opencode`.
- `tests/herdr-app-captain/runs-live.sh` checks run directories, tab names, parked and closed runs and their resume, the integration worktree's space, the watcher and its `hc events` wake-up, and `--no-parent`, with plain programs in a throwaway space. It costs no model turns.

`tests/herdr-orchestrator/wait-agents-live.sh` checks `herdr-orchestrator`'s waiting against a real Claude Code sub-agent (Haiku) in a new Herdr pane. Run it from inside Herdr; it takes about a minute and closes its pane afterwards.

`tests/herdr-captain/answer-dialog-live.sh` checks `herdr-captain`'s answering of open dialogs against two Claude Code agents (Haiku) in new Herdr panes, the same way.
