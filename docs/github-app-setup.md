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
| Callback URL                                           | Leave empty (the dashboard login is added in Phase 7).    |
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
| Checks        | Read-only                          |
| Contents      | Read-only                          |
| Metadata      | Read-only (selected automatically) |
| Pull requests | Read and write                     |

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

The server only needs `GITHUB_WEBHOOK_SECRET`. The App ID and private key are used by the worker from Phase 2 on.

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

## Troubleshooting

| Symptom                                        | Cause and fix                                                                                                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 invalid signature`                        | `GITHUB_WEBHOOK_SECRET` in `.env` doesn't match the app's webhook secret. Restart the server after changing `.env`.                                               |
| Nothing reaches the server                     | The smee client isn't running, or `--target` is wrong. Check the smee page and the client output.                                                                 |
| `password authentication failed`               | Another Postgres is answering on the same port (see the note in step 0), or the password in `DATABASE_URL` differs from the one the data volume was created with. |
| `Invalid environment configuration` on startup | The message lists every missing or invalid variable. Values are never printed.                                                                                    |
| A delivery failed (`422` or `500`)             | Fix the cause, then click **Redeliver**. Failed deliveries are processed again; successful ones are not.                                                          |
