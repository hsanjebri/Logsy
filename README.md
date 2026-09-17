# Logsy

> AI CI failure analyzer for GitHub Actions. When a run fails, Logsy finds the real error in the logs, explains it, and posts **one** concise comment on the pull request.

**Status:** early development (Phase 1: GitHub App webhook receiver). See [`CLAUDE.md`](./CLAUDE.md) for the full spec and roadmap.

## What it will do

- Fetch logs of failed jobs, strip noise, and **redact secrets** before anything is stored or sent to an LLM.
- Locate and **fingerprint** the root error so recurring failures are recognized.
- Explain the cause with **rules first, LLM second** (Anthropic, OpenAI, or local Ollama).
- Post a single, updatable PR comment, and stay silent when confidence is low.
- Detect **flaky tests** and show history in a web dashboard.
- Self-host with `docker compose up`.

## Repository layout

```
apps/        server (webhooks + API), worker (BullMQ jobs), web (Next.js dashboard)
packages/    core (pure log logic), config (env, tsconfig, eslint), github, llm, db, queue
evals/       labeled CI log fixtures + accuracy harness
deploy/      docker-compose, Helm (later)
```

## Development

Requirements: Node.js 22 (`.nvmrc`), pnpm 10, Docker.

```bash
# pnpm, if you don't have it (or: corepack enable pnpm, from an admin shell)
npm install -g pnpm@10

pnpm install
cp .env.example .env

pnpm db:up          # postgres 16 + redis 7
pnpm db:migrate     # apply database migrations
pnpm lint
pnpm typecheck
pnpm test
pnpm build

pnpm dev:server     # webhook receiver on http://localhost:3000
```

To receive real webhooks, follow [docs/github-app-setup.md](./docs/github-app-setup.md).

Integration tests need the Postgres container running. They create and drop their own `logsy_test_*` databases on the server from `TEST_DATABASE_URL`, or from `DATABASE_URL` if that isn't set.

## License

[MIT](./LICENSE)
