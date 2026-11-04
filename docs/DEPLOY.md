# Deploying NAVIFI

## Local development

```bash
pnpm install
pnpm dev            # web on :5310 (proxies /api), edge node on :8810
pnpm test           # engine tests
pnpm typecheck
```

Open http://localhost:5310. Append `?noboot` to skip the boot sequence, `?t=<hours>` to jump the watch clock, `?cap=c_amd` to select a capability.

## Production build (single process)

```bash
pnpm build          # dist/ (UI) + dist-server/index.mjs (self-contained server bundle)
pnpm start          # serves UI and API on :8810
```

The server bundle has no runtime `node_modules` dependency.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8810` | Listen port |
| `NAVIFI_RUNTIME_DIR` | `data/runtime` | Where `audit.jsonl` is appended |
| `NAVIFI_LLM_URL` | unset | OpenAI-compatible base URL for the narrator (e.g. `http://vllm:8000/v1`). Unset = template narrative |
| `NAVIFI_LLM_MODEL` | `gpt-4o-mini` | Model name |
| `NAVIFI_LLM_KEY` | unset | Bearer token if the endpoint needs one |
| `NODE_NAME` | hostname | Shown on the Edge Platform screen (set from the Kubernetes downward API) |

Endpoints: `GET /api/health`, `GET /api/metrics` (Prometheus), `GET|POST /api/audit`, `POST /api/narrate`.

## Container

```bash
docker build -t navifi:0.9.3 .
docker run -p 8810:8810 -v navifi-audit:/data navifi:0.9.3
```

UBI9 base by default; pass `BUILD_IMAGE` / `RUNTIME_IMAGE` build args to use Iron Bank images. Runs as UID 1001, read-only root filesystem compatible, health check on `/api/health`.

## Kubernetes (RKE2 + UDS Core)

```bash
helm install navifi deploy/chart/navifi -n navifi --create-namespace \
  --set domain=uds.dev
```

With `uds.enabled=true` (default) the chart emits a UDS `Package` CR that:

- exposes the service on the tenant gateway at `navifi.<domain>`
- restricts traffic to the namespace (plus port 443 egress only if a shore LLM URL is set)
- registers a Keycloak SSO client with authservice in front of the UI
- registers a Prometheus monitor on `/api/metrics`

Optional in-cluster narrator: `--set llm.inCluster.enabled=true` (add `llm.inCluster.gpu=true` on GPU nodes).

## Air-gapped (Zarf + UDS bundle)

Pier side, connected:

```bash
zarf package create . --confirm
uds create . --confirm
```

Aboard, disconnected:

```bash
uds deploy uds-bundle-navifi-ship-amd64-0.9.3.tar.zst --confirm
```

The bundle carries Zarf init, UDS Core and NAVIFI. The optional `narrator` component ships model weights inside the package, so nothing is downloaded at sea.

## Compliance evidence

```bash
pnpm oscal                                         # regenerate compliance/oscal-component.yaml
lula validate -f compliance/oscal-component.yaml   # against a running cluster
```

The control list lives in `src/data/platform.ts`, the same source the Edge Platform screen renders. CI fails if the generated OSCAL file drifts from it.

## CI/CD

`.github/workflows/ci.yml` (and the `.gitlab-ci.yml` mirror):

1. **AI review** (pull requests, advisory): `ci/ai-review.mjs` sends the diff to `AI_REVIEW_URL`; findings land in the job summary. Never blocks unless `AI_REVIEW_BLOCKING=1`; never approves.
2. **Test**: typecheck, engine tests, build, OSCAL drift check.
3. **SAST**: Semgrep.
4. **Image**: build, Syft SBOM, Grype gate on high/critical, cosign keyless signature and SBOM attestation.
5. **Compliance**: deploy to UDS k3d, `lula validate`, publish OSCAL assessment results.
6. **Bundle** (tags): Zarf package and UDS bundle as release artifacts.

Pin third-party actions to commit SHAs before using this in an accredited factory.
