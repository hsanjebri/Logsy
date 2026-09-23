# CLAUDE.md — Logsy: AI CI Failure Analyzer (GitHub App)

> Project name: **Logsy** (use it consistently across the repo, packages (`@logsy/*`), Docker images, and the GitHub App).
> This file is the single source of truth for this project. Read it fully before doing anything.

---

## 0. Your role and how you must work

You are a senior staff engineer building a production-quality, open-source developer tool with me (Hsan, a full-stack engineer). The goal is a project real developers install and use, and a portfolio piece that shows strong backend, systems, and AI-engineering skills.

**Working rules (follow strictly):**

1. **Work phase by phase** (see section 9). Never start the next phase until I say "go".
2. **At the start of each phase:** write a short plan (files to create/change, decisions, risks). Wait for my OK only if something is ambiguous or a decision is expensive to reverse; otherwise proceed.
3. **At the end of each phase:** run typecheck, lint, and tests. All must pass. Then give me a summary: what was built, how to run/verify it, what I need to do manually, and any known limitations.
4. **Tests are not optional.** Every non-trivial module (especially log processing, fingerprinting, rules, comment formatting) gets unit tests with Vitest.
5. **Never commit secrets.** Use `.env` (gitignored) and keep `.env.example` up to date with every variable documented.
6. **Small, focused commits** using Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`).
7. **Prefer simple, boring, well-typed code.** Strict TypeScript, no `any` unless justified in a comment. Validate all external input (webhooks, LLM output, env) with Zod.
8. **Ask me instead of guessing** when a requirement is unclear or a GitHub/UI step needs to be done by a human.
9. If you discover this spec is wrong or suboptimal, say so and propose a change. Update this file when we agree on changes.

---

## 1. Product summary

**Problem:** When CI fails, developers scroll through thousands of log lines to find the real cause, can't tell flaky tests from real breakages, and see the same failures repeat.

**Solution:** A GitHub App that, when a GitHub Actions run fails:

1. Fetches the logs of the failed jobs.
2. Cleans, trims, and **redacts secrets** from the logs.
3. Finds the real error region and **fingerprints** it.
4. Explains the cause using **rules first, LLM second**, with the PR diff as context.
5. Posts **one** concise PR comment (updated on later runs, never spammed).
6. Tracks test results over time and detects **flaky tests**.
7. Shows history, recurring failures, and flaky tests in a web dashboard.

**Product principles:**
- Zero-config: install the app, and it works on the next failure.
- No noise: one comment per PR, short, and silent when confidence is low.
- Fast: comment within ~60 seconds of failure.
- Private: minimal permissions, secret redaction, bring-your-own LLM key, local Ollama mode.
- Self-hostable: `docker compose up` runs everything.

---

## 2. Tech stack (decided)

| Layer | Choice |
|---|---|
| Language | TypeScript (strict), Node.js 22 LTS |
| Monorepo | pnpm workspaces + Turborepo |
| Webhook/API server | Fastify |
| GitHub | `@octokit/app`, `@octokit/webhooks`, `@octokit/rest` |
| Queue | Redis + BullMQ |
| Database | PostgreSQL 16 + Drizzle ORM (+ drizzle-kit migrations) |
| Validation | Zod |
| LLM | Provider interface with adapters: Anthropic (default), OpenAI, Ollama |
| Dashboard | Next.js (App Router) + Tailwind + shadcn/ui |
| Auth (dashboard) | GitHub OAuth via Auth.js |
| Logging | pino (structured JSON) |
| Observability | OpenTelemetry (traces) + Sentry (errors), both optional via env |
| Testing | Vitest; real CI log fixtures |
| Lint/format | ESLint + Prettier |
| Containers | Docker, docker-compose; Helm chart in a later phase |
| CI for this repo | GitHub Actions (lint, typecheck, test, build) |
| Local webhooks | smee.io client |

Do not introduce other major dependencies without explaining why.

---

## 3. Repository structure

```
logsy/
├─ apps/
│  ├─ server/          # Fastify: webhook receiver, internal API for dashboard
│  ├─ worker/          # BullMQ workers: fetch logs, analyze, comment, test reports
│  └─ web/             # Next.js dashboard
├─ packages/
│  ├─ core/            # Pure logic: log cleaning, error locating, redaction, fingerprinting, rules, comment formatting
│  ├─ github/          # Octokit app setup, typed helpers (jobs, logs, artifacts, PRs, comments)
│  ├─ llm/             # Provider interface + anthropic/openai/ollama adapters, prompts, output schema
│  ├─ db/              # Drizzle schema, migrations, query helpers
│  ├─ queue/           # Queue names, job payload schemas, BullMQ connection
│  └─ config/          # Zod-validated env loading, shared tsconfig/eslint
├─ evals/
│  ├─ fixtures/        # Real failed CI logs + labels (JSON)
│  └─ run-evals.ts     # Accuracy harness
├─ deploy/
│  ├─ docker-compose.yml
│  └─ helm/            # later phase
├─ .github/workflows/ci.yml
├─ .env.example
├─ CLAUDE.md
└─ README.md
```

Rule: `packages/core` must have **no I/O** (no network, DB, or filesystem). It's pure functions, so it's easy to test.

---

## 4. Architecture and data flow

```
GitHub ──webhook──▶ server (verify signature, dedupe, store, enqueue) ──▶ Redis/BullMQ
                                                                          │
                ┌─────────────────────────────────────────────────────────┘
                ▼
worker: analyze-run job
  1. Load run; list jobs (filter=latest); keep failed jobs only
  2. For each failed job: download job logs (plain text)
  3. core: strip ANSI + timestamps → split into steps → find failing step
  4. core: locate error region → trim to token budget → redact secrets
  5. core: fingerprint normalized error
  6. DB: fingerprint seen before with a good analysis? → reuse
  7. core: rules engine match? → rule-based analysis
  8. else llm: analyze (trimmed log + step name + workflow file + PR diff summary) → JSON validated by Zod
  9. DB: store failure + analysis (+ tokens, cost, latency, model)
 10. enqueue comment job
worker: post-comment job → find associated PR → upsert single comment
worker: test-report job → download JUnit artifacts → store results → flaky detection
```

**Server responsibilities:** verify `X-Hub-Signature-256` against the raw body, store the `X-GitHub-Delivery` ID with a unique constraint (idempotency), enqueue, and return `202` fast. No heavy work in the request.

**Events handled:**
- `workflow_run` with `action: completed`:
  - `conclusion: failure` → enqueue `analyze-run`
  - `conclusion: success` → enqueue `test-report` (for flaky history) and resolve/update the existing comment to show that the PR is now passing
- `installation` and `installation_repositories` → sync installations and repos
- Ignore everything else, logging at debug level.

**Queue settings:** retries with exponential backoff; respect GitHub rate limits (read `x-ratelimit-remaining`, delay the job if low); per-installation concurrency limit; dead-letter handling through failed-job retention.

---

## 5. GitHub integration details

**App permissions (minimum):**
- Actions: **write** (only to re-run failed jobs when `autoRerun` is on; read is enough otherwise)
- Checks: **write** (the check run carrying inline annotations; read-only degrades to comment only)
- Contents: **read** (workflow files, diff context)
- Pull requests: **write** (comments)
- Metadata: **read**

**Subscribed events:** `workflow_run`, `installation`, `installation_repositories`.

**Key API calls:**
- List jobs: `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs?filter=latest`
- Job logs: `GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs` (redirects to plain text)
- Artifacts: `GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts` → download the zip → extract JUnit XML
- Find the PR: use `workflow_run.pull_requests` from the payload; if empty (for example, forks), use `GET /repos/{owner}/{repo}/commits/{sha}/pulls`
- PR diff: `GET /repos/{owner}/{repo}/pulls/{number}/files` (cap files and patch size; send a summary, not the full diff)
- Comments: create or update issue comments on the PR

**Single comment rule:** every comment includes the hidden marker `<!-- logsy:comment -->`. Find the existing comment containing the marker and update it; create one only if none exists.

**Auto re-run:** when a repository sets `autoRerun` and a failure looks flaky (the analysis says so, or a test in the run is already known flaky), re-run the failed jobs once with `POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs`, and say so in the comment. Only on `run_attempt === 1`, so a re-run can never trigger another. Off by default: it spends the repository's CI minutes.

**Check run:** alongside the comment, publish one check run named `Logsy` per commit (update it on a re-run, found by name and head SHA). Its conclusion is always `neutral` — Logsy explains failures, it never adds one. Annotations go on the likely files that the pull request actually changed and whose line is known; everything else stays in the comment. Per-repository setting: `checksEnabled`.

**Local development:** document how to create the GitHub App manually (I'll do the clicks), where to put the App ID, private key, and webhook secret in `.env`, and how to forward webhooks with smee.

---

## 6. Log processing (`packages/core`) — the most important part

Implement as pure, well-tested functions:

1. **`stripAnsi(log)`** and **`stripTimestamps(log)`**: GitHub prefixes lines with ISO timestamps.
2. **`splitSteps(log)`**: use `##[group]` / `##[endgroup]` markers and step boundaries.
3. **`findErrorRegion(steps)`**: prioritize `##[error]` lines, `Error:`, `FAILED`, `Exception`, stack traces, `npm ERR!`, `BUILD FAILURE`, `exit code`, and `Process completed with exit code`. Return the surrounding window (for example, 40 lines before and 20 after), merge overlapping windows, and prefer the **first root error** over cascaded follow-up errors.
4. **`trimToBudget(text, maxChars)`**: keep the error region, the head of the failing step, and the tail. Mark cuts with `... [N lines omitted] ...`.
5. **`redactSecrets(text)`**: GitHub tokens (`ghp_`, `gho_`, `ghs_`, `github_pat_`), AWS keys, private key blocks, JWTs, bearer tokens, `password=`/`secret=`/`token=` values, connection strings with credentials, emails, and high-entropy strings. Replace them with `[REDACTED:type]`. **Redaction runs before anything is stored or sent to an LLM.** This needs thorough tests.
6. **`normalizeError(text)`**: remove line and column numbers, absolute paths, hex IDs, UUIDs, timestamps, durations, ports, and temp directories.
7. **`fingerprint(normalized)`**: SHA-256 of the normalized top error lines plus the failing step name.
8. **Rules engine**: a declarative list `{ id, category, pattern (RegExp), title, explanation, suggestedFix }`. Start with ~20 rules: npm ERESOLVE, lockfile out of sync, node version mismatch, OOM / exit 137, timeout, missing env var/secret, Docker pull rate limit, network ETIMEDOUT/ECONNRESET, Maven dependency resolution, Gradle daemon crash, Java version mismatch, TypeScript compile errors, ESLint failures, Jest/Vitest assertion failure, pytest failure, disk full, permission denied, cache restore failure, test report parse errors, and cancelled/superseded runs.

**Failure categories (enum):** `test_failure`, `build_error`, `type_error`, `lint_error`, `dependency_error`, `infrastructure`, `timeout`, `out_of_memory`, `configuration`, `flaky`, `unknown`.

---

## 7. LLM layer (`packages/llm`)

**Provider interface:**
```ts
interface LlmProvider {
  name: 'anthropic' | 'openai' | 'ollama';
  analyze(input: AnalysisInput): Promise<{ result: AnalysisResult; usage: Usage; latencyMs: number }>;
}
```
Select the provider with `LLM_PROVIDER` and the model with `LLM_MODEL` (never hardcode model names in logic). Support an optional cheaper `LLM_MODEL_FAST` for short, simple logs.

**Output schema (Zod), which the model must return:**
```ts
{
  category: FailureCategory,
  title: string,              // max ~80 chars
  rootCause: string,          // 1–3 sentences, plain language
  evidence: string[],         // exact log lines supporting the conclusion (max 5)
  likelyFiles: { path: string; line?: number; reason: string }[],
  suggestedFix: string,       // concrete steps; code snippet allowed
  isLikelyFlaky: boolean,
  confidence: number          // 0..1
}
```
- Use structured output (tool use / JSON mode). Validate with Zod. On an invalid response, retry once with the validation error, then fall back to `unknown`.
- The system prompt must say: only use the given evidence, never invent file paths that aren't in the log or diff, say "unknown" rather than guess, and keep it concise.
- Store the prompt version (`PROMPT_VERSION` constant) with every analysis.
- Track input/output tokens, estimated cost, and latency per analysis.
- **Comment gating:** if `confidence < 0.5`, post only the extracted error excerpt with no speculative cause.

---

## 8. Database schema (`packages/db`, Drizzle)

Tables (add indexes and foreign keys as appropriate):

- `installations` — id, github_installation_id (unique), account_login, account_type, created_at, suspended_at
- `repositories` — id, installation_id, github_repo_id (unique), full_name, private, settings (jsonb: `{ enabled: boolean, commentMode: "single" | "off", llmEnabled: boolean }`), created_at
- `webhook_deliveries` — delivery_id (PK), event, action, received_at, processed_at, status
- `workflow_runs` — id, repository_id, github_run_id, run_attempt, workflow_name, head_sha, head_branch, event, conclusion, pr_number, html_url, created_at; unique(github_run_id, run_attempt)
- `failures` — unique(workflow_run_id, github_job_id); id, workflow_run_id, github_job_id, job_name, step_name, category, fingerprint, error_excerpt (redacted), log_chars_original, log_chars_trimmed, created_at
- `analyses` — id, failure_id, fingerprint, source (`rule` | `llm` | `cache`), rule_id, provider, model, prompt_version, result (jsonb), confidence, input_tokens, output_tokens, cost_usd, latency_ms, created_at
- `pr_comments` — id, repository_id, pr_number, github_comment_id, last_run_id, updated_at; unique(repository_id, pr_number)
- `test_results` — id, repository_id, workflow_run_id, head_sha, suite, test_name, status (`passed` | `failed` | `skipped`), duration_ms, created_at
- `flaky_tests` — id, repository_id, suite, test_name, flip_count, last_flipped_at, first_detected_at, status (`active` | `resolved`)
- `feedback` — id, analysis_id, github_user, verdict (`helpful` | `wrong`), note, created_at

**Flaky detection rule:** a test is flaky if, for the same `head_sha`, it has both `passed` and `failed` results (across run attempts or jobs). Also flag tests with a high pass/fail flip rate on the default branch over the last N runs.

---

## 9. Phases (one at a time; stop after each)

### Phase 0 — Scaffolding
- pnpm + Turborepo monorepo with the structure above, shared tsconfig (strict), ESLint, Prettier, and Vitest.
- `packages/config`: Zod-validated env with a clear error on missing variables.
- `deploy/docker-compose.yml`: postgres, redis (apps are added later).
- `.github/workflows/ci.yml`: install, lint, typecheck, test, build.
- `.env.example`, a basic README, and a LICENSE (MIT).
- **Done when:** `pnpm install && pnpm lint && pnpm typecheck && pnpm test` pass, and `docker compose up` starts postgres and redis.

### Phase 1 — GitHub App and webhook receiver
- Step-by-step `docs/github-app-setup.md` (permissions, events, smee, env vars).
- Fastify server with a raw-body signature check, delivery dedupe, the `/webhooks/github` route, and a `/healthz` route.
- Handle `installation*` events → upsert installations and repos.
- Drizzle schema plus the first migration for all tables.
- **Done when:** installing the app on a test repo creates DB rows, and an invalid signature returns 401 (tested).

### Phase 2 — Queue, worker, and log fetching
- `packages/queue` with typed job schemas; enqueue `analyze-run` on failed `workflow_run`.
- Worker: list failed jobs, download logs, store the run, basic retries, and rate-limit awareness.
- A script to save fetched logs as fixtures (redacted) into `evals/fixtures/`.
- **Done when:** a deliberately failing workflow in a test repo produces stored failures with raw log sizes logged.

### Phase 3 — Log processing core
- Implement everything in section 6 except the rules engine, with **extensive tests** using at least 10 real fixture logs (Node, Java/Maven, Gradle, Python, Docker).
- Redaction test suite covering every secret type.
- **Done when:** tests pass and each fixture yields a sensible error excerpt under the budget.

### Phase 4 — Fingerprinting, cache, and rules engine
- Fingerprint plus cache lookup, and the rules engine with ~20 rules and tests for each.
- **Done when:** repeated identical failures reuse the analysis, and known patterns resolve without an LLM call.

### Phase 5 — LLM analysis and eval harness
- Provider interface plus Anthropic, OpenAI, and Ollama adapters; prompt; Zod output; retry/fallback; usage tracking.
- `evals/`: labeled fixtures (`expected_category`, `expected_root_cause_keywords`) and `pnpm evals`, which prints category accuracy, keyword hit rate, average confidence, average tokens, and cost. Save results to `evals/results/<date>.json`.
- **Done when:** evals run end-to-end and report a baseline score.

### Phase 6 — PR comment
- Markdown comment formatter in `core` (tested with snapshot tests): title, category badge, root cause, collapsible evidence, likely files linked to the PR diff, suggested fix, "seen N times" if recurring, feedback links, and a footer.
- Upsert logic using the hidden marker; the comment switches to a "✅ now passing" state on success.
- Handle a missing PR (push to a branch) by skipping the comment but still storing the analysis.
- **Done when:** a failing PR gets exactly one well-formatted comment that updates on re-runs.

### Phase 7 — Dashboard
- Next.js + Auth.js GitHub login; show only repos the user can access through the installation.
- Pages: repo list; repo overview (failure trend chart, top recurring fingerprints, category breakdown); run detail (failures plus analyses); flaky tests list; settings (enable/disable, LLM on/off).
- The internal API lives in the server app, protected by session.
- **Done when:** I can log in and browse real data from my test repos.

### Phase 8 — Flaky test detection
- `test-report` job: find JUnit XML artifacts, parse them, and store results; flaky detection logic plus tests.
- Mention flaky tests in the PR comment ("`OrderServiceTest.retries` is known flaky: 7 flips in 30 days").
- **Done when:** a test that fails then passes on re-run for the same SHA gets flagged.

### Phase 9 — Feedback, production readiness, and launch
- Feedback endpoint plus links in the comment; show feedback stats in the dashboard.
- Dockerfiles for server, worker, and web; full `docker-compose.yml` for self-hosting; basic Helm chart.
- OpenTelemetry and Sentry (optional via env); structured logs; graceful shutdown.
- Security pass: dependency audit, secrets never logged, payload size limits, per-installation rate limits.
- A polished README: problem, demo GIF placeholder, features, architecture diagram (Mermaid), quick start, self-hosting, privacy section, eval results, and roadmap. Add CONTRIBUTING.md.
- **Done when:** a fresh clone runs with `docker compose up` following only the README.

---

## 10. Definition of 10/10 quality

- Strict types everywhere and Zod at every boundary.
- Core logic is pure and covered by tests; real-world fixtures are in the repo.
- No secret ever reaches the DB, logs, or an LLM unredacted.
- One comment per PR, fast and short, and silent when unsure.
- Measurable: eval scores, token cost per analysis, and helpful-feedback rate.
- Anyone can self-host in under 10 minutes.

---

## 11. Out of scope for now

GitLab/CircleCI support, auto-fix PRs, billing, multi-tenant SaaS admin, and Slack integration. Keep interfaces clean so these can be added later.
