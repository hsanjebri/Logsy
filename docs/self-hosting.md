# Self-hosting Logsy

Logsy is meant to run on your own infrastructure. Build logs are some of the most
credential-dense text a company produces, and the only way to be sure they stay yours is
to keep them on your own machines — with a local model, nothing leaves the network at all.

Two supported ways to run it: Docker Compose (one host) and Helm (Kubernetes).

---

## 1. Docker Compose

### Prerequisites

- Docker 24+ with Compose v2
- A GitHub App — follow [github-app-setup.md](./github-app-setup.md) first
- A public HTTPS URL that reaches port 3000, for GitHub's webhooks

### Steps

```bash
git clone https://github.com/hsanjebri/Logsy.git
cd Logsy
cp .env.example .env
```

Fill in `.env`. The minimum for analysis to work:

| Variable                | Where it comes from                                 |
| ----------------------- | --------------------------------------------------- |
| `GITHUB_APP_ID`         | The app's settings page                             |
| `GITHUB_PRIVATE_KEY`    | The generated `.pem`, on one line with `\n` escapes |
| `GITHUB_WEBHOOK_SECRET` | What you set when creating the app                  |
| `ANTHROPIC_API_KEY`     | Only if `LLM_PROVIDER=anthropic`                    |
| `GROQ_API_KEY`          | Only if Groq is used (free tier available)          |
| `GEMINI_API_KEY`        | Only if Gemini is used (free tier available)        |

The dashboard additionally needs `AUTH_SECRET`, `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET`.
Then:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml --profile apps up -d
```

That starts Postgres, Redis, a one-shot migration job, the webhook server (`:3000`), the
worker and the dashboard (`:3002`). Migrations run before the apps start, and the apps wait
for them.

```bash
curl localhost:3000/healthz          # {"status":"ok"}
docker compose -f deploy/docker-compose.yml logs -f worker
```

Point the GitHub App's webhook URL at `https://your-host/webhooks/github` and open a pull
request that fails CI.

Without `--profile apps` the same file starts only Postgres and Redis, which is what
`pnpm db:up` does for local development.

### Upgrading

```bash
git pull
docker compose --env-file .env -f deploy/docker-compose.yml --profile apps up -d --build
```

The migration container applies anything new before the apps come back.

### Running without any LLM

Set `LLM_ENABLED=false`. Logsy then answers only from its rules and its fingerprint cache —
around 80% of common failures in the eval set, at zero cost, with no external calls. It stays
silent on the rest rather than guessing.

### Running against a local model

```bash
LLM_ENABLED=true
LLM_PROVIDER=ollama
LLM_MODEL=llama3.1:8b
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

Nothing then leaves your network.

### Running on free tiers, with a panel of models

Groq and Google AI Studio both offer free API keys. Instead of trusting one model, let
several analyze each failure in parallel:

```bash
LLM_PANEL=groq:openai/gpt-oss-120b,gemini:gemini-flash-latest,groq:qwen/qwen3.8-27b
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=...
```

The panel votes on the failure category. When a majority agrees, its most confident
answer is posted with the other members' evidence merged in. With no majority,
confidence is capped below the comment threshold, so the PR gets the error excerpt
instead of a guess. If a member errors (a free-tier rate limit, a `503` at peak hours),
the others still answer.

Measured with `pnpm evals --llm-only`, which skips the rules and sends all ten fixtures
to the models:

| Setup                          | Category accuracy | Confidently wrong | Silenced |
| ------------------------------ | ----------------- | ----------------- | -------- |
| Groq `gpt-oss-120b` alone      | 70%               | —                 | —        |
| Groq `qwen3.8-27b` alone       | 60%               | —                 | —        |
| Gemini Flash alone             | crashed on a 503  | —                 | —        |
| Panel of two (GPT-OSS, Gemini) | 80%               | 2                 | 0        |
| Panel of three (+ Qwen)        | 70–80%            | **0**             | 5        |

"Confidently wrong" is the mistake that matters: a wrong cause posted on someone's PR.
The panel of three never did that, at the price of staying quiet on some failures it
had right. Two models answer more often; three are safer. In production the rules
resolve most failures first, so the panel only sees what they cannot.

Latency is the slowest member's. On free tiers expect a few seconds per analysis, more
when back-to-back runs hit rate limits and the SDK retries.

---

## 2. Kubernetes (Helm)

The chart in `deploy/helm` deploys the server, worker, dashboard and a pre-upgrade
migration job. It deliberately does **not** package Postgres or Redis: a database is a
stateful thing with its own backup and upgrade story, and bundling one here would only make
it easy to lose. Point the chart at instances you already run.

```bash
kubectl create secret generic logsy-prod \
  --from-literal=GITHUB_WEBHOOK_SECRET=... \
  --from-literal=GITHUB_APP_ID=... \
  --from-file=GITHUB_PRIVATE_KEY=./private-key.pem \
  --from-literal=AUTH_SECRET=... \
  --from-literal=AUTH_GITHUB_ID=... \
  --from-literal=AUTH_GITHUB_SECRET=... \
  --from-literal=ANTHROPIC_API_KEY=...

helm install logsy ./deploy/helm \
  --set config.databaseUrl='postgres://logsy:...@postgres:5432/logsy' \
  --set config.redisUrl='redis://redis:6379' \
  --set config.publicUrl='https://logsy.example.com' \
  --set existingSecret=logsy-prod \
  --set ingress.enabled=true \
  --set ingress.host=logsy.example.com \
  --set web.authUrl='https://logsy.example.com'
```

The ingress routes `/webhooks` to the receiver and everything else to the dashboard, so one
hostname covers both. Images default to `ghcr.io/hsanjebri/logsy-{server,worker,web}` at the
chart's `appVersion`; override `image.registry` and `image.tag` to use your own.

Useful values:

| Value                 | Default | Notes                                  |
| --------------------- | ------- | -------------------------------------- |
| `server.replicas`     | `2`     | Stateless; scale freely                |
| `worker.replicas`     | `1`     | Jobs are distributed by Redis          |
| `worker.concurrency`  | `5`     | Parallel analyses per worker process   |
| `web.enabled`         | `true`  | Set `false` to run without a dashboard |
| `migrations.enabled`  | `true`  | Pre-install/pre-upgrade hook           |
| `config.sentryDsn`    | `''`    | Unset means the SDK is never loaded    |
| `config.otlpEndpoint` | `''`    | Same                                   |

Build the images yourself with the Dockerfiles in `apps/*/Dockerfile`; each takes the repo
root as its build context.

---

## Operating notes

**Scaling.** The server is stateless. The worker's throughput is `replicas × concurrency`;
GitHub's own rate limits usually bind first, and the worker reads `x-ratelimit-remaining`
and delays jobs rather than burning the budget.

**Backups.** Everything worth keeping is in Postgres: failures, analyses, test results and
flaky history. Redis holds only in-flight jobs, which are re-enqueued by GitHub's webhook
redelivery if lost.

**Observability.** Set `SENTRY_DSN` for error reporting and `OTEL_EXPORTER_OTLP_ENDPOINT`
for traces. Both SDKs are imported only when the variable is set, so leaving them empty
costs nothing. Logs are structured JSON via pino.

**Rate limiting.** The receiver counts deliveries per installation (300/minute by default)
and answers `429` with `Retry-After` above that, so one busy account cannot crowd out the
rest. A refused delivery is not recorded, so GitHub's redelivery still gets a chance.

**Resource use.** In steady state the whole stack sits comfortably under 1 GB of RAM. Log
processing is the heaviest step, and it is bounded: logs are trimmed to a character budget
before anything else happens.
