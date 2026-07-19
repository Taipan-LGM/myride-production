#!/usr/bin/env bash
# Run this in YOUR terminal (needs sudo password once).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
echo "Docker installed. Log out/in or: newgrp docker"
docker --version
docker compose version
echo "Then: \"/home/taipan/Documents/My Ride/scripts/up-prod-compose.sh\""
