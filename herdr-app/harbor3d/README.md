# Harbor 3D

A small Node server (no server dependencies) and a three.js page that show every Herdr run as a reef in a harbor.
Harbormaster writes a facts file; the server turns it into a *scene* and streams it to browsers over Server-Sent Events.

```
node herdr-app/harbor3d/bin/harbor3d.js              # private: http://127.0.0.1:4173/, real names
node herdr-app/harbor3d/bin/harbor3d.js share        # plus a shared listener behind cloudflared, pseudonyms only
node herdr-app/harbor3d/bin/harbor3d.js share --no-tunnel   # shared listener on 127.0.0.1 only (tests)
npm test            # in this folder: node --test test/*.test.mjs
```

Facts: `<runs root>/.harbor3d.json` (runs root: `$HERDR_ORCHESTRATION_ROOT` or `~/.herdr/hc-orchestration`). It counts as stale when
`at` is older than 45 s, so to develop against a fixture use
`jq '.at = (now*1000|floor)' test/fixtures/facts-basic.json > $ROOT/.harbor3d.json`.

## Security model

1. The browser only ever receives the scene, built field by field from an allow-list (`server/sanitize.js`). Nothing is spread or copied from the facts.
2. Every enum is checked and falls back to a safe default; labels are stripped of control characters and cut to 60.
3. Shared mode shows sea names only: no repo, PR number or agent name; ids are keyed hashes that change on every restart.
4. The shared listener serves only `/s/<128-bit token>/`, compares the token in constant time, and is the only thing the tunnel points at.
5. The private listener rejects any `Host` or POST `Origin` that is not localhost (DNS rebinding, cross-site POST).
6. Pokes carry only an enum `kind` and a scene id; the body is capped at 200 bytes; the broadcast is rebuilt from validated values; rate limits 1/s per viewer, 5/s in all (per listener). An accepted poke reaches the viewers of both listeners through one small hub in `server/app.js`; only that rebuilt `{kind, target, at}` crosses (scene ids are the same in both modes), never a label, and the shared listener holds no reference to private facts. `viewers` in the scene is the sum of both listeners' connections.
7. Static files: no `%`-escapes, no dotfiles or `..`, an extension allow-list, and a realpath check against symlink escapes.
8. The CSP forbids inline script and style; the page draws labels with `textContent`.
9. The server writes one file (`.harbor3d.want`) and runs one program (cloudflared, argv array); `test/security.test.mjs` scans the source for anything else.
10. Viewers are capped (20 shared, 8 private), the facts file is capped at 1 MB, and a bad file keeps the last good facts.
