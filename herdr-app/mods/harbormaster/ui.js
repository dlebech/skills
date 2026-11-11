// Small shared pieces for drawing: emoji, program icons, zoom, and text formatting.

import { div, svg, image } from "gpui-kit";
import { settings } from "herdr";

export const CAPTAIN = "\u{1F9D1}‍✈️", OCTOPUS = "\u{1F419}", CRAB = "\u{1F980}";

// A terminal's program icon: tinted glyphs in `color`, full-color images as they are.
export function programIcon(program, size, color) {
  if (!program?.icon) return div().size(size);
  return (program.tint ? svg(program.icon).text_color(program.color ?? color) : image(program.icon)).size(size);
}

// The app's zoom. on_size_change reports unzoomed px while views draw in zoomed px.
export const zoom = () => Number(settings()?.zoom) || 1;

// "1 run", "2 runs"; pass the plural when it isn't word + "s".
// A task's state as Harbormaster shows it: "merged" reads "done", since a task merges
// into the run's integration branch, not into main, and "merged" suggests the latter.
export const stateText = (state) => (state ?? "").replace(/^merged\b/, "done");

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export function ago(ms) {
  if (!ms) return "";
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

// A run's name for scanning: the issue or PR number from its branch and the topic
// its orchestrator published, "#985 · Road routes" or "PR 368 · Review",
// else the topic alone, else the branch.
export function runTitle(branch, topic) {
  if (!topic) return branch ?? "";
  const pr = /(?:^|[-_/])pr-?(\d+)(?=$|[-_/])/i.exec(branch ?? "");
  const issue = /(?:^|[-_/])issue-?(\d+)(?=$|[-_/])/i.exec(branch ?? "");
  const ref = pr ? `PR ${pr[1]}` : issue ? `#${issue[1]}` : null;
  return ref ? `${ref} · ${topic}` : topic;
}

// "https://github.com/o/repo/issues/12" → "repo#12".
export const shortRef = (url) => {
  const m = /github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/.exec(url ?? "");
  return m ? `${m[2]}#${m[4]}` : url;
};
