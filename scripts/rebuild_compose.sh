#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$PROJECT_ROOT/docker-compose.yml}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is not installed or not on PATH." >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Error: compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

echo "==> Rebuilding and reloading services with compose file: $COMPOSE_FILE"

cd "$PROJECT_ROOT"

docker compose -f "$COMPOSE_FILE" up -d --build --force-recreate --remove-orphans

echo "==> Current service status"
docker compose -f "$COMPOSE_FILE" ps
