// Bringing orchestrators back after a restart, in their own terminals.
//
// herdr-core keeps terminals across a restart of the machine (or of herdr-core) but not their
// programs: a kept terminal comes back with a shell in place of its agent (hc keep), so the
// orchestrator is "lost" (live.js orchestratorLost) though its tab, address and labels are all
// still there. Every harness an orchestrator can be resumes a conversation by its session id, and
// the run's `sessions` file has the orchestrator's (tokens.sh records it). So for each open run
// whose orchestrator is lost, Harbormaster types that harness's resume command into the shell left
// in its terminal: the same conversation comes back in the same terminal, and nothing else about
// the run changes. A resumed conversation waits for a message, so this costs no tokens by itself.
//
// Once per shell: the run's machine keeps a `.revived-<sum>` directory in the run directory, the
// sum of the terminal, the shell's pid and that process's start time, made with mkdir (atomic, so
// two Harbormaster copies or windows cannot both type it). A shell left after the resumed agent
// exits is the same shell, so it is never typed into twice; the next restart's shell is a new one.
//
// A run that was working when it stopped gets an inbox note and, once its agent reports, the
// wake-up to read it (its agents ended with the restart, recovery.md step 7). One that was
// waiting or finished gets the note only, read with the next message it is sent.

import { exec } from "herdr";
import { facts, orchestratorLost, exactStatus } from "./live.js";
import { shared, setShared } from "./store.js";

// The command that resumes a session of each kind: [program, ...arguments before the id], and
// whether the id is joined to the last argument with "=". Codex is left out: it cannot be started
// on a session id of ours and tokens.sh does not record its sessions, so it keeps Resume.
export const RESUME = {
  claude: ["claude", "--resume"],
  pi: ["pi", "--session"],
  opencode: ["opencode", "--session"],
  copilot: ["copilot", "--resume="],
};

// Characters a session id (or pi's session file) and a folder may have to be typed into a shell
// without quoting trouble in sh, bash, zsh or fish. Anything else: not typed, Resume stays.
const SAFE_ID = /^[A-Za-z0-9._\/~:-]+$/;
const SAFE_DIR = /^[^'\\\n\r]+$/;

// The line typed into the shell, or null when the kind has no resume command or the id or folder
// is not safe to type. Not `exec`: if the resume fails, its error stays readable above the shell.
export function resumeLine(kind, id, folder) {
  const cmd = RESUME[kind];
  if (!cmd || !id || !SAFE_ID.test(id) || (folder && !SAFE_DIR.test(folder))) return null;
  const [prog, flag] = cmd;
  const resume = flag.endsWith("=") ? `${prog} ${flag}${id}` : `${prog} ${flag} ${id}`;
  return folder ? `cd '${folder}' && ${resume}` : resume;
}

// The orchestrator's latest session of its kind from the `sessions` file: its last line that
// starts with the kind (tokens.sh appends each new one), or null.
export function latestSession(text, kind) {
  let id = null;
  for (const line of String(text ?? "").split("\n")) {
    const m = /^(\S+)\s+(.+?)\s*$/.exec(line);
    if (m && m[1] === kind) id = m[2];
  }
  return id;
}

// The note left in the run's inbox. Informational: it must not move a waiting or finished run.
export const RESTART_NOTE = "restarted: the machine or herdr-core restarted, and Harbormaster resumed your session in the same terminal. "
  + "Your agents' terminals ended with it. Do not change the run's status for this note. If the run has unfinished tasks, "
  + "reconcile and restart them as recovery.md steps 7 and 8 say, then carry on; if it is waiting or finished, there is nothing else to do.";

// Which runs to bring back: open (not parked or closed), their orchestrator lost, of a kind with
// a resume command, and not tried already in this Harbormaster (`tried`, by terminal and when the
// terminal was last seen lost: the machine's guard decides for good, this only saves the exec).
export function revivable(runs, ctx, { lost = orchestratorLost, tried = new Set() } = {}) {
  return runs.filter((r) => !r.away && r.localTerminal && RESUME[r.kind || "claude"] && !tried.has(r.key) && lost(r, ctx));
}

// One sh script on the run's machine: checks the terminal is live with a shell in front, reads the
// session, takes the guard, writes the note, types the line. Prints one word:
//   resumed | done (guard already taken) | nosession | notshell | unsafe | gone
// $1 run dir, $2 terminal, $3 kind, $4 folder, $5 note file name, $6 note text.
// The line is built here in sh as resumeLine builds it in JS (tested against each other).
export const REVIVE = `
d=$1 t=$2 kind=$3 folder=$4 nf=$5 note=$6
j=$(hc get "$t" --json 2>/dev/null) || { echo gone; exit 0; }
set -- $(printf '%s' "$j" | jq -r '[.state, (.foreground.pid // .pid // ""), ((.foreground.argv[0] // .argv[0] // "") | split("/") | last), (.status.state // "")] | map(if . == "" then "-" else tostring end) | join(" ")')
[ "$1" = live ] || { echo gone; exit 0; }
case $3 in bash|zsh|fish|sh|dash|ksh|-bash|-zsh|-fish|-sh) ;; *) echo notshell; exit 0 ;; esac
[ "$4" = - ] || { echo notshell; exit 0; }
pid=$2
id=$(awk -v k="$kind" '$1 == k { $1 = ""; sub(/^ +/, ""); v = $0 } END { print v }' "$d/sessions" 2>/dev/null)
[ -n "$id" ] || { echo nosession; exit 0; }
case $kind in
  claude) cmd="claude --resume $id" ;;
  pi) cmd="pi --session $id" ;;
  opencode) cmd="opencode --session $id" ;;
  copilot) cmd="copilot --resume=$id" ;;
  *) echo nosession; exit 0 ;;
esac
case $id in *[!A-Za-z0-9._/~:-]*) echo unsafe; exit 0 ;; esac
case $folder in *"'"*|*\\\\*) echo unsafe; exit 0 ;; esac
[ -z "$folder" ] || cmd="cd '$folder' && $cmd"
started=$(ps -o lstart= -p "$pid" 2>/dev/null)
sum=$(printf '%s %s %s' "$t" "$pid" "$started" | cksum | cut -d' ' -f1)
mkdir "$d/.revived-$sum" 2>/dev/null || { echo done; exit 0; }
for o in "$d"/.revived-*; do [ "$o" = "$d/.revived-$sum" ] || rmdir "$o" 2>/dev/null; done
mkdir -p "$d/inbox" && printf '%s\\n' "$note" >"$d/inbox/.$nf.tmp" && mv "$d/inbox/.$nf.tmp" "$d/inbox/$nf"
hc send "$t" "$cmd" >/dev/null 2>&1 || { rmdir "$d/.revived-$sum"; echo gone; exit 0; }
echo resumed
`;

// The note's file name, as the inbox's other messages are named (inbox.js writeInbox).
export function noteName(now = new Date()) {
  const iso = now.toISOString();
  return `${iso.replace(/[-:]|\.\d+/g, "")}-${iso.slice(20, 23)}-harbormaster-restart.message`;
}

// Module memory: runs tried in this copy (so one poll each, not one every 5 s), and runs resumed
// that were working, whose wake waits for their agent to report.
const tried = new Set();
const WAKES = "harbormaster.revive-wakes";

// Brings back what revivable() picks, one run after another. Resolves to the names of the runs
// resumed, for the view's note. `wake(run, file)` tells a resumed orchestrator to read its note.
export async function reviveRuns(runs, { wake, now = () => new Date() } = {}) {
  const ctx = facts();
  const resumed = [];
  for (const r of revivable(runs, ctx, { tried })) {
    tried.add(r.key);
    const nf = noteName(now());
    const out = await exec("sh", ["-c", REVIVE, "sh", r.dir, r.localTerminal, r.kind || "claude", r.folder ?? "", nf, RESTART_NOTE], { on: r.machine })
      .catch((e) => ({ code: -1, stdout: "", stderr: e?.message ?? String(e) }));
    const word = String(out.stdout ?? "").trim();
    if (word === "resumed") {
      resumed.push(r.topic || r.branch);
      if (r.phase === "running") setShared(WAKES, { ...(shared(WAKES) ?? {}), [r.key]: { file: nf, at: Date.now() } });
    } else if (out.code !== 0 || word === "gone") tried.delete(r.key); // a machine not reached: try again next poll
    else console.log(`harbormaster: not resumed ${r.branch}: ${word || out.stderr}`);
  }
  // A run that was working: wake it once its agent reports idle or done (10 minutes at most).
  const wakes = shared(WAKES) ?? {};
  const left = { ...wakes };
  for (const [key, w] of Object.entries(wakes)) {
    const r = runs.find((x) => x.key === key);
    const st = r && exactStatus(r.terminal, ctx);
    const ready = st === "idle" || st === "done";
    if (r && !ready && Date.now() - w.at < 600000) continue;
    delete left[key];
    if (ready) await wake(r, w.file).catch((e) => console.log(`harbormaster: restart wake failed for ${r.branch}: ${e?.message ?? e}`));
  }
  if (Object.keys(left).length !== Object.keys(wakes).length) setShared(WAKES, left);
  return resumed;
}

// For tests: forget what this copy tried.
export const forgetTried = () => tried.clear();
