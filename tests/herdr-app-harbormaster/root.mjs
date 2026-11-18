// Shared by the tests that run the mod's real sh scripts against a throwaway run root.
import { spawnSync } from "node:child_process";

// Only sh runs for real, with the throwaway root; hc and gh are not called.
export function withRoot(root) {
  globalThis.__herdrExec = async (cmd, args) => {
    if (cmd !== "sh") return { code: 1, stdout: "", stderr: "not in this test" };
    const r = spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, HERDR_ORCHESTRATION_ROOT: root } });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
}
