#!/bin/bash

# Script to update CLI tests for the new hierarchical schema

echo "Updating CLI tests to use new hierarchical schema..."

# First, let's handle the imports - add the helper import to all test files
for file in src/tests/{export,links,pods,records,recursive-records,transfer,verify}.test.ts; do
  if [ -f "$file" ]; then
    echo "Processing $file..."
    
    # Check if the import is already there
    if ! grep -q "test-data-helpers" "$file"; then
      # Add the import after the test-setup import
      sed -i '/from "\.\.\/test-setup\.js";/a\import { createTestStream, createTestRecord, createStreamWithRecord, createPermissionStream, createRoutingConfig, createDomainConfig, createOwnerConfig } from "../utils/test-data-helpers.js";' "$file"
    fi
  fi
done

echo "Imports added to all test files."
echo ""
echo "Now you need to manually update each test file to:"
echo "1. Replace direct INSERT INTO record queries with helper functions"
echo "2. Replace direct INSERT INTO stream queries with createTestStream()"
echo "3. Update stream name references to use stream paths"
echo ""
echo "Example changes needed:"
echo "- Replace pod_name/stream_name columns with stream_id"
echo "- Use createTestStream() for stream creation"
echo "- Use createTestRecord() for record creation"
echo "- Use createOwnerConfig() for owner setup"
echo "- Use createPermissionStream() for permission setup"