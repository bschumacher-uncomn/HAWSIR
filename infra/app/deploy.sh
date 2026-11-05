#!/usr/bin/env bash
# Build HAWSIR from a git ref and deploy it to the lab cluster.
#
#   infra/app/deploy.sh            # tip of the remote's default branch
#   infra/app/deploy.sh <git-ref>  # any branch, tag or commit that has infra/app
#
# Builds the web and mission-api images on the node, packages them with the
# repo's Helm chart and Postgres as a Zarf package, and deploys it. Each commit
# gets its own image tag, so a new commit always rolls both Deployments.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
# shellcheck source=/dev/null
source /etc/navifi-lab/lab.env # DOMAIN, written by the instance user-data
export PATH="$HOME/.local/bin:$PATH"
command -v uds >/dev/null || { echo "uds not found: run infra/cluster/install-core.sh first" >&2; exit 1; }

git -C "$REPO" fetch --quiet origin
ref="${1:-$(git -C "$REPO" symbolic-ref --short refs/remotes/origin/HEAD)}"
# A branch name means the branch as just fetched, not a stale local copy.
git -C "$REPO" rev-parse --quiet --verify "refs/remotes/origin/$ref" >/dev/null && ref="origin/$ref"
sha="$(git -C "$REPO" rev-parse --short=12 "$ref^{commit}")"

# Build from a clean export of the commit, not the working tree.
src="$(mktemp -d)"
trap 'rm -rf "$src"' EXIT
git -C "$REPO" archive "$sha" | tar -x -C "$src"
[[ -f "$src/infra/app/zarf.yaml" && -d "$src/deploy/chart/hawsir" ]] \
  || { echo "$ref predates the HAWSIR chart in infra/app; deploy a newer commit" >&2; exit 1; }

tag="$(jq -r .version "$src/package.json")-$sha"
web="ghcr.io/uncomn/hawsir-web:$tag"
api="ghcr.io/uncomn/hawsir-api:$tag"

echo "==> Building $web and $api from $ref"
docker build --network host --tag "$web" "$src"
docker build --network host --file "$src/mission-api/Dockerfile" --tag "$api" "$src"

echo "==> Packaging"
uds zarf package create "$src/infra/app" --set IMAGE_TAG="$tag" --output "$src" --confirm

echo "==> Deploying to hawsir.$DOMAIN"
uds zarf package deploy "$src/zarf-package-hawsir-lab-amd64-$tag.tar.zst" \
  --set-variables DOMAIN="$DOMAIN" --confirm

# Deployed images live in the Zarf registry; local copies of old builds only use disk.
for repo in ghcr.io/uncomn/hawsir-web ghcr.io/uncomn/hawsir-api; do
  docker images "$repo" --format '{{.Tag}}' | grep -vx "$tag" \
    | xargs -r -I{} docker image rm "$repo:{}" >/dev/null || true
done

echo "==> Deployed $tag"
echo "    https://hawsir.$DOMAIN"
