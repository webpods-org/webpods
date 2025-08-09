# Build stage
FROM node:24-alpine AS builder

# Install build dependencies
RUN apk add --no-cache bash

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY node/package*.json ./node/
COPY node/packages/webpods-test-utils/package*.json ./node/packages/webpods-test-utils/
COPY node/packages/webpods/package*.json ./node/packages/webpods/

# Copy build scripts
COPY build.sh clean.sh ./

# Copy TypeScript config
COPY tsconfig.base.json ./

# Copy source code
COPY knexfile.js ./
COPY node ./node
COPY database ./database

# Install dependencies and build
RUN chmod +x build.sh clean.sh && \
    ./build.sh --install

# Runtime stage - Ubuntu minimal
FROM ubuntu:24.04 AS runtime

# Install Node.js 24 and minimal dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -r -u 1001 -g root -s /bin/bash webpods && \
    mkdir -p /home/webpods && \
    chown -R webpods:root /home/webpods

WORKDIR /app

# Copy built application from builder stage
COPY --from=builder --chown=webpods:root /app/node ./node
COPY --from=builder --chown=webpods:root /app/database ./database
COPY --from=builder --chown=webpods:root /app/package*.json ./
COPY --from=builder --chown=webpods:root /app/node_modules ./node_modules
COPY --from=builder --chown=webpods:root /app/knexfile.js ./

# Copy start script and entrypoint
COPY --chown=webpods:root start.sh docker-entrypoint.sh ./
RUN chmod +x start.sh docker-entrypoint.sh

# Switch to non-root user
USER webpods

# Expose API server port
EXPOSE 3000

# Set default environment variables (non-sensitive only)
ENV NODE_ENV=production \
    WEBPODS_PORT=3000 \
    LOG_LEVEL=info

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.WEBPODS_PORT || 3000) + '/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"

# Use entrypoint for automatic setup
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["./start.sh"]