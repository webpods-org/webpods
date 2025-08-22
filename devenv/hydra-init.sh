#!/bin/sh
# Start Hydra in background
hydra serve all --dev &
HYDRA_PID=$!

# Wait for Hydra to be ready
sleep 5

# Create test authorization client
hydra create client \
  --endpoint http://localhost:4445 \
  --id webpods-test-authz-client \
  --name "WebPods Test Authorization Client" \
  --grant-type authorization_code \
  --response-type code \
  --token-endpoint-auth-method none \
  --redirect-uri http://localhost:3000/callback

# Keep Hydra running
wait $HYDRA_PID