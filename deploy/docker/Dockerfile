# syntax=docker/dockerfile:1
# Override with a reviewed tag@sha256 digest to pin the base image for a release.
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY tsconfig.json LICENSE ./
COPY scripts/ ./scripts/
COPY src/ ./src/
COPY web/ ./web/
RUN pnpm build

FROM dependencies AS production-dependencies
RUN pnpm prune --prod

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    BRIDGE_NODE_MODE=direct \
    BRIDGE_LISTEN_HOST=0.0.0.0 \
    BRIDGE_LISTEN_PORT=8787 \
    BRIDGE_THEME_STORE=/data \
    BRIDGE_ACCESS=public
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/LICENSE ./
COPY --from=build --chown=node:node /app/dist/node.js ./dist/node.js
COPY --from=build --chown=node:node /app/dist/bundled ./dist/bundled
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
USER node
EXPOSE 8787
STOPSIGNAL SIGTERM
CMD ["node", "dist/node.js"]
