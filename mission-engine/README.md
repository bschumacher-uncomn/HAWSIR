# Mission engine (HAWSIR / FleetHacker)

A deterministic, offline-first mission consequence engine. It reconciles governed facts about a group of ships (or aircraft), computes **when** each capability is available against **when** it is needed, finds the **controlling constraint**, separates **upstream slack** from **mission margin**, tracks **quantities over time** (fuel, missiles), shows what is **missing, stale, contradictory or malformed**, evaluates **bounded options** with their approval authority and act-by time, and records every **human decision** on a hash chain.

The same code runs in a browser, on a shipboard node, or on a server. It has no runtime dependencies and no I/O. With the link down, the only thing that degrades is the arrival of fresh facts.

All data in this folder is **synthetic** or cited public planning factors. It is not an authoritative system.

```bash
cd mission-engine
pnpm install        # or npm install
pnpm test           # 68 tests: engine, data plane, packs, both missions, fleet lab, failure cases
pnpm demo           # Operation STEEL TIDE walkthrough + airlift + the classic radar repair
pnpm typecheck
```

## How it works

```
facts (append-only, bitemporal, cited)          domain packs (naval, airlift, …)
        │  view as of t                                 │ attributes · factor tables · routines · builders · levers
        ▼                                               ▼
   ┌──────────── compile ────────────┐
   │  mission graph (typed nodes)    │ ◀── approved levers overlaid as planning assumptions
   └──────────────┬──────────────────┘
                  ▼
   compute: availability timelines · stock ledgers · requirement margins (Y/Q/N/UNK)
                  ▼
   analyse: controlling chain · slack vs margin · cliffs · options (singles + pairs) · Monte Carlo · risk
                  ▼
   advise: five answers per requirement · data health · trace (fact head, graph hash, routine versions)
                  ▼
   human: approve / reject / modify / override / STOP / resume  →  hash-chained decision log
```

**The graph has one job per node kind.** Availability nodes produce timelines (sets of intervals when something is available). Stocks produce piecewise-linear series. Scalars and routines produce the numbers that parameterize everything else.

| Kind | Produces | Meaning |
|---|---|---|
| `event` | timeline | Available from a time (missing time → conservative assumption, flagged) |
| `window` | timeline | Explicit intervals: EMCON lifts, hub open, relay in range |
| `person` | timeline | Available except during unavailability intervals |
| `task` | timeline | Starts when dependencies are up and k qualified crew can cover its duration |
| `gate` | timeline | Delivery through scheduled slots (COD flights, berths) with transit lag |
| `delay` | timeline | Transit: shifts availability by a lag (often a routine) |
| `all` / `any` / `kofn` | timeline | Intersection, earliest alternative, at least k of n |
| `stock` | series | Quantity over time: burns by segment, transfers in/out/top-off |
| `threshold` | timeline | Where a stock is at or above a line |
| `check` | timeline | A pass/fail routine (AMPLIFI-style checklist item) |
| `scalar` / `routine` | number | Values and leaf math with a contract |
| `requirement` | verdict | Needed over a window: Y/Q/N/UNK, lead/tail/stock margin, cause tree |

## What this answers for a watchstander (per requirement)

1. Is it up now?
2. Will it be up when needed?
3. What controls that? This is the leaf of the cause tree, plus the alternatives that came later.
4. How much margin? Time comes first. Quantity sits alongside, e.g. `fuel lowest 17.4% at H+19 vs 15% line (+2.4% ≈ 5h 43m of burn)`.
5. What are the bounded options? Each one shows status before and after, margin recovered, side effects, approval authority, act-by time, risk, and missing information.

## Folder layout

| Path | What |
|---|---|
| `src/core/` | Engine: intervals, ledger, graph types, compute, attribution, patches, analysis, options, risk, Monte Carlo, explanations, trends, hashing |
| `src/data/` | Data plane: fact store (append-only, bitemporal, scoped, quality flags, hash chain, merge) and decision log |
| `src/packs/` | Domain packs: `airlift/` (AMPLIFI's checklist logic), `naval/` (strike group, CLF, maintenance, C2) and `authored/` (a hand-written thread whose values are bound to facts) |
| `src/session.ts` | Ties it together: compile → overlay assumptions → compute → advise |
| `scenarios/` | Synthetic missions: ATLAS SHIELD (authored DDG 21-day thread), STEEL TIDE (naval strike group), REACH 417 (airlift); `fleet/` is the fleet lab (38 hulls, 12 missions); `display.ts` carries names, tracks and legs for the screens; `index.ts` is the mission registry mission-api serves |
| `demo/run.ts` | CLI walkthrough |
| `test/` | Vitest suite |
| `docs/DESIGN.md` | Semantics and design decisions in detail |
| `docs/DATA_SOURCES.md` | Every planning factor, its source, and its status (sourced / derived / synthetic / assumption) |

## Decisions this build implements

| Question (Engine Comparison doc) | Decision |
|---|---|
| Language/runtime | TypeScript, zero runtime deps, pure engine: identical on ship and shore |
| One engine or packs | General core plus domain packs (`naval` depends on `airlift` for the COD leg check). Each versions independently |
| Margin units | Time first; quantity margin shown beside it and converted to hours of burn at the low point |
| Monotonicity | Bisection only where every node on the path is monotone. Top-off and clipped stocks are flagged and scanned. Options are evaluated with the choice held fixed |
| Routines | Declarative structure in the graph; routines only for leaf math. Return contract (value/pass, units, binding, detail), declared monotonicity, attached tests. Source is stored, hashed and shown |
| Persistence | AMPLIFI's data-plane semantics (append-only, provenance, scope, as-of) in an in-process log with JSONL export/import and merge. `mission-api` writes it through to Postgres and replays it on start |
| Scope | Groups first. A single ship is a group of one |
| Data | Synthetic, built from cited factors; scenario values are marked synthetic |
| UI | `mission-api` (the only data boundary) serves the HAWSIR web app at the repo root; see `../README.md` |

## Relationship to the first prototype

This engine replaced the prototype's in-browser engine. It keeps the prototype's ideas:

- typed dependency nodes;
- the controlling-constraint walk;
- slack vs. margin by bisection;
- cliffs and quality flags;
- levers with an authority and a deadline;
- seeded Monte Carlo;
- hash-chained decisions.

It generalizes them where the research needed more:

- availability is a set of intervals, not one ready time, so systems can go down and come back, and EMCON and hub closures are first-class;
- stocks over time (fuel, VLS inventory) feed the same graph and margins;
- groups and k-of-n roll-ups are core, not a labs experiment;
- facts are governed and replayable as of any time (AMPLIFI's model);
- domain knowledge lives in packs with cited factor tables, not in scenario files.

The prototype's results are pinned on the new engine:

- **Classic regression** (part 1200, team 1400, 3 h repair, need 1800 → 1 h margin, team controls): `test/compute.test.ts`.
- **DDG 21-day story**, now ATLAS SHIELD (AMD Q, ready D-5 2200, 4d 10h, FC1 Martinez controls, expedite plus fly-away recovers a week): `test/atlas-shield.test.ts`.
- **Fleet lab** roll-ups and disruption flips: `test/fleet.test.ts`.

## Known limitations

- The MET → systems map, the extremis fuel floor, the SM reserve, UNREP time alongside, COD cruise speed and the C-17 numbers are **synthetic**. CASREP category meanings, UMMIPS cells and risk-matrix cells must be **verified** against NWP 1-03.1, NAVSUP P-485 and OPNAVINST 3500.39 (see `docs/DATA_SOURCES.md`).
- Stock-hours margin uses the burn rate just before the low point. It is a first-order measure, not a re-optimization of the replenishment schedule.
- Merge keeps everything and surfaces contradictions. There is no automatic conflict policy beyond "worse value wins". A fact merged late carries the receiving node's `receivedAt`, so reading as of an earlier time shows what that node knew then; the content id is unchanged, so the same report never duplicates.
- Fuel is modeled in % of capacity (GAO factors are % of load). Barrel-level CLF capacity planning is the next step (Brown & Carlyle).
- The engine evaluates option singles and pairs; larger combinations would need a search budget.
