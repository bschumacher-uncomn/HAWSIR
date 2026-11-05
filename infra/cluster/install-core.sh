#!/usr/bin/env bash
# Deploy the lab platform bundle onto RKE2: storage prerequisites, Zarf init,
# then UDS Core (uds-bundle.yaml).
#
#   infra/cluster/install-core.sh
#
# Safe to re-run; uds deploy upgrades in place. The first run asks for a UDS
# Registry login, because UDS Core 1.x is published at registry.defenseunicorns.com
# (a free account works), and generates the node's secrets under
# ~/.config/navifi-lab: MinIO credentials and the gateways' in-cluster TLS.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../versions.env
source "$HERE/../versions.env"
# shellcheck source=/dev/null
source /etc/navifi-lab/lab.env # DOMAIN, written by the instance user-data
SECRETS="$HOME/.config/navifi-lab/storage.env"
TLS="$HOME/.config/navifi-lab/tls"
BUILD="$HERE/build"
REGISTRY=registry.defenseunicorns.com

[[ $EUID -ne 0 ]] || { echo "run as ec2-user, not root" >&2; exit 1; }
[[ -r "$HOME/.kube/config" ]] || { echo "no kubeconfig: run sudo infra/cluster/install-rke2.sh first" >&2; exit 1; }

export PATH="$HOME/.local/bin:$PATH"
if [[ "$(uds version 2>/dev/null)" != "$UDS_CLI_VERSION" ]]; then
  echo "==> Installing UDS CLI $UDS_CLI_VERSION"
  tmp="$(mktemp)"
  curl -fsSL -o "$tmp" \
    "https://github.com/defenseunicorns/uds-cli/releases/download/$UDS_CLI_VERSION/uds-cli_${UDS_CLI_VERSION}_Linux_amd64"
  echo "$UDS_CLI_SHA256  $tmp" | sha256sum --check --quiet
  install -D -m 0755 "$tmp" "$HOME/.local/bin/uds"
  rm -f "$tmp"
fi

if ! grep -qs "\"$REGISTRY\"" "$HOME/.docker/config.json"; then
  echo "==> Log in to $REGISTRY"
  read -rp "    username: " registry_user
  read -rsp "    token: " registry_token
  echo
  printf '%s' "$registry_token" | uds zarf tools registry login "$REGISTRY" --username "$registry_user" --password-stdin
  unset registry_token
fi

# Generated once and kept on the node only. UDS_* variables reach every package
# in the bundle.
if [[ ! -s "$SECRETS" ]]; then
  echo "==> Generating storage credentials in $SECRETS"
  install -d -m 0700 "$(dirname "$SECRETS")"
  (
    umask 077
    printf 'UDS_MINIO_ROOT_PASSWORD=%s\nUDS_STORAGE_SECRET_KEY=%s\n' \
      "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > "$SECRETS"
  )
fi
set -a
# shellcheck source=/dev/null
source "$SECRETS"
set +a

# Pods reach the gateways' HTTPS port directly (see uds-bundle.yaml, ingress).
# A private CA is enough there because the cluster trust bundle carries it;
# browsers only ever see the ALB's ACM certificate. Regenerated if the domain
# changes or the certificate expires.
if ! openssl verify -CAfile "$TLS/ca.crt" -verify_hostname "sso.$DOMAIN" "$TLS/gateway.crt" >/dev/null 2>&1; then
  echo "==> Generating the gateway certificate for in-cluster HTTPS in $TLS"
  install -d -m 0700 "$TLS"
  (
    umask 077
    cd "$TLS"
    openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -noenc -days 3650 \
      -subj "/CN=NAVIFI lab gateway CA" \
      -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" \
      -keyout ca.key -out ca.crt
    openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -noenc -days 825 \
      -subj "/CN=$DOMAIN" -CA ca.crt -CAkey ca.key \
      -addext "subjectAltName=DNS:*.$DOMAIN,DNS:*.admin.$DOMAIN" \
      -addext "basicConstraints=critical,CA:FALSE" -addext "extendedKeyUsage=serverAuth" \
      -keyout gateway.key -out gateway.crt
  )
fi
gateway_chain="$(cat "$TLS/gateway.crt" "$TLS/ca.crt" | base64 -w0)"
gateway_key="$(base64 -w0 "$TLS/gateway.key")"
ca_bundle="$(base64 -w0 "$TLS/ca.crt")"
export UDS_TENANT_TLS_CERT="$gateway_chain" UDS_ADMIN_TLS_CERT="$gateway_chain"
export UDS_TENANT_TLS_KEY="$gateway_key" UDS_ADMIN_TLS_KEY="$gateway_key"
export UDS_CA_BUNDLE_CERTS="$ca_bundle"

# One MinIO user, created by the prereqs package, for both Loki and Velero.
export UDS_STORAGE_ACCESS_KEY=uds-core
export UDS_VELERO_BUCKET_KEY="$UDS_STORAGE_ACCESS_KEY"
export UDS_VELERO_BUCKET_KEY_SECRET="$UDS_STORAGE_SECRET_KEY"
export UDS_DOMAIN="$DOMAIN"
export UDS_CONFIG="$HERE/uds-config.yaml"

echo "==> Building the storage prerequisites package"
mkdir -p "$BUILD"
uds zarf package create "$HERE/prereqs" --output "$BUILD" --confirm

echo "==> Building the platform bundle (pulls and verifies Zarf init and UDS Core)"
uds create "$HERE" --output "$BUILD" --confirm
bundle="$BUILD/uds-bundle-navifi-lab-platform-amd64-$(uds zarf tools yq '.metadata.version' "$HERE/uds-bundle.yaml").tar.zst"

echo "==> Deploying $(basename "$bundle") (about 20 minutes on a fresh cluster)"
uds deploy "$bundle" --confirm

echo "==> Node capacity with UDS Core running (requests against allocatable)"
uds zarf tools kubectl describe node | sed -n '/^Allocated resources:/,/^Events:/p'

echo "==> Platform ready on $DOMAIN"
echo "    next: infra/app/deploy.sh"
