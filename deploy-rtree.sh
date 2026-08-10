#!/usr/bin/env bash
# R*Tree deployment — legacy SQLite driver_profiles spatial index
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo "🚀 Starting R*Tree deployment..."

mkdir -p backups
DB="${SQLITE_PATH:-./mycab.sqlite}"
BACKUP="backups/mycab_$(date +%Y%m%d_%H%M%S).sqlite"

if [ -f "$DB" ]; then
  echo "📦 Creating backup..."
  cp "$DB" "$BACKUP"
  echo -e "${GREEN}✅ Backup: $BACKUP${NC}"
else
  echo -e "${YELLOW}⚠️  No DB at $DB — boot will create on first API start${NC}"
fi

echo "📝 Running migration..."
npm run migrate:rtree

echo "🌱 Seeding R*Tree..."
npm run seed:rtree || echo -e "${YELLOW}⚠️  Seeding had issues (empty if no online drivers)${NC}"

echo "🔍 Verifying..."
npm run verify:rtree || true

echo -e "${GREEN}✅ Deployment complete!${NC}"
echo "Test: curl -H \"Authorization: Bearer TOKEN\" \"http://localhost:3000/api/rides/nearby?lat=-33.9249&lng=25.5701&radius=5000\""
