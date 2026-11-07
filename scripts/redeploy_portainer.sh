#!/usr/bin/env bash
#
# Helper shell script to redeploy and pull the latest image for a Portainer stack.
#
# Usage:
#   ./scripts/redeploy_portainer.sh [stack_name_or_id]
#
# Examples:
#   ./scripts/redeploy_portainer.sh ai-messaging-service
#   ./scripts/redeploy_portainer.sh ai-messenger
#   ./scripts/redeploy_portainer.sh 7
#   ./scripts/redeploy_portainer.sh 13

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK="${1:-ai-messaging-service}"

node "$DIR/redeploy_portainer.cjs" "$STACK"
