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

# Start the server
cd node/packages/webpods
node dist/index.js