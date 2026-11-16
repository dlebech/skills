// Stands in for the Herdr mod runtime's "herdr" module, so Harbormaster's plain logic runs under node.
// A test may set globalThis.__herdrExec to answer exec itself.
export const exec = async (...a) => (globalThis.__herdrExec ?? (async () => ({ code: 0, stdout: "", stderr: "" })))(...a);
export const appHome = () => "/nonexistent", readTextFile = async () => "stub";
export const terminals = () => [], agents = () => [], panes = () => [], spaces = () => [], machines = () => [];
export const run = () => null, window = () => null, focused = () => null, shared = () => null, setShared = () => null, settings = () => ({});
