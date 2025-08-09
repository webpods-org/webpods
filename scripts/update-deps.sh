#!/usr/bin/env bash
# -------------------------------------------------------------------
# update-deps.sh – Update dependencies across all packages
# -------------------------------------------------------------------
set -euo pipefail

echo "=== Updating dependencies for WebPods ==="

# Update root dependencies
echo "Updating root dependencies..."
npm update

# Update each package
for pkg in node/packages/*; do
    if [[ -d "$pkg" ]] && [[ -f "$pkg/package.json" ]]; then
        echo ""
        echo "Updating $(basename "$pkg") dependencies..."
        (cd "$pkg" && npm update)
    fi
done

echo ""
echo "=== Dependencies updated ==="
echo "Remember to run tests after updating: npm test"