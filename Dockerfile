# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

# Install all dependencies
RUN npm install

# Copy source
COPY tsconfig.base.json ./
COPY packages/server/ packages/server/
COPY packages/client/ packages/client/

# Build client then server
RUN npm run build --workspace=packages/client
RUN npm run build --workspace=packages/server

# Stage 2: Production
FROM node:20-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends openssl smbclient ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Copy package files and install production deps only
COPY package.json package-lock.json* ./
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm install --omit=dev --workspace=packages/server

# Copy built server
COPY --from=builder /app/packages/server/dist packages/server/dist/

# Copy built client
COPY --from=builder /app/packages/client/dist packages/client/dist/

RUN chown -R node:node /app
USER node

EXPOSE 7443

VOLUME /app/data

ENV DATA_DIR=/app/data
ENV NODE_ENV=production
# @marsaud/smb2 uses ntlm which calls DES-ECB — a legacy cipher disabled in OpenSSL 3.
# Enable the OpenSSL legacy provider so SMB NTLM authentication works on Node 20.
ENV NODE_OPTIONS="--openssl-legacy-provider"

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -fsk https://localhost:7443/health || exit 1

CMD ["node", "packages/server/dist/index.js"]
