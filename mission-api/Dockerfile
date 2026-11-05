# Build from the HAWSIR repository root (the API bundles the engine beside it):
#   docker build -f mission-api/Dockerfile -t mission-api .
FROM node:22-alpine AS build
WORKDIR /src
COPY brand.json ./
COPY mission-engine/package.json mission-engine/tsconfig.json mission-engine/
COPY mission-engine/src mission-engine/src
COPY mission-engine/scenarios mission-engine/scenarios
COPY mission-api/package.json mission-api/package-lock.json mission-api/
RUN cd mission-api && npm ci --no-audit --no-fund
COPY mission-api/src mission-api/src
COPY mission-api/migrations mission-api/migrations
COPY mission-api/tsconfig.json mission-api/
# Files arrive with whatever modes they had in the build context (a checkout can
# hand over files the owner cannot even read). The build runs as root, so it does
# not notice; the runtime user would. Normalize to world-readable here.
RUN cd mission-api && npm run build && npm prune --omit=dev \
 && chmod -R a+rX,go-w package.json node_modules dist migrations

FROM node:22-alpine
ENV NODE_ENV=production PORT=8820
WORKDIR /app
COPY --from=build --chown=node:node /src/mission-api/package.json ./
COPY --from=build --chown=node:node /src/mission-api/node_modules ./node_modules
COPY --from=build --chown=node:node /src/mission-api/dist ./dist
COPY --from=build --chown=node:node /src/mission-api/migrations ./migrations
USER node
EXPOSE 8820
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:8820/api/health > /dev/null || exit 1
CMD ["node", "dist/server.mjs"]
