# mission-api

The mission engine's only data boundary. One process per node (a ship or the shore), serving every mission in `mission-engine/scenarios/index.ts` (ATLAS SHIELD and STEEL TIDE).

- **Store.** Postgres tables for facts, decisions, peer decision logs, sync cursors and runtime state, scoped by mission (`migrations/`). The engine's in-memory logs are the working copy, and every append is written through. On start the chains are rebuilt from content and compared with what was stored, so a row edited in the database shows up as an integrity failure (`/api/health`).
- **Views** (`src/views/`).
  - `contract.ts` holds the shapes the web app draws. It is types only; the web app imports it.
  - `map.ts` projects engine results into those shapes without changing a number.
  - `lines.ts` builds explanation lines only from computed results.
  - `service.ts` computes pictures, analysis, what-ifs, the random slip and the audit view.
  - Everything is memoised on the content key of the picture (time, facts known then, decisions made by then).
  - Unbounded values travel as `"Infinity"` strings (`wire.ts`).
- **Writes.**
  - Manual facts are validated against the attribute registry, and a reason is required.
  - Decisions: approve, reject, withdraw, monitor, override, stop, resume, note. They are recorded in time order. Approvals go through the engine session, which refuses a lever past its act-by time, a lever that can't work as things stand, and anything while STOP is active.
- **Narrative** (`src/narrate.ts`). Optionally rewords the deterministic brief with an OpenAI-compatible model. The result is rejected unless every value in it already appears in the facts.
- **Live.** Server-sent events on `/api/stream`: facts, decisions, clock, link, sync, reset.
- **Sync** (`src/sync.ts`). Per mission. The ship pushes and pulls over the simulated data link, and the shore applies its sharing policy on every pull.
- **Watch clock.** One clock per mission. The web app moves it as the presenter plays or scrubs. Scripted reports are delivered as the clock passes them, each at the node where it would originate. Demo routes are off with `DEMO_MODE=0`.

```bash
npm install
npm run dev          # tsx watch, :8820, creates its database if missing
npm test             # against a real Postgres (PG_URL, default postgres://postgres:postgres@localhost:5432)
npm run build        # dist/server.mjs (engine bundled in)
```

The tests cover:

- both missions on one node, with the pinned ATLAS SHIELD numbers;
- the nonlinear-slip explanation;
- options, cliffs and the random slip;
- what-ifs never touching the logs;
- the decision rules;
- per-mission reload integrity with edited-row detection;
- the narrative faithfulness check;
- the STEEL TIDE DDIL thread end to end across a ship node and a shore node.

## Endpoints

`:mission` is `atlas-shield` or `steel-tide`. `at` is scenario hours, clamped to the mission clock: views can look back (what this node knew then) but not ahead.

| | |
|---|---|
| `GET /api/health` | database, both chains per mission, stored-row integrity, narrator configured |
| `GET /api/metrics` | Prometheus text |
| `GET /api/missions` | node, caller, missions served, sharing policy |
| `GET /api/stream` | server-sent events |
| `POST /api/link` | demo: drop or restore this node's data link |
| `POST /api/narrate` | optional reworded brief (falls back to the template) |
| `GET /api/m/:mission` | static mission view: display, phases, reports, tracks, places, legs |
| `GET/POST /api/m/:mission/clock` | mission clock; seek / play / pause / speed (demo) |
| `POST /api/m/:mission/reset` | demo: re-seed the mission on this node |
| `GET /api/m/:mission/snapshot?at=` | the picture: nodes, results (with and without planning assumptions), reports received and their impacts, levers, approvals, STOP, link |
| `GET /api/m/:mission/analysis/:cap?at=` | slack, cliffs, explanation lines, options (singles and synergistic pairs), Monte Carlo |
| `GET /api/m/:mission/nodes/:node?cap=&at=` | one input's slack and consequence curve |
| `POST /api/m/:mission/whatif` | `{ at, shifts }`: recompute with inputs slipped. Nothing is recorded |
| `GET /api/m/:mission/slip?seed=&at=` | random slip: one input upstream of a capability, and the delay it causes |
| `POST /api/m/:mission/decisions` | record a decision (attributed to the caller) |
| `POST /api/m/:mission/facts` | record a manual report |
| `GET /api/m/:mission/audit` | both chains as stored, for the browser to re-verify; peers' chains |
| `GET /api/m/:mission/audit/export` | canonical JSONL |
| `GET /api/fleet?active=`, `GET /api/fleet/catalog` | fleet lab picture under the chosen disruptions; its reference catalog |
| `POST /api/sync/push`, `GET /api/sync/pull` | shore side of sync (`?mission=`) |
| `GET /api/sync/status` | link, pending records, peers per mission |
