// Proof screenshots in Harbormaster: thumbnails in a task's Proof row, the viewer overlay a
// click on one opens, and the copies they need (media.js says why a file is copied first).
// Copies are made lazily, once per file, never during a render: a render only registers the
// files it wants, and main.js's render starts the copies, which redraw the view when done.

import { div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, writeTextFile, appHome, openOverlay, closeOverlay } from "herdr";
import { makeCopier, isImage, isVideo, mediaPath } from "./media.js";
import { openUrl } from "./live.js";
import { setNote } from "./note.js";

const copier = () => makeCopier({ exec, writeTextFile, home: appHome() });
const RECHECK = 60000; // a shown file is looked at again after this long, in case it changed
const RECHECK_BAD = 300000; // one that failed or was too large, less often: each look can be an ssh stat

const keyOf = (run, rel) => `${run.machine ?? ""}|${run.dir}|${rel}`;

// Notes that a shown file is wanted; nothing is copied until startCopies.
function want(view, run, rel) {
  view.media ??= new Map();
  view.wanted ??= [];
  const k = keyOf(run, rel);
  const have = view.media.get(k);
  const bad = have?.state === "error" || have?.state === "large";
  if (have && (have.state === "loading" || Date.now() - have.at < (bad ? RECHECK_BAD : RECHECK))) return have;
  // A copy that was ready, failed or was too large keeps showing while it is looked at again.
  const next = have && have.state !== "loading" ? { ...have, at: Date.now() } : { state: "loading", at: Date.now() };
  view.media.set(k, next);
  view.wanted.push({ run: { dir: run.dir, machine: run.machine ?? null }, rel, k });
  return next;
}

// Starts the copies the last render asked for. Called with the render's own cx.
export function startCopies(view, cx) {
  const list = view.wanted ?? [];
  view.wanted = [];
  for (const w of list) {
    cx.spawn(async (cx) => {
      let res;
      try { res = { ...(await copier()(w.run, w.rel)), at: Date.now() }; }
      catch (e) { res = { state: "error", error: e?.message ?? String(e), at: Date.now() }; }
      const was = view.media.get(w.k);
      view.media.set(w.k, res);
      if (was?.state !== res.state || was?.path !== res.path) cx.notify();
    });
  }
}

// Deletes a run's copies; the run is going.
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
const NOTE = { loading: "Copying…", error: "Could not copy" };

// One small thumbnail: an image (once copied) or a video mark. Click opens the viewer or the player.
function thumb(view, t, run, id, rel, open) {
  const box = div().id(id).flex_none().w(34).h(22).rounded(4).overflow_hidden().bg(t.raised).cursor_pointer()
    .flex().items_center().justify_center().text_size(10).text_color(t.dim)
    .hover((s) => s.opacity(0.85)).on_click((_e, cx) => { cx.stop_propagation(); open(cx); });
  if (isVideo(rel)) return box.tooltip(`Play ${rel}`).child("▶");
  const m = want(view, run, rel);
  if (m.state === "ready") return box.tooltip(rel).child(image(m.path).size_full());
  if (m.state === "large") return box.tooltip(`${rel}: too large to preview (${mb(m.size)})`).child("big");
  return box.tooltip(m.state === "error" ? `${NOTE.error}: ${m.error}` : NOTE.loading).child(m.state === "error" ? "!" : "…");
}

// A task's thumbnails: the first three of its images and videos, then "+n". `run` is the run
// ({dir, machine, key, branch}); `files` the names from proof.md.
export function thumbs(view, t, run, taskId, files) {
  const media = files.filter((f) => isImage(f) || isVideo(f));
  const images = media.filter(isImage);
  const row = h_flex().id(`pf-thumbs-${run.key}-${taskId}`).flex_none().gap(4).items_center();
  media.slice(0, 3).forEach((rel, i) => {
    const open = isImage(rel) ? () => openViewer(run, images, images.indexOf(rel)) : (cx) => playVideo(view, run, rel, cx);
    row.child(thumb(view, t, run, `pf-th-${run.key}-${taskId}-${i}`, rel, open));
  });
  if (media.length > 3) row.child(div().text_size(10).text_color(t.dim).child(`+${media.length - 3}`));
  return row;
}

// The viewer is its own overlay copy of the mod (role "viewer"); it copies and shows the files itself.
function openViewer(run, files, index) {
  openOverlay({
    mod: "harbormaster", kind: "dialog", width: 880, height: 620,
    props: { role: "viewer", dir: run.dir, machine: run.machine ?? null, files, index, title: run.branch ?? "" },
  });
}

// A video opens in the system player. On this machine, the file itself; on another it is
// copied first (up to the same size cap as images) and the copy opens.
function playVideo(view, run, rel, cx) {
  if (!run.machine) {
    try { openUrl(mediaPath(run.dir, rel)); } catch (e) { view.actionError = e.message; cx.notify(); }
    return;
  }
  setNote(view, `Copying ${rel.split("/").pop()}…`);
  view.actionError = null;
  cx.notify();
  cx.spawn(async (cx) => {
    try {
      const m = await copier()({ dir: run.dir, machine: run.machine }, rel);
      if (m.state === "large") view.actionError = `${rel.split("/").pop()} is too large to copy from ${run.machine} (${mb(m.size)}); open it there`;
      else openUrl(m.abs);
    } catch (e) { view.actionError = `${rel.split("/").pop()}: ${e?.message ?? e}`; }
    view.actionNote = null;
    cx.notify();
  });
}

// The viewer overlay's view: the image scaled to fit, its name, and previous/next.
export function viewer(view, t, p) {
  const files = p.files ?? [];
  const n = files.length;
  const i = Math.min(Math.max(view.viewIndex ?? p.index ?? 0, 0), Math.max(n - 1, 0));
  const run = { dir: p.dir, machine: p.machine ?? null };
  const rel = files[i];
  const m = rel ? want(view, run, rel) : null;
  for (const j of [i - 1, i + 1]) if (files[j]) want(view, run, files[j]);
  const go = (to) => (_e, cx) => { view.viewIndex = to; cx.notify(); };
  const btn = (id, label, onClick, tip) => div().id(id).flex_none().w(26).h(24).rounded(5).flex().items_center().justify_center()
    .bg(t.raised).text_color(onClick ? t.muted : t.dim).opacity(onClick ? 1 : 0.45).text_size(14)
    .when(Boolean(onClick), (el) => el.cursor_pointer().tooltip(tip).hover((s) => s.text_color(t.foreground)).on_click(onClick)).child(label);
  const body = !m ? "No image" : m.state === "ready" ? null
    : m.state === "large" ? `Too large to preview (${mb(m.size)}). Open it from ${p.machine ? `${p.machine}` : "the run folder"}.`
    : m.state === "error" ? `${NOTE.error}: ${m.error}` : NOTE.loading;
  return v_flex().id("viewer").size_full().bg(t.surface).text_size(12)
    .child(h_flex().gap(8).px(12).h(40).flex_none().items_center()
      .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground).tooltip(rel ?? "").child(rel ? rel.split("/").pop() : ""))
      .child(div().flex_none().text_color(t.dim).child(p.title ? `${p.title} · ${i + 1}/${n}` : `${i + 1}/${n}`))
      .child(btn("v-prev", "‹", i > 0 ? go(i - 1) : null, "Previous"))
      .child(btn("v-next", "›", i < n - 1 ? go(i + 1) : null, "Next"))
      .child(btn("v-close", "✕", () => closeOverlay(p.overlay), "Close (Esc)")))
    .child(div().flex_1().min_h(0).p(12).flex().items_center().justify_center().text_color(t.dim)
      .child(body ?? image(m.path).size_full()));
}
