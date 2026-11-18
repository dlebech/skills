// What a task's state words say and how many tasks a run has done and planned. No herdr
// imports: data.js (the task strip, the cards' counts) and attention.js (whether the run's plan is
// open) both read tasks through here, so they cannot disagree.

// A task's state word(s) → "done" | "working" | "blocked" | null (not started).
export function taskTone(state) {
  const s = state ?? "";
  if (/^(merged|done|finished|complete)/.test(s)) return "done";
  if (/block|fail|stuck/.test(s)) return "blocked";
  if (/^(planned|todo|pending|queued|not started|waiting to start)/.test(s) || !s) return null;
  return "working";
}

// A task the plan gave up on: neither open nor done, so it never holds the run back or counts
// toward "n/m done".
export const isDropped = (state) => /^(skipped|dropped|cancel+ed|won'?t|superseded|abandoned)/.test(state ?? "");

// How many tasks a run has done (`done`) and planned: one count for the Bridge's header, the
// cards, the pane and a confirm's "N of M tasks done" alike. Done is plan.md's tasks whose state
// reads done (taskTone), as the task strip shows them; status.json's `merged` only when plan.md
// lists no tasks, since an orchestrator updates it less often (one said 7 merged of 14 done).
// Planned is the larger of status.json's and plan.md's count, less the tasks dropped: a plan may
// list its tasks late.
export function taskCounts(run) {
  const tasks = run.tasks ?? [];
  const dropped = tasks.filter((task) => isDropped(task.state)).length;
  return {
    done: tasks.length ? tasks.filter((task) => taskTone(task.state) === "done").length : run.merged ?? 0,
    planned: Math.max(0, Math.max(run.planned ?? 0, tasks.length) - dropped),
  };
}

// Whether a run still has planned tasks to do: not finished, and fewer done than planned.
// plan.md's tasks alone decide when it lists any: some task neither done nor dropped. A stale,
// too-high `planned` in status.json (the plan was cut without marking tasks dropped) must not
// hold a ready PR back; the counts decide only when plan.md lists no tasks.
export function planOpen(run) {
  if (!run || run.phase === "finished") return false;
  const tasks = run.tasks ?? [];
  if (tasks.length) return tasks.some((task) => taskTone(task.state) !== "done" && !isDropped(task.state));
  const { done, planned } = taskCounts(run);
  return planned > done;
}

// Where a task is in its life cycle, from its state words: "planned" | "implement" |
// "review" | "fix" | "done" | "blocked", or null for a state that names no stage
// ("validating"). Agrees with taskTone on done, blocked and not started.
export function taskStage(state) {
  const tone = taskTone(state);
  if (tone === "done" || tone === "blocked") return tone;
  if (!tone) return "planned";
  if (/\bfix/.test(state)) return "fix";
  if (/review/.test(state)) return "review";
  if (/implement|in progress|working|started|coding|building/.test(state)) return "implement";
  return null;
}
