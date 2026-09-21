# The dashboard. Built from the repository root:
#   docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
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
# Next reads AUTH_SECRET at runtime; the build only needs the code.
RUN pnpm turbo run build --filter=@logsy/web...
# Only production dependencies travel into the final image. CI=1 because pnpm
# refuses to remove a modules directory without a TTY unless it knows it is automated.
RUN CI=1 pnpm prune --prod

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/web

USER node
EXPOSE 3002
CMD ["node", "./node_modules/next/dist/bin/next", "start", "--port", "3002"]
