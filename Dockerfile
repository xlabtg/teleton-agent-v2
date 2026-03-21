FROM node:20-alpine AS base
WORKDIR /app

FROM base AS dependencies
COPY package*.json ./
RUN npm ci --ignore-scripts --omit=dev

FROM base AS builder
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/configs ./configs
COPY --from=dependencies /app/node_modules ./node_modules

# Non-root user + data directory
USER node
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

EXPOSE 3000

CMD ["node", "dist/apps/agent/index.js"]
