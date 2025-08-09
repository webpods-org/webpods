#!/usr/bin/env bash
# -------------------------------------------------------------------
# dump-db-schema.sh – Export database schema to SQL file
# -------------------------------------------------------------------
set -euo pipefail

# Database connection settings
DB_HOST="${WEBPODS_DB_HOST:-localhost}"
DB_PORT="${WEBPODS_DB_PORT:-5432}"
DB_NAME="${WEBPODS_DB_NAME:-webpods}"
DB_USER="${WEBPODS_DB_USER:-postgres}"

OUTPUT_FILE="docs/webpods-schema.sql"

echo "=== Dumping WebPods database schema ==="
echo "Database: $DB_NAME@$DB_HOST:$DB_PORT"
echo "Output: $OUTPUT_FILE"

# Create docs directory if it doesn't exist
mkdir -p docs

# Dump schema only (no data)
PGPASSWORD="${WEBPODS_DB_PASSWORD:-postgres}" pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --schema-only \
    --no-owner \
    --no-privileges \
    --no-tablespaces \
    --no-unlogged-table-data \
    -f "$OUTPUT_FILE"

if [ $? -eq 0 ]; then
    echo "✅ Schema dumped successfully to $OUTPUT_FILE"
    
    # Show summary
    echo ""
    echo "Tables in schema:"
    grep "CREATE TABLE" "$OUTPUT_FILE" | sed 's/CREATE TABLE /  - /' | sed 's/ ($//'
else
    echo "❌ Failed to dump schema"
    exit 1
fi