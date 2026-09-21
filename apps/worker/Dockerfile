# Build the whole workspace once, then ship only what the worker needs.
# Built from the repository root: docker build -f apps/worker/Dockerfile .
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
# Manifests first, so a code change does not re-download the dependency tree.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/github/package.json packages/github/
COPY packages/llm/package.json packages/llm/
COPY packages/queue/package.json packages/queue/
COPY apps/server/package.json apps/server/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY evals/package.json evals/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm turbo run build --filter=@logsy/worker...

# Only production dependencies travel into the final image. `pnpm prune` empties
# every workspace package's node_modules, so reinstall instead: production only,
# scoped to this app and the workspace packages it uses, from the store filled above.
# CI=1 because pnpm refuses to remove a modules directory without a TTY otherwise.
RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules evals/node_modules  && CI=1 pnpm install --frozen-lockfile --prod --offline --filter=@logsy/worker...

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/worker

# Never run as root, and let the process see SIGTERM for a graceful shutdown.
USER node

CMD ["node", "dist/main.js"]
