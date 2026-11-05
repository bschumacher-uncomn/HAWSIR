# HAWSIR · Mission Consequence Engine

**Know before it breaks the mission.** When a part slips, a sailor goes on leave, a radio fails or a record arrives malformed, HAWSIR tells the watch team what that does to each mission capability. It shows what actually controls the outcome, how sure the answer is, and which bounded options would recover it. A human decides, and every report and decision is hash-chained.

FleetHacker Norfolk 2026 · synthetic, unclassified data only · not an authoritative system. The product name lives in [`brand.json`](brand.json); the UI, the API and the CI read it from there.

## Run it

```bash
# containers: ship node + shore node, each with its own API, web app and database
cd mission-deploy && docker compose up --build
#   ship UI  http://localhost:8080      shore UI  http://localhost:8081

# or locally (Node 22, a reachable Postgres 16)
pnpm install && npm --prefix mission-api install
pnpm dev                                   # mission-api :8820 + web :5310
```

## How it fits together

```
 browser ──/api──▶ web (nginx, static) ──▶ mission-api ──▶ Postgres (this node's logs)
                                              │  mission-engine runs here, in-process
                                              └── sync: the ship dials the shore when its link is up
```

| Package | What it is |
|---|---|
| [`mission-engine/`](mission-engine/README.md) | The deterministic engine: availability timelines, stocks, controlling-constraint attribution, slack, cliffs, bounded options, seeded Monte Carlo. Domain packs (naval, authored threads, airlift). Both missions and the fleet lab live in `scenarios/`. No I/O. |
| [`mission-api/`](mission-api/README.md) | The only door to the data. It keeps a bitemporal fact log and a decision log in Postgres, both hash-chained and re-verified on load. It also serves the view models the screens draw, live events (SSE), ship ⇄ shore sync and the demo clock. |
| `src/` (this package) | The web app: React, deck.gl, three.js. It fetches pictures from mission-api and computes nothing itself; it only re-checks hash chains in the browser. |
| [`mission-deploy/`](mission-deploy/README.md) | Docker Compose for the two-node stack. |
| `deploy/`, `zarf.yaml`, `uds-bundle.yaml` | Helm chart (web, mission-api, Postgres, optional narrator) with a UDS Package CR; Zarf package and UDS bundle for air-gapped hulls. |

## The two missions

Pick one in the header. [docs/SCENARIOS.md](docs/SCENARIOS.md) walks through each report and what the engine does with it.

- **ATLAS SHIELD · DDG readiness, 21 days to tasking.** One destroyer. A radar part slips past the sail date, so the next delivery is Rota. Two technicians leave, and the one who rejoins last controls air and missile defense: Q, ready D-5 2200, 4d 10h of margin. Expediting the part alone recovers nothing; expediting it and bringing in a fly-away tech team recovers a week.
- **STEEL TIDE · carrier strike group TLAM strike.** Five ships. Kittredge's SATCOM fails six hours before H, and strike EMCON closes the only other launch-authority path. The ship's data link drops too, so the ship knows and the shore does not, until the link comes back.

## Screens

| Screen | Shows |
|---|---|
| Watch Floor | 3D digital twin, capability stack, the five answers (what changed, what it affects, what controls readiness, margin and certainty, bounded options), change stream |
| Mission Thread | The dependency graph as an executable swimlane thread. It shows waits, handoffs and the critical chain against the plan of record, a status board vs. thread verdict, and options. |
| Consequence Graph | Live graph, critical chain, slack per input, consequence curve, what-if slider (sandbox only) |
| Theater | Offline vector map. Every ship's track moves at once, with parts, people and aircraft legs into the delivery windows they have to hit. |
| Fleet Lab | 38 synthetic hulls, 12 missions, ~150 packages, all computed by the engine on the node. Toggle fleet disruptions (AMC stand-down, Suez, typhoon, DLA backlog, NSIPS outage, SATCOM). **Random slip** slips one input and reports the delay to the capability. |
| Decision Log | Decision and report chains from the node, re-verified in the browser, with a tamper demo that restores from the node's copy. Also shows peers' chains and the store-and-forward queue. |
| Edge Platform | How it deploys: RHEL 9 → RKE2 → UDS Core, CI/CD with a human gate, DDIL behaviour, OSCAL |

Keyboard: `1`–`7` switch screens, `Space` play/pause (pressing play at the end replays from the start), `Shift+R` reset the mission on this node, `T` attract mode. URL options: `?scenario=steel-tide`, `?noboot`, `?t=<hours>`.

## Principles the code enforces

- **Deterministic first.** Every number comes from the engine; the same facts give the same answer. An optional local language model may reword the brief. mission-api rejects the rewording if it contains any time, duration or number that the engine didn't write (`mission-api/src/narrate.ts`).
- **Human authority.** Options are planning assumptions with an approval authority and an act-by time. Approve, reject and withdraw all need the right notes. STOP halts advisory output, and resuming needs a reason. Lever categories that would issue orders or modify records are refused by the engine (`PROHIBITED_CATEGORIES`).
- **Honest uncertainty.**
  - Missing, stale, contradictory and malformed data are flagged on the chain that matters.
  - A missing input makes a capability UNK, never green.
  - Margins are never shown as infinity. "≥ 8d 0h" means nothing in the horizon limits the capability; "NEVER" means there is no path to it.
- **Tamper-evident record.**
  - Facts are content-addressed, so the same report has the same id on every node.
  - Both logs are SHA-256 chains, re-verified from the stored rows on load, by the browser, and by peers.
  - Reading "as of" a time shows only what this node knew then.
- **DDIL.** Each node computes on what it holds. Sync merges by content id and never overwrites. The shore withholds other ships' personnel records (`SHARE_POLICY`).

## Engineering

```bash
npm --prefix mission-engine test     # 68 tests: engine, both missions, fleet lab
npm --prefix mission-api test        # 13 tests against a real Postgres (PG_URL)
pnpm typecheck && pnpm test          # web app
```

[Architecture](docs/ARCHITECTURE.md) · [Deploy](docs/DEPLOY.md) · [Scenarios](docs/SCENARIOS.md)
