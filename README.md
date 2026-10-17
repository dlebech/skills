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
| [`herdr-issue-orchestrator`](skills/herdr-issue-orchestrator/SKILL.md) | Manually orchestrates a larger GitHub issue through Herdr worktrees: role-specific agent kinds and models, one independent review and fix cycle per task, and a single integration branch that is the only PR branch. Requires the `herdr` skill. Example: `/herdr-issue-orchestrator 185 start with #175 implementer=claude implementer-model=sonnet reviewer=claude reviewer-model=haiku specialist=claude specialist-model=opus`. |
| [`pr-humanize`](skills/pr-humanize/SKILL.md) | Rewrites a PR description into a short "For humans" section and a detailed "For AI" section. Works with GitHub (`gh`), GitLab (`glab`), or plain git (prints the text to paste). Invoke manually with `/pr-humanize [PR number]`. |
| [`pr-squash`](skills/pr-squash/SKILL.md) | Squash-merges a PR with a short commit message written for the main branch's log, instead of the concatenated branch commits or the PR description. Invoke manually with `/pr-squash [PR number]`. |
