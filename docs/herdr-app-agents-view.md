# Captain and orchestrators at the top of Herdr's Agents list

> For more (progress on each card, a runs overview with PRs, and two layouts), run `herdr-app/install.sh` instead; see [herdr-app-runs-view.md](herdr-app-runs-view.md). It includes everything below.

The `herdr-app-*` skills label their agents: the captain's terminal carries `role=captain`, and every orchestrator's carries `role=orchestrator`. Herdr's own Agents list does not read those labels. These steps make a copy of it that does, and that shows:

- **⚓ Captain** first,
- then **🐙 Orchestrators** from every space, each row naming its repository's space, with its workers nested underneath,
- then your pinned agents and everything else, as before.

The copy is yours: Herdr never updates it, and the skills work the same with or without it. Tested with Herdr 0.1.12. On a newer Herdr whose `mods/agents/main.js` no longer matches step 2, give an agent in the app the prompt at the end instead.

## Steps

Run these from any terminal in the Herdr app. Paths are under the app's home, `~/.config/herdr-app` unless `HERDR_APP_HOME` says otherwise.

1. Copy Herdr's Agents list and main layout. Copying the layout also switches to it.

   ```sh
   herdr-app do mod.clone '{"name":"agents","as":"agents-runs"}'
   herdr-app do layout.clone '{"name":"main","as":"main-runs"}'
   ```

2. In `mods/agents-runs/main.js`, make three replacements.

   Replace

   ```js
       const pinned = list.filter((a) => a.pinned);
       const rest = list.filter((a) => !a.pinned);
       list = [...pinned, ...rest];
   ```

   with

   ```js
       // Runs: the captain first, then every orchestrator from any space, by their role labels.
       const role = new Map(all.map((k) => [k.address, k.labels?.role]));
       const captains = list.filter((a) => role.get(a.address) === "captain");
       const orchestrators = list.filter((a) => role.get(a.address) === "orchestrator");
       const roled = new Set([...captains, ...orchestrators].map((a) => a.address));
       const pinned = list.filter((a) => a.pinned && !roled.has(a.address));
       const rest = list.filter((a) => !a.pinned && !roled.has(a.address));
       list = [...captains, ...orchestrators, ...pinned, ...rest];
   ```

   Replace

   ```js
         const full = byPriority || isPinned;
   ```

   with

   ```js
         const full = byPriority || isPinned || roled.has(a.address);
   ```

   Replace

   ```js
       const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
   ```

   with

   ```js
       const groups = [
         { id: "captain", label: "⚓ Captain", status: null, members: captains },
         { id: "orchestrators", label: "\u{1F419} Orchestrators", status: null, members: orchestrators },
         { id: "pinned", label: "Pinned", status: null, members: pinned },
       ].filter((g) => g.members.length);
   ```

3. In `layouts/main-runs.json`, change the Agents block's `"mod": "agents"` to `"mod": "agents-runs"`. It occurs once.

4. Check the mod. The window picks up both files within a second.

   ```sh
   herdr-app check ~/.config/herdr-app/mods/agents-runs
   ```

To see it without a run going, label any agent's terminal for a moment: `hc label <terminal> role=captain`, then `hc label <terminal> role=` to remove it.

To go back to Herdr's own list: `herdr-app do layout.switch '{"name":"main"}'`. Delete `mods/agents-runs` and `layouts/main-runs.json` to remove the copy.

## Other run facts

Orchestrators also label their terminals with:

- `run.status`: `running`, `waiting`, `blocked`, or `finished`;
- `progress`: one line on what the run is doing, such as `task 3/7 in review`;
- `run.prs`: the run's PR URLs, space-separated, once there are any.

Labels end with the terminal. The same facts, plus merged and planned tasks, issues, and waiting agents, stay in `status.json` in the run directory under `~/.herdr/hc-orchestration/`. To show any of them, ask an agent in the app to change your copy, as in the [README](../README.md#install)'s example.

## Prompt for a newer Herdr

> Clone the `agents` mod as `agents-runs` and the `main` layout as `main-runs`, and point the layout's Agents block at `agents-runs`. In the mod, read each terminal's `role` label from `terminals()`. Show agents with `role=captain` in a group "⚓ Captain" at the very top, then agents with `role=orchestrator` from every space in a group "🐙 Orchestrators", each row naming its space the way pinned rows do and keeping its sub-agents nested under it. Then pinned agents and the rest, unchanged. Run `herdr-app check` on the mod when done.
