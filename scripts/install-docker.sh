#!/usr/bin/env bash
# Run this in YOUR terminal (needs sudo password once).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
echo "Docker installed. Log out/in or: newgrp docker"
# Prefer group socket over sudo once membership is active
docker --version || true
docker compose version || true
echo "Compose prod:"
echo "  cd \"/home/taipan/Documents/My Ride/ecosystem/backend\""
echo "  docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build"
echo "Or: \"/home/taipan/Documents/My Ride/scripts/up-prod-compose.sh\""
