// Stands in for the Herdr mod runtime's "herdr" module, so Harbormaster's plain logic runs under node.
export const exec = async () => ({ code: 0, stdout: "", stderr: "" });
export const terminals = () => [], agents = () => [], panes = () => [], spaces = () => [], machines = () => [];
export const run = () => null, window = () => null, focused = () => null, shared = () => null, setShared = () => null, settings = () => ({});
