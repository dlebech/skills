// The page's link to the server, with no DOM in it so it can be tested. It opens the event stream first. If no
// scene arrives within 4 s (a proxy that buffers streams, as Cloudflare quick tunnels do) or the stream fails
// before the first scene, it closes the stream and long-polls for the rest of the page's life.
//   openEvents({ scene, poke, open, error }) -> { close() }   error(closed): closed is true when the browser gave up
//   poll(after) -> Promise<{ n, scene?, pokes? }>             rejects on any failure
//   setTimer(fn, ms) -> cancel()                              now is accepted for symmetry and unused
//   onScene(scene), onPoke(poke), onState(transport, ok)      transport is "sse" or "poll"
export const FIRST_SCENE_MS = 4000
export function createFeed({ openEvents, poll, now, setTimer, onScene, onPoke, onState }) {
  let mode = "sse", stream = null, gotScene = false, cancelFirst = null
  let after = 0, running = false, hidden = false, stopped = false, failMs = 0, retryMs = 5000

  // Open the event stream; if it never delivers a scene, long-poll instead.
  function open() {
    if (stopped || mode !== "sse") return
    stream = openEvents({
      scene: s => { gotScene = true; cancelFirst?.(); cancelFirst = null; retryMs = 5000; onState("sse", true); onScene(s) },
      poke: p => onPoke(p),
      open: () => { retryMs = 5000 },
      error: closed => {
        if (mode !== "sse") return
        if (!gotScene) return usePoll()
        onState("sse", false)
        // a refusal (503 when the listener is full) closes an EventSource for good: try again, 5 s doubling to 30 s
        if (closed) { stream.close(); const ms = retryMs; retryMs = Math.min(retryMs * 2, 30000); setTimer(open, ms) }
      },
    })
    if (!gotScene) cancelFirst = setTimer(() => { cancelFirst = null; if (!gotScene) usePoll() }, FIRST_SCENE_MS)
  }

  // Close the stream and poll from now on.
  function usePoll() {
    if (mode === "poll") return
    mode = "poll"
    cancelFirst?.(); cancelFirst = null
    stream?.close()
    onState("poll", false)
    loop()
  }

  // One poll after another: right away after an answer, with a growing pause (1 s to 15 s) after a failure, and
  // not at all while the tab is hidden.
  async function loop() {
    if (running) return
    running = true
    try {
      while (mode === "poll" && !hidden && !stopped) {
        try {
          const b = await poll(after)
          failMs = 0
          if (typeof b.n === "number") after = b.n
          onState("poll", true)
          if (b.scene) onScene(b.scene)
          for (const p of b.pokes || []) onPoke(p)
        } catch {
          failMs = failMs ? Math.min(failMs * 2, 15000) : 1000
          onState("poll", false)
          await new Promise(ok => setTimer(ok, failMs))
        }
      }
    } finally { running = false }
  }

  return {
    start: open,
    // The tab was hidden or shown. Hidden stops polling after the poll in flight; shown polls once more.
    setHidden(h) { hidden = !!h; if (!hidden && mode === "poll") loop() },
    stop() { stopped = true; cancelFirst?.(); stream?.close() },
    transport: () => mode,
  }
}
