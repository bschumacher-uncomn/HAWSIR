# HAWSIR web app: the static UI served by nginx, with /api proxied to this
# node's mission-api (the only thing the browser talks to).
#   docker build -t hawsir-web .            (from the repository root)
# For accredited builds point the images at Iron Bank equivalents:
#   --build-arg BUILD_IMAGE=registry1.dso.mil/ironbank/opensource/nodejs/nodejs22:22
#   --build-arg RUNTIME_IMAGE=registry1.dso.mil/ironbank/opensource/nginx/nginx-alpine:1.27
ARG BUILD_IMAGE=node:22-alpine
ARG RUNTIME_IMAGE=nginxinc/nginx-unprivileged:1.27-alpine

FROM ${BUILD_IMAGE} AS build
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@9.3.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
# The UI imports the API's view contract and (for in-browser chain verification) the engine's hashing.
COPY brand.json index.html tsconfig.json vite.config.ts ./
COPY public public
COPY src src
COPY mission-api/src/views mission-api/src/views
COPY mission-engine/src mission-engine/src
COPY mission-engine/scenarios mission-engine/scenarios
COPY deploy/nginx deploy/nginx
# Files keep whatever modes they had in the build context; nginx runs as uid 101 and must read them.
RUN pnpm build && chmod -R a+rX,go-w dist deploy/nginx

FROM ${RUNTIME_IMAGE}
LABEL org.opencontainers.image.title="hawsir-web" \
      org.opencontainers.image.description="HAWSIR web app (static UI + /api proxy to mission-api)"
ENV API_UPSTREAM=http://mission-api:8820
COPY --from=build --chown=101:101 /src/deploy/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build --chown=101:101 /src/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz > /dev/null || exit 1
