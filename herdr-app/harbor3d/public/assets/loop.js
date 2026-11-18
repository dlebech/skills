// The render loop's one handle. `start()` queues a frame only when none is pending and `stop()` cancels the
// pending one, so hiding and showing the page any number of times leaves exactly one loop. The next frame is
// queued before `fn` runs, so an error in `fn` does not stop the loop.
export function createLoop(raf, caf, fn) {
  let handle = 0
  const tick = t => { handle = raf(tick); fn(t) }
  return {
    start() { if (!handle) handle = raf(tick) },
    stop() { if (handle) { caf(handle); handle = 0 } },
    running: () => handle !== 0,
  }
}
