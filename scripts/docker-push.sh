#!/bin/bash

# Docker push script for WebPods
# Usage: ./docker-push.sh [registry/]image[:tag]

set -e

# Default values
DEFAULT_IMAGE="webpods:latest"
IMAGE="${1:-$DEFAULT_IMAGE}"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Pushing WebPods Docker image...${NC}"

# Check if image exists locally
if ! docker images | grep -q "${IMAGE%:*}.*${IMAGE#*:}"; then
    echo -e "${RED}Error: Image ${IMAGE} not found locally${NC}"
    echo "Please build the image first with: ./scripts/docker-build.sh"
    exit 1
fi

# Push the image
echo -e "${YELLOW}Pushing image: ${IMAGE}${NC}"
docker push "${IMAGE}"

# Check if push was successful
if [ $? -eq 0 ]; then
    echo -e "${GREEN}Successfully pushed ${IMAGE}${NC}"
    
    # If we also have a git commit tag, push that too
    GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "")
    if [ -n "${GIT_COMMIT}" ]; then
        COMMIT_TAG="${IMAGE%:*}:${GIT_COMMIT}"
        if docker images | grep -q "${COMMIT_TAG}"; then
            echo -e "${YELLOW}Also pushing commit tag: ${COMMIT_TAG}${NC}"
            docker push "${COMMIT_TAG}"
        fi
    fi
else
    echo -e "${RED}Docker push failed!${NC}"
    exit 1
fi