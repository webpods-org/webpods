#!/usr/bin/env bash
# -------------------------------------------------------------------
# db-all.sh – Run database commands for all configured databases
#
# Usage: ./scripts/db-all.sh <command>
# Commands: migrate:latest, migrate:rollback, migrate:status
# -------------------------------------------------------------------
set -euo pipefail

COMMAND="${1:-}"

if [ -z "$COMMAND" ]; then
    echo "Usage: $0 <command>"
    echo "Commands: migrate:latest, migrate:rollback, migrate:status"
    exit 1
fi

echo "=== Running $COMMAND for all databases ==="

# Run for webpods database
echo ""
echo ">>> Database: webpods"
echo "-----------------------------------"

case "$COMMAND" in
    migrate:latest)
        knex migrate:latest --knexfile database/webpods/knexfile.js
        ;;
    migrate:rollback)
        knex migrate:rollback --knexfile database/webpods/knexfile.js
        ;;
    migrate:status)
        knex migrate:status --knexfile database/webpods/knexfile.js
        ;;
    *)
        echo "Unknown command: $COMMAND"
        exit 1
        ;;
esac

echo ""
echo "=== Command completed for all databases ==="