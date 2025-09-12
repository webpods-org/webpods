#!/usr/bin/env bash
# -------------------------------------------------------------------
# start.sh – Start the WebPods server
# -------------------------------------------------------------------
set -euo pipefail

# Change to the project root directory
cd "$(dirname "$0")/.."

echo "=== Starting WebPods server ==="

# Load environment variables from .env if it exists
if [[ -f ".env" ]]; then
  echo "Loading environment variables from .env file..."
  set -a  # Export all variables
  source .env
  set +a  # Stop exporting
fi

# Check if dist directory exists
if [[ ! -d "node/packages/webpods/dist" ]]; then
  echo "Build not found. Running build first..."
  ./scripts/build.sh
fi

# Check for config file in the root directory
if [[ ! -f "config.json" ]]; then
  echo "Error: config.json not found in project root"
  echo "Please create a config.json file. You can copy config.example.json as a starting point."
  exit 1
fi

# Get absolute path to config
CONFIG_PATH="$(pwd)/config.json"

# Start the server
cd node/packages/webpods
node dist/cli.js -c "$CONFIG_PATH"