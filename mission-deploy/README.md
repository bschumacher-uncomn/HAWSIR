# Two-node stack: ship and shore

The HAWSIR stack has three parts, laid out side by side in the repo:

| Package | What it is | Talks to |
|---|---|---|
| `mission-engine/` | The deterministic engine, its domain packs and both missions. No I/O. | nothing |
| `mission-api/` | The only data boundary: Postgres-backed fact and decision logs, view models, live events, ship ⇄ shore sync, the watch clock. Runs the engine in-process. | Postgres, its peer node |
| web app (repo root) | The screens (React, deck.gl, three.js). Draws what the API computes. | its own node's API only |

```
 browser ──/api──▶ web (nginx) ──▶ mission-api ──▶ Postgres (this node's database)
                                     │  engine + packs run here, in-process
                                     └── sync (the ship dials the shore when its link is up)
```

## Run it

### Docker Compose

```bash
cd mission-deploy
docker compose up --build
# ship UI   http://localhost:8080   (Kittredge's own node)
# shore UI  http://localhost:8081   (fleet logistics / MOC)
```

This runs one Postgres container with a database per node (`mission_ship_ddgb`, `mission_shore`), two APIs and two web containers. Both nodes serve both missions. After pulling a schema change, run `docker compose down -v` once to start clean.

### Local, no containers

```bash
cd mission-api
PORT=8821 NODE_KIND=shore NODE_ID=shore INJECT_MODE=split DEMO_PEERS=http://localhost:8822 npm run dev
PORT=8822 NODE_KIND=ship NODE_SHIP=ddgB NODE_ID=ship-ddgb INJECT_MODE=split \
  PEER_URL=http://localhost:8821 DEMO_PEERS=http://localhost:8821 npm run dev
cd ..
HAWSIR_API=http://localhost:8822 npx vite --port 5312      # Kittredge's UI
HAWSIR_API=http://localhost:8821 npx vite --port 5311      # shore UI
```

## The STEEL TIDE demo (about six minutes)

Pick **CSG strike · STEEL TIDE** in the header on both UIs and open them side by side. The watch clock moves with the presenter: clock moves made on one node are forwarded to the other (the simulated data link does not carry them). See `../docs/SCENARIOS.md` for the whole story.

1. **Rewind to H-12.** On the Watch Floor, data health is already doing work:
   - Marlowe's fuel report is quarantined (142%).
   - Kittredge's DRRS-N strike assessment is 33 days old.
   - Port Harmon's TLAM load was never reported, so it shows UNK, not green.
2. **Play** (`Space`). At H-6 Kittredge's SATCOM modem fails and one of its two ETs goes sick in quarters. The player holds on each report and flashes its consequence. The ship's data link drops with it: the link control turns to DDIL.
3. **The ship decides on its own.** Kittredge's node recomputes locally and shows the strike **N**: without SATCOM the only launch-authority path is the Link-16 relay, and strike EMCON closes it at H-4. Pause, select STW, and read the five answers.
   - "Pre-brief launch authority before EMCON" recovers it. Act by H-4; approval by CSG-X.
   - Approve it with a note ("approved by HF voice"). It becomes a planning assumption, and nothing is ordered or recorded anywhere else.
4. **Meanwhile ashore.** The shore UI still shows the strike **Y**; it hasn't heard about the casualty. It has heard other things:
   - R-Supply and DLA disagree on the modem's ETA.
   - At H-2 the forward site (Port Alpha and its airfield) closes.
   - The part is re-routed to Atoll Bravo, outside CMV-22B range. The Theater shows the new route.
5. **Restore the link** (SATCOM button in the header). One sync each way: the ship sends its casualty, its sick-in-quarters report and its approval; the shore sends the closures and the new ETA. The shore now shows **N**, and shows Kittredge's approval in the Decision Log as the ship's own chain, verified and not applied.
6. **Time travel.** Scrub back on either UI. The picture shows exactly what that node knew then: the shore at H-3 didn't know about the casualty, even though it knows now.
7. **Record.** In the Decision Log, verify both chains in the browser, simulate a tamper, then restore from the node's copy. *Export* downloads the chains as JSONL.
8. **STOP.** In the top bar. Everything advisory is withdrawn on that node and approvals are blocked until someone resumes with a reason. The stop itself is on the chain.

`Shift+R` resets the mission on both nodes.

## How the nodes and databases are laid out

**Five ships do not mean five Postgres servers on a laptop.** In local development one Postgres server holds one database per node. Only ships whose own stack you want to demonstrate run as nodes (`SIM_SHIPS`, default Kittredge); every other ship's reports arrive ashore and reach the ship nodes over sync, which is how it would look from Kittredge anyway. Adding a ship node is one more database and one more API process (~60 MB).

**On real ships each ship runs its own stack** (API, web, Postgres) in its own cluster, because it has to keep working with no link. The shore runs the same stack.

**Sync is ship → shore → ship.** A ship never talks to another ship directly. When its link is up, the ship pushes what it has not sent (facts and its decision log) and pulls what the shore has that it has not seen. The shore decides what each ship receives: the sharing policy is a short list of withhold rules in `mission-api/src/sync.ts` (today: personnel availability goes only to that person's own ship). So yes, each ship holds a cached copy of the other ships' facts it is allowed to see, as of its last contact, and the shore scopes it.

What makes the merge safe:

- **Content ids.** A report has the same id on every node, so a fact both sides already hold is never duplicated and nothing is overwritten.
- **Receipt time.** A fact that arrives late is stamped with the receiving node's clock (`receivedAt`, part of that node's chain hash, not the content id). Reading "as of" uses it, so a node's history shows what that node actually knew.
- **Disagreements stay visible.** If both sides reported the same thing differently, the read is flagged *contradictory* and the worse value is used.
- **Decision logs are never merged.** The shore keeps a verified copy of each ship's chain beside its own and shows the ship's planning assumptions without applying them.

## Toward UDS / Zarf

The same stack ships as a Zarf package inside a UDS bundle (`zarf.yaml`, `uds-bundle.yaml`, `deploy/chart/hawsir`). See `../docs/DEPLOY.md`, which also lists every environment variable.

- **Images.** `Dockerfile` (web) and `mission-api/Dockerfile`, both built from the repo root.
- **Database.** One Postgres per node. The API needs only `DATABASE_URL`, runs its own migrations, and creates nothing outside its database.
- **Identity.** The UDS `Package` CR puts Authservice in front of the web app. With `TRUST_IDENTITY_HEADERS=1` the API reads the user from the forwarded ID token.
- **Ship ⇄ shore.** `PEER_URL` on the ship points at the shore API. `SYNC_TOKEN` is a shared secret today and should become mTLS through the mesh.
