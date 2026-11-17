// Machine sleep must not count as a run being quiet. While a machine is suspended every agent
// on it is frozen, so on waking its runs look idle for the whole sleep. Two kinds of sleep:
//   - this machine's own: the monotonic clock (performance.now) stands still in suspend while
//     the wall clock (Date.now) moves on, so the growth of wall minus monotonic between two
//     looks is exactly the time asleep. A slow read, a busy machine or a closed view moves
//     both clocks alike, so none of them looks like a sleep.
//   - another machine's: Harbormaster cannot see it while it sleeps, so its runs are marked
//     stale; when it answers again after being unseen for SLEEP_GAP_MS it has just woken.
// The quiet clock of the runs then starts again from the wake: a fresh grace window, and a
// real stall still shows after STALL_MS awake. Several sleeps need no sum: each wake restarts it.

// Clock drift this large between two looks is a sleep (a wall clock step by ntp is smaller).
export const SLEEP_GAP_MS = 2 * 60000;

// A look at both clocks: {wall, mono}. Without a monotonic clock, mono is null (no detection).
export const clockNow = (wall = Date.now(), mono = globalThis.performance?.now?.() ?? null) => ({ wall, mono });

// The wake time (ms) when the machine slept between the look `prev` and the look `cur`, else null.
export function sleptThrough(prev, cur, gap = SLEEP_GAP_MS) {
  if (!prev || prev.mono == null || cur.mono == null) return null;
  return (cur.wall - cur.mono) - (prev.wall - prev.mono) > gap ? cur.wall : null;
}

// The later of a run's last sign of life and the latest wake: quiet is measured from there.
// Null stays null (nothing seen yet).
export const awakeSince = (last, wokeAt) => (last == null ? null : Math.max(last, wokeAt ?? 0));

// Another machine's wake: `unseenSince` is when a poll first missed it (null if it answered
// the last one); `now` is a poll it answered. The wake time, else null.
export const machineWoke = (unseenSince, now, gap = SLEEP_GAP_MS) => (unseenSince != null && now - unseenSince > gap ? now : null);
