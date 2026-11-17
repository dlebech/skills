// The Spaces picker: one row at the foot of the sidebar list (above Settings) ("skills ▾ · 8 spaces", role "spaces")
// and the popup it opens (role "spaces-list"): every space grouped by repository, a run's
// worktree spaces dimmed under their repository, plain folders under "Other". It replaces
// Herdr's own Spaces list in the harbormaster-needs layout; the row switches space and
// makes new ones with Herdr's own commands.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, spaces, panes, layout, run, openOverlay, closeOverlay, props } from "herdr";
import { plural } from "./words.js";
import { whereOf, repoOf, groupSpaces } from "./spacegroups.js";
import { zoom } from "./ui.js";

// The repositories git last told us about, so the popup is sized right from its second opening on.
let lastRepos = {};

// Asks git where each space is: { [space id]: repoOf(...) }, `fill` called as each one answers.
// A machine that is away or slow (2 s) leaves its spaces under Other.
function askRepos(fill) {
  const ps = panes();
  return Promise.all(spaces().map(async (s) => {
    const cwd = whereOf(s, ps);
    if (!cwd) return;
    try {
      const r = await exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { cwd, on: s.machine, timeout: 2000 });
      if (r.code === 0) fill(s.id, repoOf(r.stdout.trim()));
    } catch { /* under Other */ }
  }));
}

// The popup's size: rows are 26 px, headers 24 + 8 below, the new-space row 30, 6 padding top
// and bottom. A popup is as tall as its items, `MAX` is the most before the list scrolls.
const MAX = 460, FIXED = 12 + 30;
const listHeight = (groups) => Math.min(MAX, FIXED + groups.length * 32 + groups.reduce((n, g) => n + g.spaces.length * 26, 0));

// Opens the popup at once, its bottom edge just above the row (the row is at the foot of the
// window), sized from what git said last time; the popup asks git itself and fills in.
// The row's top and `at` are in zoomed px, the height in unzoomed ones.
function openList(top) {
  // Before git has answered once, leave room for a second group's header.
  const groups = groupSpaces(spaces(), lastRepos);
  const height = listHeight(Object.keys(lastRepos).length ? groups : [...groups, { spaces: [] }]);
  openOverlay({ mod: "harbormaster", kind: "popup", width: 300, height, at: { x: 10, y: Math.max(8, top - height * zoom() - 6) }, props: { role: "spaces-list", height } });
}

// The popup's copy: asks git as it opens.
export function startSpacesList(view, cx) {
  view.repos = { ...lastRepos };
  cx.spawn(async (cx) => {
    await askRepos((id, r) => { view.repos[id] = r; lastRepos[id] = r; cx.notify(); });
  });
}

// The sidebar's rail (dragged narrow) has no room for a name.
const narrow = (node = layout()) => node?.id === "sidebar" ? (node.size?.px ?? Infinity) < 160 : (node?.children ?? []).some((c) => narrow(c));

// The row: the shown space, ▾ and how many there are. A click opens the popup above it.
export function spacesRow(t) {
  const all = spaces(), cur = all.find((s) => s.active), rail = narrow();
  return h_flex().id("spaces-row").size_full().px(16).gap(8).items_center().cursor_pointer().text_size(12.5)
    .hover((s) => s.bg(t.hover))
    .on_mouse_up("left", (e) => openList(e.bounds?.y ?? e.position.y))
    .when(rail, (el) => el.px(0).justify_center())
    .when(!rail, (el) => el.child(div().min_w(0).truncate().text_color(t.foreground).child(cur?.name ?? "No space")))
    .child(svg("mods/harbormaster/chevron-down.svg").size(11).flex_none().text_color(t.muted))
    .when(!rail, (el) => el.child(div().flex_none().text_color(t.dim).child(`· ${plural(all.length, "space")}`)))
    .when(rail, (el) => el.child(div().flex_none().text_color(t.dim).child(String(all.length))));
}

const close = () => { try { closeOverlay(props()?.overlay); } catch { /* gone */ } };

function item(t, { space, linked }, repoName) {
  const label = space.name === repoName ? (space.branch ?? space.name) : space.name;
  return h_flex().id(`sp-${space.id}`).h(26).px(8).mx(4).gap(8).items_center().rounded(6).cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .when(space.active, (el) => el.bg(t.selected))
    .on_click(() => { run("space.select", { id: space.id }); close(); })
    .when(linked, (el) => el.pl(20))
    .child(div().w(10).flex_none().text_size(11).text_color(t.accent).child(space.active ? "●" : ""))
    .child(div().flex_1().min_w(0).truncate().text_color(linked ? t.dim : t.foreground).child(label));
}

function groupView(t, g, multiMachine) {
  const title = multiMachine && g.machine ? `${g.name} · ${g.machine}` : g.name;
  return v_flex().gap(1).pb(8)
    .child(div().px(12).h(24).flex().items_center().text_size(10.5).font_semibold().text_color(t.dim).child(title.toUpperCase()))
    .children(g.spaces.map((x) => item(t, x, g.name)));
}

export function spacesList(view, t) {
  const all = spaces();
  const groups = groupSpaces(all, view.repos ?? {});
  const multi = new Set(all.map((s) => s.machine ?? null)).size > 1;
  return v_flex().size_full().min_h(0).text_size(12.5).py(6)
    .child(v_flex().h((props()?.height ?? MAX) - FIXED).overflow_y_scrollbar().children(groups.map((g) => groupView(t, g, multi))))
    .child(h_flex().id("sp-new").h(30).mx(4).px(8).gap(8).items_center().rounded(6).cursor_pointer().text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(() => { run("space.new"); close(); })
      .child(div().w(10).flex_none().child("+")).child("new space"));
}
