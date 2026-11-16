#!/usr/bin/env bash
# Fails when the tier table in skills/proving/SKILL.md and TIER_TEXT in
# herdr-app/mods/harbormaster/proof.js differ (plain bash + node, no app).
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
want=$(node -e '
const fs = require("fs");
const rows = fs.readFileSync("skills/proving/SKILL.md", "utf8").split("\n").map((l) => /^\| T(\\d+) \| (.*) \|\s*$/.exec(l)).filter(Boolean);
if (rows.length !== 4) { console.error("SKILL.md: expected 4 tier rows, got " + rows.length); process.exit(1); }
console.log(JSON.stringify(rows.map((m) => m[2])));')
got=$(node --input-type=module -e '
import { TIER_TEXT, tierTip } from "./herdr-app/mods/harbormaster/proof.js";
if (tierTip(2) !== "T2: " + TIER_TEXT[2]) { console.error("tierTip(2) wrong: " + tierTip(2)); process.exit(1); }
console.log(JSON.stringify(TIER_TEXT));')
if [ "$want" != "$got" ]; then
  echo "FAIL: tier texts differ" >&2; echo "SKILL.md: $want" >&2; echo "proof.js: $got" >&2; exit 1
fi
echo "pass: 4 tier texts match (SKILL.md = proof.js)"
