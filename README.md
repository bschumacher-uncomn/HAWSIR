# NAVIFI · Fleet Mission Consequence Engine

**Know before it breaks the mission.** When a part slips, a sailor goes on leave, or a record arrives malformed, NAVIFI tells the watch team in milliseconds what that does to each mission capability, what actually controls the outcome, how sure the answer is, and which bounded options would recover it. A human decides. Every decision is hash-chained.

FleetHacker Norfolk 2026 · synthetic data only · not an authoritative system.

```bash
pnpm install && pnpm dev     # http://localhost:5310
```

## What it does

- **Five answers on one screen**: is the capability up now, will it be up when needed, what controls that, how much margin is left, and what are the bounded options.
- **Controlling constraint, not just a status**: walks the dependency graph back to the one input, person, delivery window or task that sets the time.
- **Upstream slack vs. mission margin**: a part with 2 h slack can slip 2 h with zero consequence; a team with 0 slack cannot slip 1 minute.
- **Nonlinear consequences**: a 2-day parts slip that misses the sail date costs 9+ days because the next delivery window is Rota.
- **Visible uncertainty**: missing, stale, contradictory and malformed data are flagged on the chain that matters; Monte Carlo shows the spread.
- **Human in control**: approve, reject or modify with a note; STOP halts all advisory output; nothing writes to authoritative systems.
- **DDIL-ready**: the engine runs on the ship with the link down; the audit chain stores and forwards.
- **Deterministic first**: the LLM only rewrites calculated facts into plain language, and the answer is identical with it off.

## Screens

| Screen | Shows |
|---|---|
| Fleet Picture | 3D globe: 38 hulls, 12 multi-ship missions, 150 packages with slack, fleet-wide what-if disruptions, drill-down to a hull |
| Watch Floor | 3D ship status, five answers, capability stack, change stream, bounded options |
| Consequence Graph | Live dependency graph, critical chain, slack per input, consequence curve, what-if slider |
| Readiness Horizon | 21-day timeline, margin burn-down, act-by deadlines, data health |
| Simulation | 2,000 seeded futures: S-curves, margin histogram, tornado, criticality |
| Theater | Offline map: track, movement legs into Rota, delivery options, SPY coverage |
| Decision Log | Hash-chain verify, tamper demo and edge-copy restore, decisions |
| Evidence | Live failure-case matrix, judge challenge stopwatch, baseline vs assisted, 30/60/90 |
| Edge Platform | RHEL 9 → RKE2 → UDS Core stack (live), AI-assisted CI/CD, DDIL, OSCAL, fleet rollout |

Keyboard: `1`–`9` switch screens (`1` is the Fleet Picture at `/fleet`), `Space` play/pause the change stream, `Shift+R` reset the session (clears approvals, what-ifs and the local log; the edge copy is kept), `T` attract mode.

Attract mode (`T`, or open `http://localhost:5310/?noboot&tour` on a booth monitor) resets the session, opens on the spinning fleet globe, runs an AMC stand-down what-if, replays the change stream on the Watch Floor, then cycles every screen with a caption. Any key or click hands the watch back.

## Three-minute demo

Before each run, open `http://localhost:5310/?reset` (or press `Shift+R`) so earlier rehearsal approvals don't carry over.

0. **Fleet Picture (0:00).** Press `1`. "Thirty-eight hulls, twelve missions, a hundred and fifty parts, people and data packages, all synthetic. Every arc is timed by the engine: slack before it breaks its mission." Toggle **AMC airlift stand-down**: five missions flip to NOT READY in a fraction of a second. Click **CSG-14**: "Controlled by CVN-85. Its F414 engines now only make the third COD run." Toggle **Suez closed** instead and point at PROSPERITY GUARD: "holds, because redundancy absorbs DDG-181." Click **DDG-170 → Open watch floor**.
1. **Watch Floor (0:30).** "D-14 before tasking. AMD is qualified, ready D-5 2200 with 4 days 10 hours of margin, and FC1 Martinez controls it." Replay the change stream: the CASREP lands and the ship lights up; the CFA slips 2d 3h and AMD margin drops 9d 18h. "That is the nonlinear part: it missed the sail date, so the Rota window controls."
2. **Consequence Graph (1:10).** Click Martinez. "Zero slack: any slip is mission slip. The CFA now has slack to spare." Drag the what-if slider past the cliff.
3. **Options (1:35).** Back on the Watch Floor: expedite alone recovers nothing; expedite plus the MARMC fly-away team recovers 7d 16h. Approve with a note. "Planning assumption, not an order."
4. **Simulation (1:55).** "2,000 futures. About one in eight leaves no delivery window at all. Same seed, same answer."
5. **Edge Platform (2:15).** Flip to EMCON. Everything still works. "One Zarf bundle, RHEL and RKE2, UDS Core, AI review with a human gate."
6. **Decision Log (2:35).** Verify the chain, simulate a tamper, restore from the edge copy. "Who decided what, on which facts, provably."
7. **Evidence (2:50).** "Twelve failure cases, run live. Judges: pick any input and time it."

**If asked about scale:** the Fleet Picture is the answer at fleet level (38 hulls, one engine, recomputed in about 150 ms in the browser). For a second deep workflow, pick **VLS reload · 72h** in the header. Different hull (DDG-173), port, and workflow, but the same engine and screens. A 12-hour C-17 slip costs 17 hours of margin because the ordnance misses Marathi berth slot A. Then the chief who supervises ordnance handling goes on light duty and takes control (AMD −2h). Chartering the airlift alone recovers nothing; adding a cross-decked supervisor from CG-176 recovers 15 hours.

## Engineering

- 27 tests (`pnpm test`): 19 on the deterministic engine and 8 on the fleet roll-up (every disruption story is pinned). The engine tests include the classic example: part 1200, team 1400, 3 h repair, required 1800 → ready 1700 with 1 h margin; part to 1330 has no consequence; team to 1600 misses by 1 h.
- Fleet roll-up (`src/features/fleet`): each synthetic hull's issues become an engine graph; a mission needs k of n hulls per capability (a hull counts only if it can also get underway); package slack comes from the same bisection `slackFor` as the watch floor. DDG-170 and DDG-173 are driven by their full scenarios.
- Three workflows on the same engine, switchable from the header (or `?scenario=`): `ddg21` DDG readiness 21 days to tasking, `reload72` VLS reload at Souda Bay 72 hours to station, and `classic` the five-input radar repair.
- [Architecture](docs/ARCHITECTURE.md) · [Deploy](docs/DEPLOY.md)
- Container: UBI9 or Iron Bank base, non-root, health-checked. Helm chart with a UDS Package CR. Zarf package and UDS bundle for air-gapped hulls. OSCAL component definition with Lula validations.
