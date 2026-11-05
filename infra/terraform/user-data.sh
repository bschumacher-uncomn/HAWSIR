#!/bin/bash
# First boot of the NAVIFI lab node (RHEL 9, cloud-init). Terraform renders this
# file: the braced variables are Terraform's (region, domain), and shell variables
# are written without braces.
#
# Prepares the host only, then reboots once. The cluster is installed from a
# checkout of this repo (infra/README.md, steps 3 to 5).
# shellcheck disable=SC2154 # region and domain are Terraform template variables
set -euxo pipefail

# The SSM agent is the only way in: no SSH, no key pair. Red Hat's images do not include it.
dnf install -y "https://s3.${region}.amazonaws.com/amazon-ssm-${region}/latest/linux_amd64/amazon-ssm-agent.rpm"
systemctl enable --now amazon-ssm-agent

dnf install -y git jq tar openssl policycoreutils-python-utils dnf-plugins-core

# Docker builds the NAVIFI image on the node. It is build-only: no default bridge
# and no iptables rules, so it cannot touch RKE2's networking. Builds use --network host.
dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
install -d -m 0755 /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{ "bridge": "none", "iptables": false, "ip6tables": false }
EOF
systemctl enable --now docker
usermod -aG docker ec2-user

# RKE2 on RHEL (docs.rke2.io/known_issues): nm-cloud-setup rewrites routing that
# Canal depends on, and NetworkManager must leave the CNI interfaces alone.
systemctl disable nm-cloud-setup.service nm-cloud-setup.timer || true
cat > /etc/NetworkManager/conf.d/rke2-canal.conf <<'EOF'
[keyfile]
unmanaged-devices=interface-name:cali*;interface-name:flannel*
EOF

# Settings the node scripts read. Terraform is the single source for the domain.
install -d -m 0755 /etc/navifi-lab
cat > /etc/navifi-lab/lab.env <<'EOF'
DOMAIN=${domain}
EOF

# Read-only deploy key for the private repo. Add the public half in GitHub:
# repository Settings > Deploy keys.
home=/home/ec2-user
install -d -m 0700 -o ec2-user -g ec2-user "$home/.ssh"
[[ -f "$home/.ssh/deploy_navifi" ]] || sudo -u ec2-user ssh-keygen -q -t ed25519 -N '' -C bd-lab-uds-navifi -f "$home/.ssh/deploy_navifi"
cat > "$home/.ssh/config" <<'EOF'
Host github.com
  User git
  IdentityFile ~/.ssh/deploy_navifi
  IdentitiesOnly yes
EOF
# GitHub's published host key (https://api.github.com/meta).
echo 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' > "$home/.ssh/known_hosts"
chown ec2-user:ec2-user "$home/.ssh/config" "$home/.ssh/known_hosts"
chmod 0600 "$home/.ssh/config" "$home/.ssh/known_hosts"

# install-rke2.sh refuses to run until the node has booted past this one.
cat /proc/sys/kernel/random/boot_id > /etc/navifi-lab/first-boot-done
# nm-cloud-setup already ran on this boot. Reboot once so its routing rules are gone.
shutdown -r +1
