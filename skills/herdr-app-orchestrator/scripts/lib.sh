# Shared by the scripts in this folder; source it, do not run it.

# branch_slug <branch>: the branch as one path component, with each run of
# characters other than A-Z a-z 0-9 . _ - as "-". Used for both the run directory
# and the integration worktree, so a run's two folders have the same name.
branch_slug() {
  printf '%s' "$1" | sed -E 's/[^A-Za-z0-9._-]+/-/g; s/^-+//; s/-+$//'
}

# status_read <run-directory>: prints status.json as one line, or {} when there is
# none; fails, saying why, when it is not a JSON object, so nothing overwrites it.
status_read() {
  [ -e "$1/status.json" ] || { echo '{}'; return 0; }
  jq -ce 'objects' "$1/status.json" 2>/dev/null ||
    { echo "$1/status.json is not a JSON object; fix or remove it" >&2; return 1; }
}

# status_update <run-directory> <jq filter> [<jq argument>...]: rewrites status.json as
# the filter makes it from the current one (`.`, {} when there is none), atomically and
# under a lock, so two scripts publishing at once cannot undo each other's write.
status_update() {
  local dir=$1 filter=$2 old tmp=$1/.status.$$.tmp rc=0
  shift 2
  status_lock "$dir"
  old=$(status_read "$dir") &&
    jq -n --argjson old "$old" "$@" "\$old | $filter" >"$tmp" && mv "$tmp" "$dir/status.json" || rc=1
  rm -f "$tmp"
  status_unlock "$dir"
  return $rc
}

# The lock status_update holds: a file bash creates only if it is not there (set -C,
# an exclusive create; mkdir is not atomic in every coreutils: uutils' lets two racing
# calls both succeed). A holder only runs one jq, so a lock still there after 5 s is
# left over from a killed script and taken over.
status_lock() {
  local tries=0
  until (set -C; : >"$1/.status.lock") 2>/dev/null; do
    tries=$((tries + 1))
    [ $tries -lt 50 ] || { rm -f "$1/.status.lock"; tries=0; }
    sleep 0.1
  done
}
status_unlock() { rm -f "$1/.status.lock"; }

# Sets `tokens` from $tokens (tokens.sh's count), unless it is null or lower than the
# count already there: a count only grows, so a lower one means sessions went missing.
STATUS_TOKENS_FILTER='if $tokens != null and ($tokens.total // 0) >= (.tokens.total // 0) then .tokens = $tokens else . end'
