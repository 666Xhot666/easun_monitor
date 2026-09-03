#!/usr/bin/env bash
# One-time scaffolding for eam_server (NestJS) and eam_front (Vite + React).
# Run this from the repo root BEFORE `docker compose up`, since the Dockerfiles
# expect a package.json to already exist in each service directory.
#
# Usage: ./scripts/bootstrap.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Scaffolding eam_server (NestJS)..."
cd "$ROOT_DIR/eam_server"
if [ -f package.json ]; then
  echo "    eam_server/package.json already exists, skipping."
else
  npx --yes @nestjs/cli@latest new . --skip-git --package-manager npm
fi

echo "==> Scaffolding eam_front (Vite + React + TypeScript)..."
cd "$ROOT_DIR/eam_front"
if [ -f package.json ]; then
  echo "    eam_front/package.json already exists, skipping."
else
  npm create vite@latest . -- --template react-ts
  npm install
fi

echo "==> Done."
echo "    1. cp .env.example .env   (then set INVERTER_IP to your inverter's LAN IP)"
echo "    2. docker compose up --build"
