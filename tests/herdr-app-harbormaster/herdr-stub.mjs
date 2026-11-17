// Stands in for the Herdr mod runtime's "herdr" module, so Harbormaster's plain logic runs under node.
// A test may set globalThis.__herdrExec to answer exec itself.
export const exec = async (...a) => (globalThis.__herdrExec ?? (async () => ({ code: 0, stdout: "", stderr: "" })))(...a);
export const appHome = () => "/nonexistent", readTextFile = async () => "stub";
// A test may set globalThis.__herdrTerminals / __herdrAgents for what the window holds.
export const terminals = () => globalThis.__herdrTerminals ?? [], agents = () => globalThis.__herdrAgents ?? [], panes = () => [], spaces = () => [], machines = () => [];
export const run = () => null, window = () => null, focused = () => null, shared = () => null, setShared = () => null, settings = () => ({});
