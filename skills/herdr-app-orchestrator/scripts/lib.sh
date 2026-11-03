# Shared by init-run.sh and integration-worktree.sh; source it, do not run it.

# branch_slug <branch>: the branch as one path component, with each run of
# characters other than A-Z a-z 0-9 . _ - as "-". Used for both the run directory
# and the integration worktree, so a run's two folders have the same name.
branch_slug() {
  printf '%s' "$1" | sed -E 's/[^A-Za-z0-9._-]+/-/g; s/^-+//; s/-+$//'
}
