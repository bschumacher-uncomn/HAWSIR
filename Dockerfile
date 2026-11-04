# syntax=docker/dockerfile:1.7
# Defaults are public UBI9 images. For accredited builds point these at Iron Bank:
#   --build-arg BUILD_IMAGE=registry1.dso.mil/ironbank/opensource/nodejs/nodejs20:20
#   --build-arg RUNTIME_IMAGE=registry1.dso.mil/ironbank/opensource/nodejs/nodejs20:20-slim
ARG BUILD_IMAGE=registry.access.redhat.com/ubi9/nodejs-20:latest
ARG RUNTIME_IMAGE=registry.access.redhat.com/ubi9/nodejs-20-minimal:latest

FROM ${BUILD_IMAGE} AS build
USER 0
WORKDIR /src
RUN npm install -g pnpm@9.3.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm typecheck && pnpm test && pnpm build \
 && mkdir -p /out/data && cp -r dist dist-server /out/

FROM ${RUNTIME_IMAGE}
LABEL org.opencontainers.image.title="navifi" \
      org.opencontainers.image.description="NAVIFI mission consequence engine (edge node)" \
      org.opencontainers.image.source="https://github.com/navifi/navifi" \
      mil.dso.ironbank.image.type="application"
WORKDIR /app
COPY --from=build --chown=1001:0 /out/dist ./dist
COPY --from=build --chown=1001:0 /out/dist-server ./dist-server
COPY --from=build --chown=1001:0 /out/data /data
ENV NODE_ENV=production \
    PORT=8810 \
    NAVIFI_RUNTIME_DIR=/data
USER 1001
EXPOSE 8810
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:8810/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/index.mjs"]
