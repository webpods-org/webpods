#!/usr/bin/env bash
# -------------------------------------------------------------------
# start.sh – Start the WebPods server
# -------------------------------------------------------------------
set -euo pipefail

echo "=== Starting WebPods server ==="

# Check if dist directory exists
if [[ ! -d "node/packages/webpods/dist" ]]; then
  echo "Build not found. Running build first..."
  ./build.sh
fi

# Check for config file in the root directory
CONFIG_PATH="../../../config.json"
if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "Error: config.json not found in project root"
  echo "Please create a config.json file. You can copy config.example.json as a starting point."
  exit 1
fi

# Start the server
cd node/packages/webpods
node dist/cli.js -c "$CONFIG_PATH"