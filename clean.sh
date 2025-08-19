#!/usr/bin/env bash
# -------------------------------------------------------------------
# clean.sh – Clean build artifacts and node_modules across all packages
# -------------------------------------------------------------------
set -euo pipefail

echo "=== Cleaning WebPods build artifacts ==="

# Clean dist directories in all packages
for pkg in node/packages/*; do
  if [[ -d "$pkg/dist" ]]; then
    echo "Removing $pkg/dist"
    rm -rf "$pkg/dist"
  fi
done

# Clean any .tsbuildinfo files
find . -name "*.tsbuildinfo" -type f -delete 2>/dev/null || true

# Clean root node_modules
if [[ -d "node_modules" ]]; then
  echo "Removing root node_modules"
  rm -rf node_modules
fi

# Clean node_modules from all packages
for pkg in node/packages/*; do
  if [[ -d "$pkg/node_modules" ]]; then
    echo "Removing $pkg/node_modules"
    rm -rf "$pkg/node_modules"
  fi
done

echo "=== Clean completed ==="