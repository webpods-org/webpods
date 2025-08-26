#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default configuration
CONTAINER_NAME="webpods-test-$$"
TEST_DB_NAME="webpodsdb_test_$$"
TEST_PORT=${2:-3099}
TIMEOUT=30

# Function to print colored output
print_info() {
    echo -e "${BLUE}$1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}! $1${NC}"
}

# Function to cleanup on exit
cleanup() {
    print_info "Cleaning up..."
    
    # Stop and remove test container
    if docker ps -a | grep -q $CONTAINER_NAME; then
        docker rm -f $CONTAINER_NAME >/dev/null 2>&1
        print_success "Removed test container"
    fi
    
    # Drop test database if it exists
    if [ -n "$POSTGRES_RUNNING" ]; then
        docker exec devenv-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS $TEST_DB_NAME;" >/dev/null 2>&1
        print_success "Dropped test database"
    fi
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Function to wait for service
wait_for_service() {
    local host=$1
    local port=$2
    local service=$3
    local max_attempts=15
    local attempt=1
    
    print_info "Waiting for $service to be ready..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s http://$host:$port/health >/dev/null 2>&1; then
            print_success "$service is ready"
            return 0
        fi
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    print_error "$service failed to start after $max_attempts attempts"
    return 1
}

# Function to create test JWT token
create_jwt_token() {
    # Simple JWT for testing (not secure, just for tests)
    echo "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0LXVzZXItaWQiLCJhdXRoSWQiOiJhdXRoOmdvb2dsZTp0ZXN0MTIzIiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwibmFtZSI6IlRlc3QgVXNlciIsInByb3ZpZGVyIjoiZ29vZ2xlIiwiaWF0IjoxNjA5NDU5MjAwfQ.test"
}

# Show usage if help is requested
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    echo "Usage: $0 [IMAGE] [PORT]"
    echo ""
    echo "Arguments:"
    echo "  IMAGE  Docker image to test (default: webpods:latest)"
    echo "  PORT   Port to expose the service on (default: 3099)"
    echo ""
    echo "Examples:"
    echo "  $0                              # Test webpods:latest on port 3099"
    echo "  $0 ghcr.io/webpods/webpods:latest # Test specific image"
    echo "  $0 webpods:latest 3000          # Test on specific port"
    exit 0
fi

# Parse command line arguments
IMAGE_TO_TEST=${1:-"webpods:latest"}
TEST_PORT=${2:-3099}

# Main test script
print_info "=== WebPods Docker Image Test ==="
echo

# Check if PostgreSQL is running
print_info "Checking for PostgreSQL..."
if docker ps | grep -q "devenv-postgres-1"; then
    POSTGRES_RUNNING=1
    print_success "PostgreSQL is running"
else
    print_warning "PostgreSQL not found. Starting it..."
    cd devenv && ./run.sh up -d
    cd ..
    sleep 5
    POSTGRES_RUNNING=1
fi

# Create test database
print_info "Creating test database..."
docker exec devenv-postgres-1 psql -U postgres -c "CREATE DATABASE $TEST_DB_NAME;" >/dev/null 2>&1
if [ $? -eq 0 ]; then
    print_success "Created test database: $TEST_DB_NAME"
    sleep 2
else
    print_warning "Test database might already exist"
fi

print_info "Testing image: $IMAGE_TO_TEST on port $TEST_PORT"
echo

# Start the container
print_info "Starting WebPods container..."
docker run -d --rm \
    --name $CONTAINER_NAME \
    -p $TEST_PORT:3000 \
    --add-host=host.docker.internal:host-gateway \
    -e WEBPODS_DB_HOST=host.docker.internal \
    -e WEBPODS_DB_PORT=5432 \
    -e WEBPODS_DB_NAME=$TEST_DB_NAME \
    -e WEBPODS_DB_USER=postgres \
    -e WEBPODS_DB_PASSWORD=postgres \
    -e WEBPODS_AUTO_MIGRATE=true \
    -e JWT_SECRET=test-secret-key \
    -e SESSION_SECRET=test-session-secret \
    -e WEBPODS_CONFIG_PATH=/app/config.docker.json \
    -e LOG_LEVEL=error \
    $IMAGE_TO_TEST >/dev/null 2>&1

if [ $? -ne 0 ]; then
    print_error "Failed to start container"
    exit 1
fi

print_success "Container started"

# Wait for the service to be ready
if ! wait_for_service localhost $TEST_PORT "WebPods API server"; then
    print_error "Server failed to start. Checking logs..."
    docker logs $CONTAINER_NAME
    exit 1
fi

# Give the server a moment to fully initialize
print_info "Waiting for server to fully initialize..."
sleep 5

echo
print_info "=== Running API Tests ==="
echo

TESTS_PASSED=0
TESTS_FAILED=0

# Test 1: Health check
print_info "Testing: Health check"
RESPONSE=$(curl -s http://localhost:$TEST_PORT/health)
if echo "$RESPONSE" | grep -q "\"status\":\"healthy\""; then
    print_success "Health check"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    print_error "Health check failed: $RESPONSE"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 2: Auth providers endpoint
print_info "Testing: Auth providers endpoint"
RESPONSE=$(curl -s http://localhost:$TEST_PORT/auth/providers)
if echo "$RESPONSE" | grep -q "\"providers\""; then
    print_success "Auth providers endpoint works"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    print_error "Auth providers endpoint failed: $RESPONSE"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 3: Unauthenticated write (should fail)
print_info "Testing: Unauthenticated write rejection"
RESPONSE=$(curl -s -X POST http://test.localhost:$TEST_PORT/test-stream \
    -H "Content-Type: application/json" \
    -d '{"message": "test"}' 2>/dev/null)
if echo "$RESPONSE" | grep -q "\"code\":\"UNAUTHORIZED\""; then
    print_success "Unauthenticated write rejected"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    print_error "Unauthenticated write not rejected: $RESPONSE"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi


echo
print_info "=== Test Summary ==="
print_success "Tests passed: $TESTS_PASSED"
if [ "$TESTS_FAILED" -gt 0 ]; then
    print_error "Tests failed: $TESTS_FAILED"
else
    print_success "All tests passed!"
fi

echo
print_info "=== Container Health Check ==="
docker logs --tail 10 $CONTAINER_NAME 2>&1 | grep -E "(error|Error|ERROR)" >/dev/null
if [ $? -eq 0 ]; then
    print_warning "Errors found in container logs"
else
    print_success "No errors in container logs"
fi

# Show container info
echo
print_info "=== Container Information ==="
docker ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo
if [ "$TESTS_FAILED" -eq 0 ]; then
    print_success "Docker image test completed successfully!"
    exit 0
else
    print_error "Docker image test failed!"
    exit 1
fi