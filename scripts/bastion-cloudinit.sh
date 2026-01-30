#!/bin/bash

set -euo pipefail

cat > /etc/sysctl.d/99-tailscale.conf << 'EOF'
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
EOF
sysctl -p /etc/sysctl.d/99-tailscale.conf

curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --authkey={{TAILSCALE_AUTH_KEY}} --advertise-exit-node --hostname={{TAILSCALE_HOSTNAME}}

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades
