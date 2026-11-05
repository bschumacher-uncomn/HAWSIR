# Deploying HAWSIR

Two images, one per tier, plus Postgres per node:

| Image | Built from | Runs as | Port |
|---|---|---|---|
| `hawsir-web` | `Dockerfile` (repo root) | nginx-unprivileged, uid 101 | 8080 (`/healthz`) |
| `hawsir-api` | `mission-api/Dockerfile` (repo-root context) | node, non-root | 8820 (`/api/health`, `/api/metrics`) |

Both images build from the repository root, because the web app imports the API's view contract and the API bundles the engine.

## Local development

```bash
pnpm install && npm --prefix mission-api install
pnpm dev            # mission-api on :8820 (creates database mission_solo), web on http://localhost:5310
```

A single local node receives every scripted report and serves both missions. For the two-node DDIL story locally, see `mission-deploy/README.md`.

## mission-api configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8820` | HTTP port |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/mission_<node>` | This node's database (created on first start unless `DB_CREATE=0`) |
| `NODE_KIND` | `ship` | `ship` or `shore` |
| `NODE_SHIP` | `ddgB` | Hull a ship node runs on |
| `NODE_ID` | `solo`, `shore` or `ship-<hull>` | Node identity in synced records |
| `PEER_URL` | unset | Ship only: the shore API reached over the data link |
| `DEMO_PEERS` | unset | Other nodes that receive demo-control commands (clock, link, reset) |
| `INJECT_MODE` | `all` (`split` with peers) | `split`: each scripted report arrives where it originates |
| `SIM_SHIPS` | `ddgB` | Ships running their own node (their reports do not arrive ashore directly) |
| `MISSIONS` | all | Comma-separated mission ids this node serves |
| `DEMO_MODE` | `1` | `0` = operational: mission clocks follow the wall clock and cannot be moved |
| `SYNC_TOKEN` | unset | Shared secret for `/api/sync/*` |
| `TRUST_IDENTITY_HEADERS` | `0` | `1` behind UDS Authservice: read the user from the mesh's ID token |
| `LLM_URL`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_TIMEOUT_MS` | unset | Optional OpenAI-compatible narrator. Unset = deterministic briefs |

The web image takes one variable, `API_UPSTREAM` (default `http://mission-api:8820`): the mission-api it proxies `/api` to.

## Docker Compose

```bash
cd mission-deploy && docker compose up --build
```

This starts a ship node and a shore node, each with its own API, web app and database on one Postgres server. After a schema change, `docker compose down -v` gives a clean start.

## Kubernetes (RKE2 + UDS Core)

```bash
helm install hawsir deploy/chart/hawsir -n hawsir --create-namespace \
  --set domain=uds.dev --set node.kind=ship --set node.ship=ddgB \
  --set node.peerUrl=https://hawsir-shore.example/      # omit for a standalone node
```

One release per node. The chart:

- runs `hawsir-web`, `hawsir-api` (one replica: a single writer per node database) and a Postgres StatefulSet with a generated password Secret. Set `postgres.enabled=false` with `postgres.externalUrlSecret` to use an existing database;
- emits a UDS `Package` CR that exposes the web app at `hawsir.<domain>` with Keycloak SSO via Authservice. It also allows intra-namespace traffic, ship → shore sync egress (ship) or sync ingress (shore), and a Prometheus monitor on `/api/metrics`;
- runs every container non-root with all capabilities dropped and a read-only root filesystem (emptyDirs where nginx and Postgres need to write);
- optionally renders the in-cluster vLLM narrator (`llm.inCluster.enabled=true`).

## Air-gapped (Zarf + UDS bundle)

```bash
zarf package create . --confirm
uds create . --confirm                                     # pier side, connected
uds deploy uds-bundle-hawsir-ship-amd64-0.11.0.tar.zst --confirm   # aboard
```

The bundle carries Zarf init, UDS Core and HAWSIR (web, API, Postgres images). The optional `narrator` component ships its model weights inside the package, so nothing is downloaded at sea. Zarf variables: `DOMAIN`, `NODE_KIND`, `NODE_SHIP`, `PEER_URL`, `DATA_STORAGE`.

## Compliance evidence

`compliance/oscal-component.yaml` is generated from the control list the Edge screen shows (`pnpm oscal`), so the two can't drift apart. CI fails if they differ. Lula validates three controls against a live cluster: pods non-root, namespace in the mesh, data volume bound.

## CI/CD

`.github/workflows/ci.yml`, mirrored in `.gitlab-ci.yml`:

1. AI review (advisory only; a human approves every merge).
2. Engine tests, mission-api tests against a Postgres service, then web typecheck, tests and build.
3. Semgrep.
4. Both images: SBOM (Syft), CVE gate (Grype), keyless signing (cosign).
5. On main and tags: deploy to UDS k3d and run Lula validation. Tags also produce the air-gap bundle.
