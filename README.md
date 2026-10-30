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
| [`herdr-captain`](skills/herdr-captain/SKILL.md) | Oversees several running `herdr-orchestrator` runs across Herdr: says which need you, reports progress per run, watches them in the background and alerts you (with a Herdr notification) when one needs attention, relays your instructions and answers to the right orchestrator, including its open question and permission dialogs, and starts new `/herdr-orchestrator` runs in any repository. Finds runs through their run directories and `🐙` tabs. Tabs are marked for scanning Herdr's Agent panel: `⚓` captain, `🐙` orchestrator, `🦀` worker, `🔍` reviewer. Invoke manually with `/herdr-captain [question or instruction]`, e.g. `/herdr-captain how are we doing?` or `/herdr-captain start issue 185 in snevagten-api`. |
| [`herdr-orchestrator`](skills/herdr-orchestrator/SKILL.md) | Manually orchestrates a larger implementation through Herdr worktrees: role-specific agent kinds and models, one independent review and fix cycle per task, and a single integration branch that is the only PR branch. It asks you in plain text, so `herdr-captain` can carry the question; say “ask interactively” to get dialogs instead. The work comes from the current session's discussion (default), a description, a plan file, or one or more GitHub issues: it finds their open sub-issues, asks which to solve in this run, and links the issues from the final PR. Requires the `herdr` skill. Examples: after discussing a feature, `/herdr-orchestrator implementer=claude implementer-model=sonnet reviewer=claude reviewer-model=haiku`; for issues, `/herdr-orchestrator 185 start with #175 specialist=claude specialist-model=opus`. |
| [`pr-humanize`](skills/pr-humanize/SKILL.md) | Rewrites a PR description into a short "For humans" section and a detailed "For AI" section. Works with GitHub (`gh`), GitLab (`glab`), or plain git (prints the text to paste). Invoke manually with `/pr-humanize [PR number]`. |
| [`pr-squash`](skills/pr-squash/SKILL.md) | Squash-merges a PR with a short commit message written for the main branch's log, instead of the concatenated branch commits or the PR description. Invoke manually with `/pr-squash [PR number]`. |

## Tests

`tests/herdr-orchestrator/wait-agents-live.sh` checks `herdr-orchestrator`'s waiting against a real Claude Code sub-agent (Haiku) in a new Herdr pane. Run it from inside Herdr; it takes about a minute and closes its pane afterwards.

`tests/herdr-captain/answer-dialog-live.sh` checks `herdr-captain`'s answering of open dialogs against two Claude Code agents (Haiku) in new Herdr panes, the same way.
