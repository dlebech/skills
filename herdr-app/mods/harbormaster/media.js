// Proof screenshots and videos: where a run's files live, and copying one into the mod's own
// folder. gpui's image() only loads from ~/.config/herdr-app, and a run on another machine
// has its files there, so a file is copied first: with cp on this machine, or, on another,
// through exec's stdout (base64, which grows by 4/3 and exec's output is capped at 8 MiB).
// No herdr imports: the host calls are passed in, so it runs under plain node.

// Sources over this are not copied. Base64 of 6 MB is 8 MB, just under exec's 8 MiB output cap.
export const MAX_COPY = 6_000_000;

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v)$/i;
export const isImage = (name) => IMAGE.test(name ?? "");
export const isVideo = (name) => VIDEO.test(name ?? "");

// A short stable name for a string, for folder and file names (djb2, base 36).
export function hash(s) {
  let h = 5381;
  for (const c of String(s)) h = ((h * 33) ^ c.codePointAt(0)) >>> 0;
  return h.toString(36).padStart(7, "0");
}
const safe = (s) => String(s).replace(/[^\w.-]+/g, "_").replace(/^\.+/, "").slice(-60) || "file"; // never "." or ".."


// A file named in proof.md: relative to the run directory, or a bare name in shared/proof/. Only files
// under the run directory count: a name with `..` or an absolute path elsewhere throws.
export function mediaPath(dir, rel) {
  const path = rel.startsWith("/") ? rel : `${dir}/${rel.includes("/") ? rel : `shared/proof/${rel}`}`;
  if (path.split("/").includes("..") || !path.startsWith(`${dir}/`)) throw new Error(`${rel} is not under the run directory`);
  return path;
}

// The cache is a hidden folder, so saving into it doesn't reload the mod (Herdr skips
// hidden files). One folder per run: <home>/mods/harbormaster/.cache/<machine|local>/<hash of the run dir>.
export const CACHE = "mods/harbormaster/.cache";
export const runCacheDir = (home, machine, dir) => `${home}/${CACHE}/${safe(machine || "local")}/${hash(dir)}`;

// Removes a run's cache folder. The case guard keeps the rm inside the cache.
const DROP = 'case "$1" in *..*) exit 0;; esac; case "$1" in */mods/harbormaster/.cache/*/*) rm -rf -- "$1";; esac; rmdir -- "${1%/*}" 2>/dev/null; exit 0';
export const dropCacheArgs = (home, machine, dir) => ["-c", DROP, "sh", runCacheDir(home, machine, dir)];

const STAT = 'stat -c "%s %Y" "$1" 2>/dev/null || stat -f "%z %m" "$1"';
// Older copies of the same file (another size or time) go once the new one is in; $3 is the file's key.
// Temporary files of a copy that died (over 10 minutes old) go too.
const STALE = [
  'for f in "$1/$3"-*; do case "$f" in "$1/$2"|"$1/$2".*) ;; *) rm -f -- "$f";; esac; done',
  'find "$1" -maxdepth 1 \\( -name "*.tmp*" -o -name "*.b64.*" \\) -mmin +10 -exec rm -f -- {} + 2>/dev/null',
].join("\n");
// Keeps the file if the cache has it under this size and time; else cp.
const LOCAL = [
  'mkdir -p "$1" || exit 1',
  '[ -s "$1/$2" ] && exit 0',
  // $5 is the size stat saw: a file that changed since is not cached under a name that claims otherwise.
  'if cp -- "$4" "$1/$2.tmp$$" && [ "$(wc -c < "$1/$2.tmp$$")" -eq "$5" ]; then mv -- "$1/$2.tmp$$" "$1/$2"; else rm -f -- "$1/$2.tmp$$"; exit 1; fi',
  STALE,
].join("\n");
const HAVE = 'mkdir -p "$1" && [ -s "$1/$2" ]';
const FROM_B64 = [
  'base64 -d < "$4" > "$1/$2.tmp$$" 2>/dev/null || base64 -D < "$4" > "$1/$2.tmp$$"; r=$?',
  'rm -f "$4"',
  // A cut-off or changed file decodes without error but is the wrong size.
  'if [ $r = 0 ] && [ "$(wc -c < "$1/$2.tmp$$")" -eq "$5" ]; then mv -- "$1/$2.tmp$$" "$1/$2"; else rm -f -- "$1/$2.tmp$$"; echo "copy is not the size it should be" >&2; exit 1; fi',
  STALE,
].join("\n");

// deps: { exec, writeTextFile, home }. Returns copy({dir, machine}, rel) →
// { state: "ready", path (under the app's home, for image()), abs, size } | { state: "large", size };
// rejects with an Error when the file can't be read or copied.
export function makeCopier({ exec, writeTextFile, home }) {
  return async function copy(run, rel) {
    const on = run.machine ?? undefined;
    const src = mediaPath(run.dir, rel);
    const st = await exec("sh", ["-c", STAT, "sh", src], { on });
    const [size, mtime] = st.stdout.trim().split(/\s+/).map(Number);
    if (st.code !== 0 || !Number.isFinite(size)) throw new Error(`cannot read ${src}${on ? ` on ${on}` : ""}`);
    if (size > MAX_COPY) return { state: "large", size };
    const folder = runCacheDir(home, run.machine, run.dir);
    const key = hash(rel);
    const name = `${key}-${size}-${mtime}-${safe(rel.split("/").pop())}`;
    const out = { state: "ready", size, abs: `${folder}/${name}`, path: `${CACHE}/${safe(run.machine || "local")}/${hash(run.dir)}/${name}` };
    if (!on) {
      const r = await exec("sh", ["-c", LOCAL, "sh", folder, name, key, src, String(size)]);
      if (r.code !== 0) throw new Error(r.stderr.trim() || "cp failed");
      return out;
    }
    if ((await exec("sh", ["-c", HAVE, "sh", folder, name])).code === 0) return out;
    const b64 = await exec("sh", ["-c", 'base64 < "$1" | tr -d "\\n"', "sh", src], { on, timeout: 120000 });
    if (b64.code !== 0) throw new Error(b64.stderr.trim() || `base64 failed on ${on}`);
    // writeTextFile only writes text, so the base64 goes in as a temporary file and is decoded.
    const tmp = `${folder}/${name}.b64.${Math.random().toString(36).slice(2, 8)}`;
    try { await writeTextFile(tmp, b64.stdout, null); }
    catch (e) { await exec("rm", ["-f", tmp]).catch(() => {}); throw e; }
    const r = await exec("sh", ["-c", FROM_B64, "sh", folder, name, key, tmp, String(size)]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || "could not decode the copy");
    return out;
  };
}
