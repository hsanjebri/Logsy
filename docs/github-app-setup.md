# GitHub App setup (local development)

This guide creates a **private development GitHub App**, points its webhooks at your machine through [smee.io](https://smee.io), and verifies that installing it writes rows to your local database.

Time: about 10 minutes.

## 0. Prerequisites

```bash
pnpm install
cp .env.example .env    # if you haven't already
pnpm db:up              # postgres + redis
pnpm db:migrate         # creates all tables
```

> **Port 5432 already in use?** If a Postgres installed directly on your machine (not in Docker) is listening on 5432, connections to `localhost:5432` reach it instead of the container. Set `POSTGRES_PORT=5434` in `.env`, change the port in `DATABASE_URL` to match, and run `pnpm db:up` again.

## 1. Create a webhook proxy channel

GitHub can't reach `localhost`, so a smee channel relays webhooks to you.

1. Open <https://smee.io/new>.
2. Copy the channel URL (for example `https://smee.io/AbCdEf123456`). Keep this page open; it shows every delivery, which helps with debugging.

## 2. Generate a webhook secret

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put it in `.env`:

```dotenv
GITHUB_WEBHOOK_SECRET=<the value you just generated>
```

## 3. Create the GitHub App

Open <https://github.com/settings/apps/new> (for an organization, go to **Organization settings → Developer settings → GitHub Apps → New GitHub App**).

| Field                                                  | Value                                                     |
| ------------------------------------------------------ | --------------------------------------------------------- |
| GitHub App name                                        | `Logsy Dev (<your-username>)`. Names are globally unique. |
| Homepage URL                                           | `https://github.com/hsanjebri/Logsy`                      |
| Callback URL                                           | `http://localhost:3002/api/auth/callback/github`          |
| Expire user authorization tokens                       | Leave the default.                                        |
| Request user authorization (OAuth) during installation | Unchecked                                                 |
| Webhook → Active                                       | ✅ Checked                                                |
| Webhook URL                                            | Your smee channel URL                                     |
| Webhook secret                                         | The secret from step 2                                    |

### Repository permissions

Set these and leave everything else at **No access**:

| Permission    | Access                             |
| ------------- | ---------------------------------- |
| Actions       | Read-only                          |
| Checks        | Read and write                     |
| Contents      | Read-only                          |
| Metadata      | Read-only (selected automatically) |
| Pull requests | Read and write                     |

Checks needs **write** so Logsy can publish its analysis as a check run, which is what
puts the explanation on the lines of the diff. Read-only still works: the check run is
skipped and the pull request comment is unaffected. Changing a permission on an existing
app asks each installation to approve it, under the repository's settings.

### Subscribe to events

- ✅ **Workflow run**

`installation` and `installation_repositories` events are delivered to every GitHub App automatically, so they don't appear in this list.

### Where can this GitHub App be installed?

- **Only on this account**

Click **Create GitHub App**.

## 4. Collect the App ID and private key

On the app's settings page:

1. Copy the **App ID** (a number near the top) into `.env`:
   ```dotenv
   GITHUB_APP_ID=1234567
   ```
2. Scroll to **Private keys → Generate a private key**. A `.pem` file downloads. Store it **outside the repository** (`*.pem` is gitignored anyway).
3. Convert it to a single line with literal `\n` sequences and put it in `.env`:

   **PowerShell**

   ```powershell
   (Get-Content C:\path\to\logsy-dev.private-key.pem) -join '\n'
   ```

   **bash / zsh**

   ```bash
   awk 'NF { sub(/\r/, ""); printf "%s\\n", $0 }' /path/to/logsy-dev.private-key.pem
   ```

   ```dotenv
   GITHUB_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n
   ```

The server only needs `GITHUB_WEBHOOK_SECRET`. The worker needs the App ID and private key to call the API.

## 5. Run the server and the webhook relay

In two terminals:

```bash
# Terminal 1: build dependencies and start the server with reload (http://localhost:3000)
pnpm dev:server
```

```bash
# Terminal 2: forward smee deliveries to the local server
pnpm dlx smee-client --url https://smee.io/<your-channel> --target http://localhost:3000/webhooks/github
```

```bash
# Terminal 3: the worker that fetches logs for failed runs
pnpm dev:worker
```

Check that the server is up:

```bash
curl http://localhost:3000/healthz
# {"status":"ok"}
```

## 6. Install the app on a test repository

1. On the app's settings page, click **Install App**, then **Install** next to your account.
2. Choose **Only select repositories** and pick a test repository.

The server logs `installation synced`, and the smee page shows the delivery.

## 7. Verify the database

```bash
docker exec -it logsy-postgres-1 psql -U logsy -d logsy -c "select github_installation_id, account_login, account_type, suspended_at from installations;" -c "select github_repo_id, full_name, private from repositories;" -c "select delivery_id, event, action, status from webhook_deliveries order by received_at desc limit 5;"
```

You should see one installation, your selected repositories, and a `processed` delivery.

Also try these:

| Action on GitHub                                            | Expected result                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Installation settings → add or remove a repository          | `repositories` rows added or removed                                            |
| Installation settings → Suspend                             | `installations.suspended_at` is set                                             |
| Unsuspend                                                   | `suspended_at` is cleared                                                       |
| Uninstall                                                   | The installation and all of its data are deleted                                |
| App settings → Advanced → Recent Deliveries → **Redeliver** | The server responds `200 {"status":"duplicate"}` and nothing is processed twice |

## 8. Trigger a failing run

Add a workflow to the test repository that always fails, push it, and watch the three terminals:

```yaml
# .github/workflows/always-fails.yml
name: Always fails
on: [push, pull_request]
jobs:
  boom:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Running tests"
      - run: exit 1
```

The server logs `queued analyze-run` and the worker logs `stored failure` with the size of the log it fetched. Then:

```bash
docker exec -it logsy-postgres-1 psql -U logsy -d logsy -c "select w.workflow_name, w.github_run_id, f.job_name, f.step_name, f.log_chars_original from failures f join workflow_runs w on w.id = f.workflow_run_id order by f.created_at desc limit 5;"
```

The stored excerpt is redacted, and the category and fingerprint stay as placeholders until Phase 3 and 4 fill them in.

## 9. Save a log as a test fixture (optional)

```bash
pnpm fixture hsanjebri/<test-repo> <runId> <installationId>
```

The logs of that run's failed jobs are redacted and written to `evals/fixtures/`. The command refuses to write a file if anything that looks like a secret survives redaction. The installation id appears in the URL of the app's installation settings page.

## 10. Sign in to the dashboard

The dashboard signs people in with this same GitHub App, so it needs the app's OAuth
credentials.

1. On the app’s settings page, copy the **Client ID** and **Generate a new client secret**.
2. Put both in `.env`, with a session secret:

   ```dotenv
   AUTH_GITHUB_ID=Iv1.xxxxxxxxxxxx
   AUTH_GITHUB_SECRET=the-client-secret
   AUTH_SECRET=generate-with-the-command-below
   ```

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

3. Check the app’s **Callback URL** is `http://localhost:3002/api/auth/callback/github`.
4. Start it:

   ```bash
   pnpm dev:web   # http://localhost:3002
   ```

You see exactly the repositories your own GitHub account can reach through a Logsy
installation. That list is read from GitHub on each visit and never stored, so revoking
access takes effect immediately.

## 11. Flaky test detection (optional)

Logsy reads JUnit XML from a run’s **artifacts**. A test counts as flaky when the same
commit both passed and failed it — across attempts or jobs — so your change cannot be
the difference.

Make your workflow upload its reports, with a name containing `test`, `junit`, `report`
or `result`:

```yaml
- name: Run tests
  run: pytest --junitxml=reports/junit.xml # or: vitest --reporter=junit, mvn test, …

- name: Upload test results
  if: always() # the reports matter most when the tests failed
  uses: actions/upload-artifact@v4
  with:
    name: test-results
    path: reports/*.xml
```

Then, to see a flip: let a run fail, and press **Re-run failed jobs** until it passes.
Both attempts share the commit, so the test contradicts itself and is flagged.

```bash
docker exec -it logsy-postgres-1 psql -U logsy -d logsy -c "select suite, test_name, flip_count, status from flaky_tests order by flip_count desc;"
```

The dashboard lists them under **Flaky tests**, and the PR comment names one when it
failed in that run.

## Troubleshooting

| Symptom                                        | Cause and fix                                                                                                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 invalid signature`                        | `GITHUB_WEBHOOK_SECRET` in `.env` doesn't match the app's webhook secret. Restart the server after changing `.env`.                                               |
| Nothing reaches the server                     | The smee client isn't running, or `--target` is wrong. Check the smee page and the client output.                                                                 |
| `password authentication failed`               | Another Postgres is answering on the same port (see the note in step 0), or the password in `DATABASE_URL` differs from the one the data volume was created with. |
| `Invalid environment configuration` on startup | The message lists every missing or invalid variable. Values are never printed.                                                                                    |
| A delivery failed (`422` or `500`)             | Fix the cause, then click **Redeliver**. Failed deliveries are processed again; successful ones are not.                                                          |
| The worker exits at startup                    | It needs `GITHUB_APP_ID` and `GITHUB_PRIVATE_KEY`. The error names what is missing.                                                                               |
| A run is queued but nothing happens            | The worker isn't running, or Redis is unreachable. Check `docker compose ps` and the worker output.                                                               |
