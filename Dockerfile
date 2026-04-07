# ---- Build stage ----
FROM node:20-slim AS build

WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy root package files
COPY package.json package-lock.json ./

# Copy workspace package.json files (needed for npm ci workspace resolution)
COPY packages/sdk-v1/package.json packages/sdk-v1/
COPY web/package.json web/

# Install all deps (including devDependencies for build + all workspaces)
RUN npm ci

# Copy source, build configs, and full source
COPY tsconfig.json ./
COPY v1-src/ v1-src/
COPY packages/ packages/
COPY apps/ apps/
COPY configs/ configs/
COPY web/ web/

# Build everything: V1 SDK + V1 backend + V2 packages + frontend
RUN npm run build:all

# ---- Runtime stage ----
FROM node:20-slim

WORKDIR /app

# Runtime deps for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install production deps only
COPY package.json package-lock.json ./
RUN npm pkg delete scripts.prepare \
    && npm ci --omit=dev \
    && npm cache clean --force

# Remove build tools (no longer needed after native compilation)
RUN apt-get purge -y python3 make g++ && apt-get autoremove -y

# Copy compiled code, bin wrapper, templates, and configs
COPY --from=build /app/dist/ dist/
COPY --from=build /app/configs/ configs/
COPY bin/ bin/
COPY v1-src/templates/ v1-src/templates/

# Data directory for persistence
ENV TELETON_HOME=/data
VOLUME /data

# Run as non-root
RUN chown -R node:node /app
USER node

# WebUI port (when enabled) + V2 API port
EXPOSE 7777 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["node", "dist/cli/index.js"]
CMD ["start"]
