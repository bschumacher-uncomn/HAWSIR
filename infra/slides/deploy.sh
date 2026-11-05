#!/usr/bin/env bash
# Build the HAWSIR deck site from a git ref and deploy it to the lab cluster.
#
#   infra/slides/deploy.sh            # tip of the remote's default branch
#   infra/slides/deploy.sh <git-ref>  # any branch, tag or commit that has infra/slides
#
# Serves whatever deck is committed in docs/slides/ (python3 deck/build_week.py,
# then copy the .pptx, .pdf and .notes.json there). Each commit gets its own
# image tag, so a new commit always rolls the Deployment.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
# shellcheck source=/dev/null
source /etc/navifi-lab/lab.env # DOMAIN, written by the instance user-data
export PATH="$HOME/.local/bin:$PATH"
command -v uds >/dev/null || { echo "uds not found: run infra/cluster/install-core.sh first" >&2; exit 1; }

git -C "$REPO" fetch --quiet origin
ref="${1:-$(git -C "$REPO" symbolic-ref --short refs/remotes/origin/HEAD)}"
git -C "$REPO" rev-parse --quiet --verify "refs/remotes/origin/$ref" >/dev/null && ref="origin/$ref"
sha="$(git -C "$REPO" rev-parse --short=12 "$ref^{commit}")"

src="$(mktemp -d)"
trap 'rm -rf "$src"' EXIT
git -C "$REPO" archive "$sha" | tar -x -C "$src"
[[ -f "$src/infra/slides/zarf.yaml" ]] || { echo "$ref predates infra/slides; deploy a newer commit" >&2; exit 1; }

tag="0.1.0-$sha"
image="ghcr.io/navifi/hawsir-slides:$tag"

echo "==> Building $image from $ref"
docker build --network host --file "$src/infra/slides/Dockerfile" --tag "$image" "$src"

echo "==> Packaging"
uds zarf package create "$src/infra/slides" --set IMAGE_TAG="$tag" --output "$src" --confirm

echo "==> Deploying to slides.$DOMAIN"
uds zarf package deploy "$src/zarf-package-hawsir-slides-amd64-$tag.tar.zst" --confirm

docker images ghcr.io/navifi/hawsir-slides --format '{{.Tag}}' | grep -vx "$tag" \
  | xargs -r -I{} docker image rm ghcr.io/navifi/hawsir-slides:{} >/dev/null || true

echo "==> Deployed $tag"
echo "    https://slides.$DOMAIN"
