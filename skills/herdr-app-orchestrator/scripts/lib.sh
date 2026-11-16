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

# status_merge <run-directory> <json-object>: sets the object's keys in status.json,
# keeping the other fields; atomic, through a temporary file of its own.
status_merge() {
  local old tmp=$1/.status-merge.$$.tmp
  old=$(status_read "$1") || return 1
  jq -n --argjson old "$old" --argjson new "$2" '$old + $new' >"$tmp" && mv "$tmp" "$1/status.json" ||
    { rm -f "$tmp"; return 1; }
}
