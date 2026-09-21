# Contributing to Logsy

Thanks for taking the time. Bug reports, fixtures and rules are all genuinely useful —
a single real failing CI log is often worth more than a patch.

## Getting set up

```bash
git clone https://github.com/hsanjebri/Logsy.git
cd Logsy
pnpm install
cp .env.example .env

pnpm db:up        # Postgres 16 + Redis 7 in Docker
pnpm db:migrate
pnpm test
```

You need Node 22.12+, pnpm 10 and Docker. Tests that touch the database create and drop
their own `logsy_test_*` databases, so they need `pnpm db:up` running; everything in
`packages/core` runs without it.

To work against a real repository, follow [docs/github-app-setup.md](./docs/github-app-setup.md).

## Before you open a pull request

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

CI runs these plus `pnpm build`, and builds the three Docker images. Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `test:`, `chore:`, `docs:`), and small focused commits are easier to review
than one large one.

## What the code expects of you

- **`packages/core` does no I/O.** No network, no database, no filesystem. It is pure
  functions over strings, which is why it is cheap to test — keep it that way.
- **Strict TypeScript, no `any`** unless a comment justifies it.
- **Zod at every boundary**: webhook payloads, LLM output, environment variables.
- **Tests are not optional** for log processing, redaction, rules, fingerprinting and
  comment formatting.
- **Never commit a secret.** `.env` is gitignored; document every new variable in
  `.env.example`. Fixtures are committed only after redaction.

## The highest-value contributions

### A new rule

Rules resolve common failures without an LLM call — instant, free and deterministic.
Add one to `packages/core/src/rules.ts`:

```ts
{
  id: 'npm-eresolve',
  category: 'dependency_error',
  pattern: /npm ERR! ERESOLVE could not resolve/,
  title: 'npm could not resolve the dependency tree',
  explanation: '...',
  suggestedFix: '...',
  examples: ['npm ERR! ERESOLVE could not resolve'],
}
```

Every rule carries its own `examples`, and the test suite asserts each example matches
that rule and no other. A rule that also matches a neighbouring toolchain's output will
fail the suite — that is the point.

### A log fixture

Real logs are what keeps accuracy honest. Save one from a public failed run:

```bash
# From a repository the app is installed on:
pnpm fixture <owner/repo> <runId>

# Or from any public repository, using the gh CLI:
node evals/collect-fixture.mjs <owner/repo> [ecosystem]
```

It is redacted on the way in. Add a label file next to it in `evals/fixtures/` with the
expected category and root-cause keywords, then check the score did not drop:

```bash
pnpm evals
```

Please only add logs from public repositories, or ones you own.

### Reporting a wrong analysis

Open an issue with the redacted log excerpt and what Logsy said versus what was actually
wrong. Wrong answers cost more trust than silence, so these get priority.

## Project layout

| Path              | What lives there                                             |
| ----------------- | ------------------------------------------------------------ |
| `apps/server`     | Fastify webhook receiver                                     |
| `apps/worker`     | BullMQ jobs: analyze, comment, test reports                  |
| `apps/web`        | Next.js dashboard                                            |
| `packages/core`   | Pure log processing, rules, fingerprinting, comment markdown |
| `packages/github` | Octokit helpers                                              |
| `packages/llm`    | Provider adapters, prompt, output schema                     |
| `packages/db`     | Drizzle schema, migrations, queries                          |
| `packages/queue`  | Queue names and job payload schemas                          |
| `evals`           | Labeled fixtures and the accuracy harness                    |

Changing the database schema means editing `packages/db/src/schema.ts` and then:

```bash
pnpm db:generate   # writes a new file under packages/db/drizzle/
pnpm db:migrate
```

Commit the generated SQL; migrations are applied in order and never edited after the fact.

## Code of conduct

Be decent to each other. Harassment of any kind is not welcome here, and maintainers will
act on it.

## License

By contributing you agree that your work is licensed under the [MIT License](./LICENSE).
