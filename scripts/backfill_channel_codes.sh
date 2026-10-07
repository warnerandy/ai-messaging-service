#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

COMPOSE_FILE="${COMPOSE_FILE:-$PROJECT_ROOT/docker-compose.yml}"
DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${DB_USER:-messaging}"
DB_NAME="${DB_NAME:-messaging_prod}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is not installed or not on PATH." >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Error: compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

echo "==> Backfilling bot token channel codes"
echo "    compose file: $COMPOSE_FILE"
echo "    db service:   $DB_SERVICE"
echo "    db:           $DB_NAME"

cd "$PROJECT_ROOT"

docker compose -f "$COMPOSE_FILE" exec -T "$DB_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;

WITH updated AS (
  UPDATE bot_tokens
  SET channel_code = translate(trim(trailing '=' from encode(gen_random_bytes(16), 'base64')), '/+', '_-')
  WHERE channel_code IS NULL
  RETURNING id
)
SELECT count(*) AS updated_rows FROM updated;

SELECT count(*) AS remaining_null_rows
FROM bot_tokens
WHERE channel_code IS NULL;
SQL

echo "==> Done"
