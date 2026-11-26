// What a run's PR does to each of its issues (set-status.sh --issue-link): closes it on merge,
// or only refers to it so it stays open. Pure, so tests can read it.

// The pill beside an issue row, or null when the orchestrator has not said (or wrote a link
// this does not know: guessing "stays open" could hide an issue the merge closes). `link` is
// {link: "closes" | "refs" | "part", why}; closing is the one that warns, since a merge
// closes the issue for everyone following it.
export function issueLinkPill(link) {
  if (!link?.link) return null;
  const why = link.why ? ` (${link.why})` : "";
  if (link.link === "closes") {
    return { label: "⚠ Closes on merge", tone: "amber", tip: `The run's PR has a Closes line: merging it closes this issue${why}` };
  }
  if (link.link === "part") {
    return { label: "Part of", tone: "dim", tip: `The PR does part of this issue; it stays open${why}` };
  }
  if (link.link === "refs") {
    return { label: "Stays open", tone: "dim", tip: `The PR only refers to this issue${why}` };
  }
  return null;
}
