# Deploying

The app now runs on **PostgreSQL in development and production**. Using the same
database engine in both places removes the "works locally, breaks live" class of
bug. There is no local install to do — a free hosted database gives you a
connection string and that is all you need.

> **Read this first if you already had the app running.** The database changed
> from SQLite to Postgres. Your old local `dev.db` is not carried over, and the
> app will not start until `DATABASE_URL` points at a Postgres database. Step 1
> takes about two minutes. Any profile data you entered locally will need to be
> re-entered (or re-seeded with `npm run db:seed`).

---

## Step 1 — Get a Postgres database (free)

Either works; **Neon** is the simplest if you are not on Vercel yet.

**Neon** — <https://neon.tech> → sign up → create a project → copy the connection
string from the dashboard. It looks like:

```
postgresql://user:password@ep-something.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

**Vercel Postgres** — create the database from your Vercel project's Storage tab
and it sets `DATABASE_URL` for you automatically in production.

Create **two** databases if you want to be tidy: one for local development and
one for production, so experimenting locally never touches live data. One is
fine to start.

---

## Step 2 — Point local development at it

In the project folder:

```bash
cd ~/Documents/GitHub/App
git pull
npm install
```

Put the connection string in `.env` (this file is git-ignored):

```bash
echo 'DATABASE_URL="postgresql://...your string here..."' > .env
```

Create the tables and load the sample profile:

```bash
npm run db:migrate
npm run db:seed
npm run dev:clean
```

`.env.local` still holds your `AUTH_SECRET` and `ANTHROPIC_API_KEY` — leave it
alone. If you ever need to recreate it:

```bash
printf 'AUTH_SECRET="%s"\nAUTH_TRUST_HOST=true\n' "$(openssl rand -base64 32)" > .env.local
echo 'ANTHROPIC_API_KEY="sk-ant-..."' >> .env.local
```

---

## Step 3 — Deploy to Vercel

1. Go to <https://vercel.com>, sign in with GitHub, and **Add New → Project**.
2. Import the `App` repository.
3. **Set the production branch.** Vercel defaults to `main`, which is empty —
   under Settings → Git, set the production branch to
   `claude/student-profile-evaluator-4hw0c4` (or merge that branch into `main`
   first, which is tidier long term).
4. Add the environment variables below, then **Deploy**.

Migrations run automatically: the build command is
`prisma migrate deploy && next build`, so every deploy applies pending
migrations to the production database before building.

---

## Step 4 — Environment variables on Vercel

Set these under **Settings → Environment Variables** (Production, and Preview if
you use it). There are no `.env` files in production — these *are* the config.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | **Yes** | Your **production** Postgres string. Set automatically if you use Vercel Postgres. |
| `AUTH_SECRET` | **Yes** | Generate a **new** one for production: `openssl rand -base64 32`. Do not reuse your local value. |
| `SIGNUP_ALLOWED_EMAILS` | **Strongly recommended** | Comma-separated addresses allowed to register. See the warning below. |
| `ANTHROPIC_API_KEY` | For real evaluations | Without it the app produces clearly-labelled sample output instead. |
| `ANTHROPIC_MODEL` | No | Defaults to `claude-opus-5`. |
| `ANTHROPIC_EFFORT` | No | `low` \| `medium` \| `high` \| `xhigh` \| `max`. Defaults to `medium`. |
| `EVAL_COOLDOWN_SECONDS` | No | Default 20. |
| `EVAL_MAX_PER_HOUR` | No | Default 10 billable evaluations per user per hour. |
| `DATABASE_POOL_MAX` | No | Default 5. Keep small on serverless. |

`AUTH_TRUST_HOST` is not needed on Vercel — it detects the host itself.

### ⚠️ Set `SIGNUP_ALLOWED_EMAILS`

Once deployed, the signup page is reachable by anyone with the URL, and **every
account can spend your Anthropic credits**. Restrict registration to yourself:

```
SIGNUP_ALLOWED_EMAILS=you@example.com
```

Add more addresses separated by commas to let specific people in. Leaving it
empty means open registration — fine locally, risky in production.

Two further safety nets are already in place: evaluations are rate limited per
user (20s cooldown, 10 billable per hour), and you can cap spending in the
Anthropic console under **Settings → Limits**.

---

## After the first deploy

- **Create your account immediately** so you are the first user, then confirm the
  allowlist blocks anything else.
- **Check the deploy log** if the build fails — a migration error almost always
  means `DATABASE_URL` is missing or points somewhere unreachable.
- **Your local and production databases are separate.** Data entered locally does
  not appear on the deployed site.

## If you forget your password

There is no "forgot password" email flow, so this is the recovery path. From
your terminal, with the **production** database URL in front of the command:

```bash
DATABASE_URL="<your Neon connection string>" npm run set-password -- you@example.com
```

It asks for the new password twice (never echoing it, and never putting it in
your shell history), enforces the same 8-character minimum the signup form
does, and clears any login lockout at the same time.

Two things worth knowing:

- Without the `DATABASE_URL` prefix it edits your **local** database, not the
  deployed one. The script prints the account it found before changing
  anything, so read that line.
- Anyone with your database URL can reset any password. That's inherent to a
  connection string being a full-access credential — treat it accordingly, and
  never paste it into anything public.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Locked out after failed logins | Wait 15 minutes, or reset the password with `npm run set-password` (see above), which clears the lock. |
| An evaluation stays "Running…" | It was interrupted (usually a function timeout). It is marked failed automatically after 5 minutes; just run it again. |
| Build fails on `prisma migrate deploy` | `DATABASE_URL` missing/wrong in Vercel, or the database rejects connections. |
| "DATABASE_URL is not set" locally | No `.env` file, or it is in the wrong folder. |
| Login works locally but not deployed | `AUTH_SECRET` not set in Vercel. |
| Signup says "not on the invite list" | Working as intended — add the address to `SIGNUP_ALLOWED_EMAILS` and redeploy. |
| Evaluations return sample output | `ANTHROPIC_API_KEY` not set in Vercel. |
