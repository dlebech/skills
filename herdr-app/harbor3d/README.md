# Harbor 3D

A page in your browser that shows Herdr runs as a working port. Each run is a berth: a cargo ship moored at a finger pier, a gantry crane and a signal mast. Its tasks are containers, its orchestrator is an octopus in the water off the pier, and its agents are crabs on the pier. It is for watching and showing. It reads the same facts as Harbormaster's Crew (the path to merge, what needs you, the tasks and agents), so the two agree.

It is a small Node server with no server dependencies and a three.js page. It lives apart from the Harbormaster mod because a mod cannot draw WebGL. It needs Node 22+ and a browser with WebGL. Harbormaster does not start or install it; you run it by hand from this folder.

## Run it

```sh
npm install                     # once: fetches three.js
node bin/harbor3d.js            # private page, real names
```

It prints `Harbor 3D: http://127.0.0.1:4173/` (port 4173, or the next free one; `--port` chooses). Open that address. The private page only answers requests for `127.0.0.1` or `localhost`.

Harbormaster has to be open in Herdr. The server touches `.harbor3d.want` in the runs root every 20 seconds (the runs root is `$HERDR_ORCHESTRATION_ROOT`, or `~/.herdr/hc-orchestration`). A Harbormaster view that is polling sees that file is less than a minute old and writes the facts file `.harbor3d.json` beside it, whenever the facts change and at least every 15 seconds. Without the want file Harbormaster writes nothing. If no facts arrive, or they are older than 45 seconds, the page shows fog and a banner.

Stop it with Ctrl-C, or `hc kill` if you started it with `hc run`. Nothing else depends on it.

To develop against a fixture:

```sh
jq '.at = (now*1000|floor)' test/fixtures/facts-basic.json > $ROOT/.harbor3d.json
npm test                        # node --test test/*.test.mjs
```

## What things mean

| Run fact | In the scene |
| --- | --- |
| Run | A berth: a finger pier with a cargo ship moored at it, a gantry crane and a signal mast |
| Tasks | Containers. Planned: grey, in the berth's yard on the quay. Implementing, in review or being fixed: on the pier beside the crane, in the stage's colour. Blocked: on the pier, red, tilted. Done: loaded on the ship's deck, in cargo colours, each in its own slot. When more tasks are done than the deck holds (24), a small flag sits on the last slot and the card says `+n more` |
| Orchestrator | The octopus, the foreman: it floats just off the pier's tip, head and eyes above the surface, and sleeps when the run is finished |
| Workers | Crabs on the pier (eight at most are drawn) |
| PRs | Signal flags on the ship's mast: open, draft, merged, closed, red when their checks fail |
| Needs you | The signal mast blinks red, a red beacon pulses above the crane, a red ring pulses on the water round the octopus, and the octopus waves. All its crabs stop and face the camera side with it |
| Working or waiting | The signal mast is green while anything works (agents or CI), amber when the run waits or idles, dark when it is parked |
| CI running | The ship's funnel puffs smoke |
| An agent at work on a task | The crane's trolley and hook move |
| Finished | The ship's lights are on |
| Every PR merged | The ship casts off and lies in the fairway; its octopus waves it off for 3 seconds, once |
| Parked | The ship lies at anchor outside the breakwater, in haze, with no crew |
| Tokens | The ship's size: S under 10M, M under 50M, L under 150M, else XL |
| Captain | A tug that patrols the basin while the captain watches, moored and dim when no captain runs |
| Agents outside any run | Crabs on driftwood rafts inside the breakwater |
| Viewers | Gulls circling the harbor office's radar |
| Facts out of date | Fog over the harbor and a banner |

### The octopus directs its crabs

- **Working.** While the orchestrator works, one tentacle beats slowly (every 2.4 s) and the working crabs walk in step with it: they turn round when the tentacle reaches the end of its stroke.
- **Roll call.** When a worker joins or leaves, or a task changes stage, the octopus points at the pier for 1.5 s. The crabs stop, turn to face it, and go back to work.
- **Waiting on it.** Crabs that are idle or done while the run is not finished gather at the pier's tip, facing the octopus.
- **Needs you.** All the crabs stop and face the camera side with the waving octopus.
- **Blocked crab.** The octopus leans and looks towards it; the crab hops.
- **Task done.** The octopus claps two tentacles once and each crab does one small hop, 80 ms after the one before.

### Small touches

The octopus blinks every 3 to 6 seconds and turns its head slowly to keep looking at your camera, within 50° of where it started. A fish jumps somewhere in the basin every 20 to 40 seconds. Gulls land on a crane top or the office roof for 10 to 20 seconds between flights. At night the office windows and the ships' lights flicker on one by one. With `prefers-reduced-motion` all of this stays still; state changes (a wave, a hop) still show. There is no sound.

### Looking around

The sky follows the time of day on your computer, with an Auto, Day and Night toggle. Orbit and zoom, click a berth to fly to it and read its card (the same facts as text), or start a slow tour for screen sharing. None of that sends the server anything. `?stats=1` shows frame time and which transport the page uses.

## Share it

```sh
node bin/harbor3d.js share [--minutes 60]
```

This starts a second listener for colleagues and points a `cloudflared tunnel --url` (a quick tunnel, no account; `cloudflared` must be installed) at that listener only. The private page is never tunnelled. It prints a link with a 128-bit random token, `https://<random>.trycloudflare.com/s/<token>/`; everything outside that path answers 404 with nothing in it. Anyone with the link can look, so send it only to people you would show the screen to.

Sharing stops after the time limit (60 minutes unless `--minutes` says otherwise), when `cloudflared` exits, or on Ctrl-C. After the time limit the private page keeps running. `share --no-tunnel` opens the shared listener on `127.0.0.1` only, for tests.

At most 20 people can watch the shared page and 8 the private one. A viewer on the live stream and one long-polling count alike, and the gull count includes both. The page uses a live event stream; where a proxy holds streams back, as Cloudflare quick tunnels do, it falls back to long-polling (`GET poll?after=<n>`) after four seconds. The server compresses the page and models with gzip when the browser accepts it.

**What a shared viewer sees.** Each run is a made-up sea name (Kelp Reef, Gull Rock, Coral Shelf…) chosen by a keyed hash of the run, so it stays the same while the server runs and changes when it restarts. The order of the ships is the same for every viewer: the server gives each run a berth slot (and each parked ship and adrift agent its place) and keeps it while the run stays in the facts; a new run takes the lowest free slot. A server restart may change the order. Everything else is the shape of the run: its type (feature, fix, review, explore), whether it is planning, running, finished or parked, whether it needs you and the kind of need, the path-to-merge stages and their states, each task's stage, each PR's state and checks (not its number), whether CI runs, each agent's state and kind, counts, the ship's size bucket, the run's age to the nearest five minutes, the captain's state and how many people are viewing.

**What they never see.** No repository, issue or PR number, branch, run name, topic, folder, machine, agent or terminal name, token count, URL, progress line, question, decision, claim, PR title, or any other text an agent or you wrote. The server builds each run field by field from an allow-list, an unknown value becomes a safe default instead of passing through, and identifiers are keyed hashes that differ after every restart. A unit test feeds the server runs full of marker strings and asserts that none appears in anything the shared listener sends. Only the private page shows names, repository, PR numbers and agent names.

## What viewers can do

Two pokes, shown to every viewer of both pages:

- **wave**: the octopus or crab that was clicked waves for 2 seconds. Clicking an octopus pets it: on the page that clicked, three small bubbles rise from it, and the click selects its berth if it is not the selected one (a berth that is already selected never moves the camera). A crab lifts both claws. It works by touch. Clicking the tug waves at the captain (`target: "captain"`, only while a captain runs, i.e. the tug is not moored and dim): he rises through the afterdeck, turns to the camera, waves four times and goes back down, and the tug's lamp blinks twice; every viewer sees it, and with reduced motion he just appears and disappears. Clicking the tug neither selects anything nor moves the camera.
- **feed**: the gulls dive to the water.

A poke is a `POST /poke` with a `kind` of `wave` or `feed`. `feed` takes the target `harbor` only; `wave` takes an octopus, crab or adrift id from the current scene (a run's own id is refused), or `captain` while the scene's captain state is not `none`. Anything else, a `horn` or `fireworks` included, is refused with 400. A viewer gets one poke per second and each page five per second in all (over that, 429, and the page just skips the wave). A body over 200 bytes is refused. A poke is a visual event and nothing more.

**Why none of this can reach an agent.** The server accepts no text from a viewer: from a request it reads only the poke's enum and a scene id, and it rebuilds the event from values it checked itself. It writes one file, `.harbor3d.want` in the runs root, a fixed path. It writes nothing into a run directory and calls no `hc` command, so it cannot send keys or messages to a terminal. The only program it starts is `cloudflared`, with a fixed argument list. Labels are drawn as text, never as HTML, and the page's content security policy forbids inline script. `test/security.test.mjs` scans the server's source for any file write other than the want file, any process start other than `cloudflared` and any `hc` call; `test/dom-sinks.test.mjs` scans the page for ways to turn text into markup.

## Security model

1. The browser only ever receives the scene, built field by field from an allow-list (`server/sanitize.js`). Nothing is spread or copied from the facts.
2. Every enum is checked and falls back to a safe default; labels are stripped of control characters and cut to 60.
3. Shared mode shows sea names only: no repo, PR number or agent name; ids are keyed hashes that change on every restart.
4. The shared listener serves only `/s/<128-bit token>/`, compares the token in constant time, and is the only thing the tunnel points at.
5. The private listener rejects any `Host` or POST `Origin` that is not localhost (DNS rebinding, cross-site POST).
6. Pokes carry only an enum `kind` and a scene id; the body is capped at 200 bytes; the broadcast is rebuilt from validated values; rate limits are 1/s per viewer and 5/s in all, per listener. An accepted poke reaches the viewers of both listeners through one small hub in `server/app.js`; only the rebuilt `{kind, target, at}` crosses, never a label. A polling viewer is identified by its `x-viewer` header; it may hold one poll and start two per second.
7. Static files: no `%`-escapes, no dotfiles or `..`, an extension allow-list, and a realpath check against symlink escapes.
8. The CSP forbids inline script and style; the page draws labels with `textContent`.
9. The server writes one file (`.harbor3d.want`) and runs one program (cloudflared, argv array).
10. Viewers are capped (20 shared, 8 private), the facts file is capped at 1 MB, and a bad file keeps the last good facts.

## Where the data comes from

The facts are built by Harbormaster from what the Crew already knows, through tables that give every enum a default, so the server never reads a run folder or calls `gh`. The server reads `.harbor3d.json` every couple of seconds, turns it into a scene (`server/sanitize.js`) and sends it over the event stream or long-polling. A scene whose facts are more than 45 seconds old is shown in fog.

## Rebuild the models

The ship, crane, containers and the rest are built in Blender 5.3 by Python scripts, headless, exported as `.glb` and committed in `models/out/`, so neither the page nor the server needs Blender. To rebuild them all:

```sh
blender -b --factory-startup -P models/build.py
```

Name models after `--` to build just those. The script checks each model's triangle count, file size (100 kB each) and materials, and fails when one is over. `models/README.md` has the conventions. A container is 1.1 wide and 2.4 long (along Z); the slots in `public/assets/layout.js` lay it out along the pier and the ship, and `containerBoxes` there returns every container's box so a test can check that none touch.
