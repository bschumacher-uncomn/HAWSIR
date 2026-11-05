# Design notes

## 1. Time and availability

Time is hours from the scenario epoch. Every boolean question ("is the SATCOM terminal up at t?") is a **timeline**: sorted, disjoint, half-open intervals `[start, end)`. A system that works now, fails at a CASREP and is repaired later is `[[-∞, 54), [70.25, ∞)]`. Combinators are interval algebra:

- `all` = intersection
- `any` = union (the earliest alternative wins)
- `kofn` = times when at least k inputs are available (sweep line)
- `task` = starts at the earliest instant its dependencies are available and k qualified people can cover the whole duration; done at start + duration
- `gate` = depart in the first usable slot (or arrive within it) and deliver after the lag
- `delay` = shift by a lag

## 2. Requirements and margin

A requirement is needed over a window `[ws, we)`. Let `P` be the intersection of its dependencies.

- **Lead margin**: how late the capability could come up and still meet `ws`. If it is already up now, lead is ∞.
- **Tail margin**: how early it could be lost and still cover `we`.
- **Stock margin**: for every threshold in the requirement's cone, the low point inside the window is converted to hours of consumption (`(min − line) / burn rate just before the low point`). A ship that bottoms at 17.4% against a 15% floor while burning 0.417%/h has 5.7 h of margin, even though it never crosses the line.

`margin = min(lead, tail, stock)`. Status:

- `N` if margin < 0;
- `Q` if margin < `qMargin`, or if anything the requirement relies on is missing, assumed, stale, contradictory, malformed, or degraded;
- `UNK` if it never comes up because information is missing with no conservative assumption;
- otherwise `Y`.

"Relies on" means the controlling chain plus the **support set**: every dependency used during the window. At an `any`, only the alternative actually in use counts. An unused fallback with bad data does not taint the answer, but a stale fact that keeps a requirement green does.

## 3. Controlling constraint (attribution)

The binding edge (the rise at the lead, the fall at the tail, or the stock's low point) is explained by walking backwards. Each node kind knows which of its inputs produced its own edge:

- `all`: the inputs that rose last or fell first;
- `any`: the earliest alternative, with the others recorded as alternatives;
- `task`: the predecessor that rose at the start, or the crew member who was waited for, plus the duration;
- `gate`: the slot that was waited for, or the upstream plus the lag;
- `threshold`: consumption, plus the next replenishment that arrived too late (or sets the low point).

The leaves are the controlling constraints. Co-critical leaves are all reported. The tree, its leaves, and the "next limit" (the other edge) are part of every result.

## 4. Slack vs margin, monotonicity, cliffs

For each shiftable input (event time, task duration, hour-valued scalar, person return), the engine computes:

- `noImpact`: how far it can slip with no change to the target (upstream slack);
- `toFailure`: how far it can slip before the target is N.

Monotone means a worse input can only make the result worse or the same. When every node between the input and the target is monotone, there is one cutoff and bisection finds it to the minute. Stocks with top-off transfers or capacity clipping are flagged `non-monotone` (refuelling later refills you later), and the engine scans and then refines. Options are always evaluated with the choice held fixed, so each evaluation is itself monotone.

**Cliffs** are steps in the consequence curve where one more increment of slip costs much more than the slip. Missing a COD slot is the typical case: the part waits for the next one.

## 5. Options (levers)

A lever is a named set of **patches**: add, set, remove, add/remove dependency, shift, scale, slot, transfer. It also carries an approval authority, an act-by deadline, a cost, a declared risk (severity × probability), and any missing information. The engine evaluates singles and synergistic pairs. Pairs within an exclusive group (slip 6 h vs 12 h) and infeasible levers are never paired.

Each evaluation reports the status before and after, the margin recovered, any shift in control, and side effects on every other requirement. Categories that would issue orders, direct personnel, authorize maintenance, alter tasking or modify records are rejected at registration. Every lever's effect is `planning-assumption`.

## 6. Risk

`severity (I–IV) × probability (A–E) → EH/H/M/L → acceptance authority`. Probability comes from the Monte Carlo P(N ∪ UNK) when available, otherwise from status (N → Frequent, UNK → Likely, Q → Occasional, Y → Unlikely). Categories and levels follow the NWC Maritime Staff Reference Guide (pp. 36–37). The matrix cells, probability bands and authority table are configurable assumptions to be confirmed by the mission owner.

## 7. Uncertainty

Nodes may declare triangular uncertainty: a delay on times and durations, or a scale on burn rates. A seeded Monte Carlo (mulberry32) samples them through the same compute. Output per requirement: P(Y/Q/N/UNK), margin p5/p50/p95, how often each leaf controlled, and the criticality index per node. The same seed always gives the same futures.

## 8. Data plane

The data plane is AMPLIFI's value-graph semantics re-implemented for the edge:

- **Append-only**: facts are never edited; a newer fact supersedes. Content-addressed ids, hash-chained log, `verify()`.
- **Bitemporal**: `observedAt` (when true), `validFrom/To` (when a state or plan applies), `recordedAt` (when known). `view(asOf)` replays exactly what was known. The burn-down is just `evaluate(t)` for successive t.
- **Scoped**: `get(entity, attr, { scopes: ['mission:X', 'group:Y', 'global'] })`, most specific first (AMPLIFI DEC-015/019, generalized).
- **Quality on read**:
  - missing (pack default or conservative assumption, flagged);
  - stale (`maxAgeH`, e.g. DRRS-N 720 h);
  - contradictory (newest per source system; if they disagree inside `conflictWindowH`, the worse value wins and the alternatives are kept);
  - malformed (fails validation; stored and quarantined, raw kept, previous valid value used).
- **Absent means none**: for event-like attributes (CASREP, unavailability, EMCON), no fact means nothing to report, not missing.
- **Merge**: a ship log and a shore log union by content id. Nothing is overwritten. Keys that now disagree are reported as contested.

## 9. Decisions

Decisions are hash-chained entries: approve (stores the exact patches), reject, modify (stores the modified patches), withdraw, monitor, override (a human status shown beside the engine's), STOP and resume.

- Rejections, modifications, overrides and STOP require a note.
- STOP suspends advisory output and blocks approvals.
- Each entry records its basis: fact-log head, graph hash and result hash.
- An edge copy can restore a tampered entry.

## 10. Packs

A pack provides:

- `attributes` (fact schema, staleness, worse-direction);
- `tables` (cited factors);
- `routines` (leaf math with contract and tests);
- `build(model, ctx)` → graph, levers, focus requirements, health findings, authority table.

Packs depend on other packs explicitly: `naval` imports `airlift`'s `legWithinRange` to check a CMV-22B COD leg. Changing the core, the naval pack or the airlift pack are independent, versioned changes. Results record pack and routine versions.

### Routine contract

```ts
{ value?: number | null, passed?: boolean, margin?: number, unit?: string, binding?: string[], detail: string, extrapolated?: boolean }
```

Inputs declare type, unit and monotonicity. `RoutineRegistry.verify()` runs the attached tests and property-checks every declared monotonicity around each test point. Unverified routines flag the nodes that use them. A routine's version is the hash of its source and declaration. The source text is stored for display and audit.

## 11. Writing a new pack (outline)

1. Declare attributes for every fact the domain reports.
2. Put planning factors in `FactorTable`s with citations and status.
3. Write leaf routines with tests and monotonicity declarations.
4. Write `build()`:
   - structure from the model;
   - every changing value from `ctx.view`;
   - provenance on every node built from a fact;
   - requirements with severity;
   - levers as patches with authority and deadline.
5. Add a scenario and tests that pin the story (controlling constraint, margins, option outcomes).
