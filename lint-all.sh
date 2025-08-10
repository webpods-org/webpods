#!/usr/bin/env bash
# -------------------------------------------------------------------
# lint-all.sh – run linting across all packages
# -------------------------------------------------------------------
set -euo pipefail

echo "Running linting across all packages..."

# Define packages
PACKAGES=(
  "webpods-test-utils"
  "webpods"
  "webpods-integration-tests"
)

# Track overall success
all_passed=true

# Lint each package
for pkg_name in "${PACKAGES[@]}"; do
  pkg="node/packages/$pkg_name"
  if [[ ! -f "$pkg/package.json" ]]; then
    continue
  fi
  
  # Check if lint script exists
  if node -e "process.exit(require('./$pkg/package.json').scripts?.lint ? 0 : 1)"; then
    echo ""
    echo "Linting $pkg_name..."
    if (cd "$pkg" && npm run lint); then
      echo "✓ $pkg_name lint passed"
    else
      echo "✗ $pkg_name lint failed"
      all_passed=false
    fi
  fi
done

echo ""
echo "================================"
if [ "$all_passed" = true ]; then
  echo "✓ All packages passed linting!"
  exit 0
else
  echo "✗ Some packages failed linting"
  exit 1
fi