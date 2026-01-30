#!/usr/bin/env sh
set -e

PACKER_FILE="$(pwd)/hcloud.pkr.hcl"

echo "Initializing Packer for ${PACKER_FILE}..."
packer init "$(dirname "$PACKER_FILE")"

echo "Building Packer image for Talos v${TALOS_VERSION}..."
packer build -var "talos_version=${TALOS_VERSION}" "$PACKER_FILE"

echo "Packer build complete!"
echo "WARNING: Find your snapshot ID in the output above and add it to your config."
