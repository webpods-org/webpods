#!/usr/bin/env bash
# -------------------------------------------------------------------
# docker-start.sh – Start the WebPods server in Docker container
# -------------------------------------------------------------------
set -euo pipefail

echo "=== Starting WebPods server (Docker) ==="

# Check if dist directory exists
if [[ ! -d "node/packages/webpods/dist" ]]; then
  echo "Error: Build not found in Docker image"
  exit 1
fi

# Determine config path
# Priority: WEBPODS_CONFIG_PATH env var > config.json > config.example.json
if [[ -n "${WEBPODS_CONFIG_PATH:-}" ]]; then
  CONFIG_PATH="${WEBPODS_CONFIG_PATH}"
  echo "Using config from WEBPODS_CONFIG_PATH: $CONFIG_PATH"
elif [[ -f "config.json" ]]; then
  CONFIG_PATH="$(pwd)/config.json"
  echo "Using config.json"
elif [[ -f "config.example.json" ]]; then
  CONFIG_PATH="$(pwd)/config.example.json"
  echo "Using config.example.json (default for Docker)"
else
  echo "Error: No config file found"
  echo "Please provide config.json or set WEBPODS_CONFIG_PATH"
  exit 1
fi

# Verify config exists
if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "Error: Config file not found at $CONFIG_PATH"
  exit 1
fi

# Start the server
cd node/packages/webpods
exec node dist/cli.js -c "$CONFIG_PATH"