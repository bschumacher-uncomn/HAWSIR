#!/usr/bin/env bash
# Install and start the pinned single-node RKE2 server on the lab node
# (RHEL 9, SELinux enforcing).
#
#   sudo infra/cluster/install-rke2.sh
#
# Safe to re-run. Writes ~/.kube/config for the account that ran sudo.
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "run with sudo: sudo $0" >&2; exit 1; }
: "${SUDO_USER:?run via sudo from the ec2-user account}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../versions.env
source "$HERE/../versions.env"
USER_HOME="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
KUBECTL=/var/lib/rancher/rke2/bin/kubectl

# user-data records the boot it ran on, then reboots once.
first_boot=/etc/navifi-lab/first-boot-done
[[ -s $first_boot ]] \
  || { echo "first-boot setup has not finished (see /var/log/cloud-init-output.log)" >&2; exit 1; }
[[ "$(cat "$first_boot")" != "$(cat /proc/sys/kernel/random/boot_id)" ]] \
  || { echo "the node reboots once after first-boot setup; reconnect in a minute" >&2; exit 1; }
[[ "$(getenforce)" == Enforcing ]] \
  || { echo "SELinux is $(getenforce); this node is meant to run enforcing" >&2; exit 1; }

echo "==> Kernel modules Istio needs (UDS Core production prerequisites)"
printf '%s\n' br_netfilter xt_REDIRECT xt_owner xt_statistic iptable_mangle iptable_nat \
  xt_conntrack xt_tcpudp xt_connmark xt_mark ip_set > /etc/modules-load.d/istio.conf
while read -r module; do
  modprobe "$module" || echo "    warning: kernel module $module did not load" >&2
done < /etc/modules-load.d/istio.conf

echo "==> Kernel limits for Istio CNI, ztunnel and Vector (UDS Core runbook: too many open files)"
cat > /etc/sysctl.d/90-uds-core.conf <<'EOF'
fs.inotify.max_user_instances = 1024
fs.inotify.max_user_watches = 1048576
EOF
sysctl --quiet --system

echo "==> Volume path for local-path-provisioner, labelled so containers may write to it"
install -d -m 0755 /opt/local-path-provisioner
semanage fcontext --add --type container_file_t '/opt/local-path-provisioner(/.*)?' 2>/dev/null \
  || semanage fcontext --modify --type container_file_t '/opt/local-path-provisioner(/.*)?'
restorecon -R /opt/local-path-provisioner

# A running server picks up a new version or config only on restart.
installed=""
command -v rke2 >/dev/null && installed="$(rke2 --version | awk 'NR==1{print $3}')"
restart=false
if [[ "$installed" == "$RKE2_VERSION" ]]; then
  echo "==> RKE2 $RKE2_VERSION already installed"
else
  # On RHEL the installer uses Rancher's signed RPMs, including rke2-selinux.
  echo "==> Installing RKE2 $RKE2_VERSION"
  installer="$(mktemp)"
  curl -fsSL -o "$installer" "https://raw.githubusercontent.com/rancher/rke2/$RKE2_VERSION/install.sh"
  echo "$RKE2_INSTALL_SHA256  $installer" | sha256sum --check --quiet
  INSTALL_RKE2_VERSION="$RKE2_VERSION" INSTALL_RKE2_TYPE=server sh "$installer"
  rm -f "$installer"
  [[ -n "$installed" ]] && restart=true
fi

if ! cmp -s "$HERE/rke2-config.yaml" /etc/rancher/rke2/config.yaml; then
  install -D -m 0600 "$HERE/rke2-config.yaml" /etc/rancher/rke2/config.yaml
  [[ -n "$installed" ]] && restart=true
fi

echo "==> Starting rke2-server (the first start takes a few minutes)"
systemctl enable --now rke2-server.service
if $restart; then
  systemctl restart rke2-server.service
fi

export KUBECONFIG=/etc/rancher/rke2/rke2.yaml
for _ in $(seq 1 60); do
  [[ -x "$KUBECTL" ]] && "$KUBECTL" --request-timeout=5s get node >/dev/null 2>&1 && break
  sleep 5
done
"$KUBECTL" wait --for=condition=Ready node --all --timeout=300s >/dev/null
ln -sf "$KUBECTL" /usr/local/bin/kubectl

install -d -m 0700 -o "$SUDO_USER" -g "$SUDO_USER" "$USER_HOME/.kube"
install -m 0600 -o "$SUDO_USER" -g "$SUDO_USER" /etc/rancher/rke2/rke2.yaml "$USER_HOME/.kube/config"

echo "==> RKE2 ready"
"$KUBECTL" get node -o wide
echo "    next (as $SUDO_USER): infra/cluster/install-core.sh"
