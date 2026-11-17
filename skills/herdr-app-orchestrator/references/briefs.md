# Briefs: what goes in shared/

Read this before you write the run's `common.md`, a task brief, or the review template (the skill's section 3). Keep briefs as files in `shared/`, and point prompts at them:

- `spec.md`: the overall goal. Every agent reads the copy in `shared/`.
- `common.md`: rules every agent follows: environment, the checks that define “done” and how to run them the way CI does, browser-check and end-to-end test guidance, and commit rules (commit only; agents push their branch only when `push-task-branches=yes`, never an integration branch). It also gives the reporting protocol, with your address (`$HC_TERMINAL_ID`; an agent cannot find it by itself) and the absolute path of `shared/`:
  - run dev servers, watchers, and slow builds or test suites with `hc run --bg --name <agent-name>-<what>`, never with shell `&`, `nohup`, `tmux`, or the harness's background shell, so they end with the agent and the orchestrator can see them;
  - when the assigned work is completely finished, including any background jobs it started, run `hc send <your-address> "done: <agent-name>: <one-line result>"`, then end the turn;
  - to ask you something, write the question with its context and options to `shared/<agent-name>-question.md`, run `hc send <your-address> "question: <agent-name>: <that path>"`, then end the turn and wait for the answer; never use an interactive question dialog, even when a skill would;
  - if the work cannot be completed, run `hc send <your-address> "failed: <agent-name>: <reason>"`;
  - never wait on a real clock longer than a few seconds (a 30-minute stall clock, say): fake or backdate the state instead;
  - long results go in a file in `shared/`, and the message gives its path. Do not start other agents.
- `--allow` rules: start agents with `start-agent.sh --allow '<rule>'` (claude kind, repeatable) for what `common.md`'s checks need, so they never stop at a prompt: the test command (`Bash(npm test:*)`), a check such as `Bash(herdr-app check:*)`, a sandbox script (`Bash(tests/x/sandbox.sh:*)`), and git on the agent's own branch (`Bash(git add:*)`, `Bash(git commit:*)`, `Bash(git push:*)` only with `push-task-branches=yes`). Derive them from those checks, not from a fixed list.
- one brief per task: scope, acceptance criteria, what other agents are doing in parallel and which files to avoid, decisions already made, and how to measure success. Where quality is measurable (evals, benchmarks), say how to measure before and after and what counts as not regressing.
- one review template.

When a lesson applies to everyone, amend `common.md` once and tell the running agents with `hc send`.
