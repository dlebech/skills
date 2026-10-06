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
| [`demo-video`](skills/demo-video/SKILL.md) | Records a short narrated demo video of a feature: browser actions with a visible cursor, local TTS voiceover (Kokoro, Supertonic, Piper, macOS `say` or espeak-ng) in any language, and subtitles. Can also cover several branches/worktrees in one video for a developer review. Invoke manually with `/demo-video [what, language, audience]`. |
| [`pr-humanize`](skills/pr-humanize/SKILL.md) | Rewrites a PR description into a short "For humans" section and a detailed "For AI" section. Works with GitHub (`gh`), GitLab (`glab`), or plain git (prints the text to paste). Invoke manually with `/pr-humanize [PR number]`. |
| [`pr-squash`](skills/pr-squash/SKILL.md) | Squash-merges a PR with a short commit message written for the main branch's log, instead of the concatenated branch commits or the PR description. Invoke manually with `/pr-squash [PR number]`. |
