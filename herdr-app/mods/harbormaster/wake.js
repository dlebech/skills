// The arguments that send a line to an orchestrator without waiting for it.
//
// `hc send` holds while a person has an unfinished draft in the target's input box, up to 60 s
// since their last key (`draft_wait` in hc's config), but a mod's exec stops a command after
// 30 s. Run in the exec, a send held that long was killed and reported as a failure, though it
// would have been delivered. So the send is started as a terminal of its own, which outlives the
// exec and takes its time; the exec only waits for hc to start it.

// A name for the sending terminal: unique among live terminals (1-32 of a-z 0-9 - _).
export const wakeName = (now = Date.now(), rand = Math.random()) => `wake-${now.toString(36)}${Math.floor(rand * 1296).toString(36)}`;

// `hc run` arguments that send `text` to `terminal` in a terminal of its own. It has no parent
// (so it is no one's worker and types no note anywhere), is removed when done, and carries the
// role `wake` so the Crew and the agent lists leave it out. It gets no herdr.space label, so no
// tab shows it in the window.
export const detachedSend = (terminal, text, name = wakeName()) =>
  ["run", "--bg", "--rm", "--no-notify", "--no-parent", "--label", "role=wake", "--name", name, "--", "hc", "send", terminal, text];

// Is this terminal one of those?
export const isWake = (t) => t?.labels?.role === "wake";
