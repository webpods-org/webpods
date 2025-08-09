#!/usr/bin/env bash
# -------------------------------------------------------------------
# clean.sh – Clean build artifacts across all packages
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

echo "=== Clean completed ==="