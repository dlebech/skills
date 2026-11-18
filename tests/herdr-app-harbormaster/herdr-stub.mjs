// Stands in for the Herdr mod runtime's "herdr" module, so Harbormaster's plain logic runs under node.
// A test may set globalThis.__herdrExec to answer exec itself.
export const exec = async (...a) => (globalThis.__herdrExec ?? (async () => ({ code: 0, stdout: "", stderr: "" })))(...a);
export const appHome = () => "/nonexistent", readTextFile = async () => "stub";
// A test may set globalThis.__herdrTerminals / __herdrAgents for what the window holds.
export const terminals = () => globalThis.__herdrTerminals ?? [], agents = () => globalThis.__herdrAgents ?? [], panes = () => [], spaces = () => [], machines = () => globalThis.__herdrMachines ?? [];
export const run = () => null, window = () => null, focused = () => null, settings = () => ({});
// Herdr's shared state, kept in memory; a test calls resetShared() so one test's values don't reach the next.
const sharedMap = new Map();
export const shared = (key) => sharedMap.get(key) ?? null, setShared = (key, value) => { sharedMap.set(key, value); return null; }, resetShared = () => sharedMap.clear();
// For the New run dialog (newrun.js): overlays, toasts and the props a dialog is opened with.
// checking() is true, so the dialog's init does not list folders: a test sets them.
export const openOverlay = () => null, closeOverlay = (id) => { globalThis.__herdrClosed = id; }, notify = () => null;
export const props = () => globalThis.__herdrProps ?? {}, home = () => "/home/u", checking = () => true;
export const writeTextFile = async (...a) => (globalThis.__herdrWrite ?? (async () => null))(...a);
// The rest of what the mod imports, so a module that draws (crew.js) loads under node.
export const layout = () => null, nextCommand = () => new Promise(() => {}), setAgentOrder = () => null, theme = () => ({});
