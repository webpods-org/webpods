#!/usr/bin/env bash
# -------------------------------------------------------------------
# test-all.sh – Run all tests
# -------------------------------------------------------------------
set -euo pipefail

echo "=== Running all WebPods tests ==="

# Track if any test fails
FAILED=0

# Run integration tests
echo ""
echo ">>> Running integration tests"
echo "-----------------------------------"

if npm run test:integration; then
    echo "✓ Integration tests passed"
else
    echo "✗ Integration tests failed"
    FAILED=1
fi

echo ""
if [ $FAILED -eq 0 ]; then
    echo "=== All tests passed! ==="
    exit 0
else
    echo "=== Some tests failed ==="
    exit 1
fi