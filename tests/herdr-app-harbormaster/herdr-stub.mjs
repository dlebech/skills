// Stands in for the Herdr mod runtime's "herdr" module, so Harbormaster's plain logic runs under node.
// A test may set globalThis.__herdrExec to answer exec itself.
export const exec = async (...a) => (globalThis.__herdrExec ?? (async () => ({ code: 0, stdout: "", stderr: "" })))(...a);
export const appHome = () => "/nonexistent", readTextFile = async (...a) => (globalThis.__herdrRead ?? (async () => "stub"))(...a);
// A test may set globalThis.__herdrTerminals / __herdrAgents for what the window holds.
export const terminals = () => globalThis.__herdrTerminals ?? [], agents = () => globalThis.__herdrAgents ?? [], panes = () => globalThis.__herdrPanes ?? [], spaces = () => [], machines = () => globalThis.__herdrMachines ?? [];
// run(): a Herdr command (tab.close, …); a test may set globalThis.__herdrRun to an array to record them.
export const run = (name, args) => { globalThis.__herdrRun?.push([name, args]); return null; }, window = () => null, focused = () => null, settings = () => ({});
// Herdr's shared state, kept in memory; a test calls resetShared() so one test's values don't reach the next.
// sharedReads counts the reads by key: in Herdr each one copies the whole value (store.js).
const sharedMap = new Map();
export const sharedReads = new Map();
export const shared = (key) => { sharedReads.set(key, (sharedReads.get(key) ?? 0) + 1); return sharedMap.get(key) ?? null; }, setShared = (key, value) => { sharedMap.set(key, value); return null; }, resetShared = () => { sharedMap.clear(); sharedReads.clear(); };
// For the New run dialog (newrun.js): overlays, toasts and the props a dialog is opened with.
// checking() is true, so the dialog's init does not list folders: a test sets them.
export const openOverlay = (o) => { globalThis.__herdrOpened = o; return null; }, closeOverlay = (id) => { globalThis.__herdrClosed = id; }, notify = () => null;
export const props = () => globalThis.__herdrProps ?? {}, home = () => "/home/u", checking = () => globalThis.__herdrChecking ?? true;
export const writeTextFile = async (...a) => (globalThis.__herdrWrite ?? (async () => null))(...a);
// The rest of what the mod imports, so a module that draws (crew.js) loads under node.
export const layout = () => null, nextCommand = () => new Promise(() => {}), setAgentOrder = () => null, theme = () => ({});
