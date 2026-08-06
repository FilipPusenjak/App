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
postgresql://user:password@ep-something.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full
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

## Step 2b — Check it before you ship it

```bash
npm run test:e2e:prod
```

This builds the app the way the host will and drives the full student journey
through a real browser against `next start`. It is the only check that exercises
what actually gets deployed: `next dev` and a production build are not the same
app — the build minifies, prerenders what it can, and hides the error detail dev
shows you, so a green `npm run test:e2e` is not evidence the shipped bundle
works. Run the rest too if you have a minute:

```bash
npm run lint && npx tsc --noEmit && npm test
```

---

## Step 3 — Deploy to Vercel

1. Go to <https://vercel.com>, sign in with GitHub, and **Add New → Project**.
2. Import the `App` repository.
3. **Nothing to change about the branch.** `main` is the production branch and
   is up to date, which is what Vercel defaults to. Work continues on feature
   branches, which Vercel builds as previews; merge into `main` to release.
4. Add the environment variables below, then **Deploy**.

Migrations run automatically: `npm run build` is
`prisma generate && prisma migrate deploy && next build`, so every deploy
regenerates the Prisma client and applies pending migrations to the production
database before building. Nothing to configure — Vercel runs `npm run build`.

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
| `ANTHROPIC_FOLLOWUP_MODEL` | No | Model for anchored follow-up runs. Defaults to `claude-sonnet-5`; `off` runs every evaluation on the full model. See below. |
| `ANTHROPIC_FOLLOWUP_EFFORT` | No | Defaults to the same effort as a baseline run. |
| `ANTHROPIC_CACHE_TTL` | No | `1h` \| `5m` \| `off`. Defaults to `1h`. Cache **writes** cost more than plain input, so this is a bet on how often you re-run — see `.env.example`. |
| `ANTHROPIC_PROJECTION_MODEL` | No | Projections run on a cheaper model. Defaults to `claude-sonnet-5`. |
| `ANTHROPIC_PROJECTION_EFFORT` | No | Defaults to `low`. |
| `EVAL_COOLDOWN_SECONDS` | No | Default 20. |
| `EVAL_MAX_PER_HOUR` | No | Default 10 billable evaluations per user per hour. |
| `PROJECTION_COOLDOWN_SECONDS` | No | Default 10. Projections have their own budget so plan-tinkering can't lock you out of a real evaluation. |
| `PROJECTION_MAX_PER_HOUR` | No | Default 20. |
| `MAX_FAILED_LOGINS` | No | Default 10 before the account locks. |
| `LOGIN_LOCKOUT_MINUTES` | No | Default 15. There is no reset email, so a lockout is waited out or cleared with `npm run set-password`. |
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

### What an evaluation costs, and why the second one costs less

The first evaluation of a student runs on the full model and sets the
calibration. Every later run is a **follow-up**: the previous scores go back in
as an anchor, unchanged resume items carry their assessments forward instead of
being re-judged, and the model answers "what did this change" rather than
"judge this from nothing". That smaller job runs on a cheaper model.

The anchor is the whole reason this is safe. An anchored run is reproducing a
calibration the strong model already set, not inventing its own — so the cheaper
model is used **only** where the anchor is intact. Two cases go back to the full
model on their own:

- **No previous real run.** Nothing to anchor to, and this run becomes the
  baseline every later one inherits.
- **A prompt version redefined a score**, releasing its anchor. That number has
  to be worked out from scratch, which is the judgement worth paying for.

You can also ask for a full run from the evaluations page ("Run a full
evaluation instead"), and any run judged by a different model than the one
before it says so on its own page. Set `ANTHROPIC_FOLLOWUP_MODEL=off` to turn
the whole behaviour off.

### The 60-second ceiling

Both AI routes declare `maxDuration = 60` (`app/api/evaluate/route.ts`,
`app/api/project/route.ts`). That is the whole request budget on a serverless
host — model call, retry and all — and an evaluation of a full profile runs
close to it.

When it overruns, the platform kills the function mid-flight. The run is lost,
the tokens are still billed, and the row sits on "Running…" until the sweep
marks it failed and invites you to run it again. Nothing is corrupted and the
profile is untouched, but it is a wasted call.

If your plan allows a longer limit, raising both numbers is a one-line change
each — the retry budget follows `maxDuration` automatically. **Check your plan's
actual ceiling first: setting a value above it does not fail the build, it just
gets capped, so you would believe you had headroom you do not have.** Dropping
`ANTHROPIC_EFFORT` to `low` is the other lever; it trades thoroughness for speed.

### What is already hardened

You do not need to configure any of this — it ships in the code:

- **Security headers** on every response (`next.config.ts`): `frame-ancestors
  'none'` and `X-Frame-Options: DENY` so no other site can iframe a signed-in
  student and trick them into clicking through their own forms; `nosniff`;
  `Referrer-Policy` so evaluation URLs never leak off-site; a `Permissions-Policy`
  refusing camera, microphone and location; and HSTS for a year.
- **Every database read is scoped to the signed-in account** through the
  ownership helpers, and nothing is public or shareable.
- **Rate limits** per user on evaluations and projections, and a login lockout
  after repeated failures.

The one thing NOT yet configured is a script-src Content-Security-Policy — it
needs per-request nonces threaded through the root layout. Worth doing, not a
blocker.

---

## After the first deploy

- **Create your account immediately** so you are the first user, then confirm the
  allowlist blocks anything else.
- **One account can hold several students.** If you are running this for more
  than one person, add them under **Students**; each keeps a separate profile,
  target list, plans and evaluation history, and everything else in the app acts
  on whichever student is selected.
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
| Pages error after a `git pull`, mentioning an unknown field or argument | The generated Prisma client is stale — a pulled schema change added columns your local client does not know about. `npm run dev` now regenerates it first; if you started the server another way, run `npm run db:sync`. |
| `SECURITY WARNING: The SSL modes 'prefer', 'require'...` on startup | Your `DATABASE_URL` uses `sslmode=require`. Change it to `sslmode=verify-full`, which is what the driver does today anyway — see `.env.example`. Left alone it becomes a real downgrade when `pg` v9 lands. |
| Locked out after failed logins | Wait 15 minutes, or reset the password with `npm run set-password` (see above), which clears the lock. |
| A page errors with Prisma P2021 "table does not exist" | The database is behind the code. `npm run db:deploy` applies pending migrations; `npm run dev` and `npm run build` now do it for you. |
| An evaluation stays "Running…" | It was interrupted (usually a function timeout). It is marked failed automatically after 5 minutes; just run it again. |
| Build fails on `prisma migrate deploy` | `DATABASE_URL` missing/wrong in Vercel, or the database rejects connections. |
| "DATABASE_URL is not set" locally | No `.env` file, or it is in the wrong folder. |
| Login works locally but not deployed | `AUTH_SECRET` not set in Vercel. |
| Signup says "not on the invite list" | Working as intended — add the address to `SIGNUP_ALLOWED_EMAILS` and redeploy. |
| Evaluations return sample output | `ANTHROPIC_API_KEY` not set in Vercel. |
