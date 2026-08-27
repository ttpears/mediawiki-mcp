FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files and install all deps (including dev for build)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
RUN chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 8009

# The server defaults to MEDIAWIKI_MCP_HOST=localhost, which alpine resolves to
# ::1 first — so an unconfigured container listens on IPv6 loopback only, the
# published port reaches nothing and the healthcheck below can never pass.
# Containers are the one context where binding every interface is the intended
# default; an explicit -e still overrides this.
ENV MEDIAWIKI_MCP_HOST=0.0.0.0

# 127.0.0.1 (not localhost): localhost can resolve to ::1 first in-container →
# connection refused. -qO- is busybox-safe.
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8009/health || exit 1

CMD ["node", "dist/http-transport.js"]
