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
| `ANTHROPIC_API_KEY` | For real Deep Reviews | Without it the app produces clearly-labelled sample output instead. |
| `ANTHROPIC_MODEL` | No | Defaults to `claude-opus-5`. |
| `ANTHROPIC_EFFORT` | No | `low` \| `medium` \| `high` \| `xhigh` \| `max`. Defaults to `medium`. |
| `ANTHROPIC_FOLLOWUP_MODEL` | No | Model for anchored follow-up runs. Defaults to `claude-sonnet-5`; `off` runs every evaluation on the full model. See below. |
| `ANTHROPIC_FOLLOWUP_EFFORT` | No | Defaults to the same effort as a baseline run. |
| `ANTHROPIC_CACHE_TTL` | No | `1h` \| `5m` \| `off`. Defaults to `1h`. Cache **writes** cost more than plain input, so this is a bet on how often you re-run — see `.env.example`. |
| `ANTHROPIC_PROJECTION_MODEL` | No | Projections run on a cheaper model. Defaults to `claude-sonnet-5`. |
| `ANTHROPIC_PROJECTION_EFFORT` | No | Defaults to `low`. |
| `ACCOUNT_SPEND_LIMIT_USD` | No | Total USD one account may spend before its runs pause. Default 3; `0` disables. An estimate, not your bill — see below. |
| `DEEP_REVIEW_BUDGET_USD` | No | Ceiling for ONE Deep Review. Default 0.60. Not a tripwire — the output allowance is sized so the run cannot exceed it. |
| `CHECK_IN_BUDGET_USD` | No | Ceiling for ONE Check-In. Default 0.05, same construction. |
| `SESSION_PREP_BUDGET_USD` | No | Ceiling for ONE counselor session prep. Default 0.12, same construction. |
| `CRON_SECRET` | For the counselor edition | Bearer token the nightly triage job authenticates with (`vercel.json` schedules it; Vercel sets this header for you when the variable is set). **Unset means no request is ever treated as the scheduler**, so triage only ever runs when a signed-in counselor asks for their own caseload. |
| `COUNSELOR_PRICE_PER_LINK_USD` | No | List price per active student per month, used only by the internal cost view's margin arithmetic. Default 12. Nothing in this app charges anybody. |
| `OPERATOR_EMAILS` | No | Comma-separated addresses that may read `/operations`, the internal cost-per-caseload view. **Fails closed** — unset means nobody, and the page 404s for everyone else. |
| `EVAL_COOLDOWN_SECONDS` | No | Default 20. |
| `EVAL_MAX_PER_HOUR` | No | Default 10 billable evaluations per user per hour. |
| `PROJECTION_COOLDOWN_SECONDS` | No | Default 10. Projections have their own budget so plan-tinkering can't lock you out of a real evaluation. |
| `PROJECTION_MAX_PER_HOUR` | No | Default 20. |
| `MAX_FAILED_LOGINS` | No | Default 10 before the account locks. |
| `LOGIN_LOCKOUT_MINUTES` | No | Default 15. There is no reset email, so a lockout is waited out or cleared with `npm run set-password`. |
| `DATABASE_POOL_MAX` | No | Default 5. Keep small on serverless. |

`AUTH_TRUST_HOST` is not needed on Vercel — it detects the host itself.

### Deep Reviews

A Deep Review is the full assessment: two percentiles, a per-system US/UK read,
per-item and per-school judgements, ranked actions, and 2-4 commitments the
student accepts or declines. It is the only review the app runs, and it needs no
entitlement variable — `DEEP_REVIEW_ALLOWED_EMAILS` is gone, along with the paid
tier and the 21-day floor that used to sit in front of a separate band-based
tier of the same name. That tier is retired; rows produced by it are still
readable in history, labelled "Deep Review (earlier format)".

One thing to expect:

- **The spending cap applies first.** With `ACCOUNT_SPEND_LIMIT_USD` at its
  **$3** default, an account that has already run several reviews may be refused
  with "spending limit reached" before the next one starts. Raise the cap
  deliberately rather than by accident.

### What a single run can cost

Two ceilings, and they work differently from `ACCOUNT_SPEND_LIMIT_USD`. That one
is a tripwire checked before a run starts: it stops the NEXT run once the total
is reached. These bound the run itself.

The mechanism is arithmetic rather than supervision. Output is capped exactly by
`max_tokens`, and input is whatever we chose to send — so each route measures
the prompt it has assembled, works out what that will bill, and spends the
remainder of the budget on the output allowance. The model then writes freely up
to a number that was already affordable. Nothing aborts mid-generation and no
answer is discarded for going over.

- A Deep Review measured around **$0.19** in practice against a **$0.60** cap,
  so the ceiling is roughly three times the expected cost. It exists for the run
  that goes wrong, not the one that goes normally.
- A retry is a second bill, so it is sized from what the first attempt actually
  left — the pair stays inside one cap.
- If a profile ever assembles a prompt so large that too little budget remains
  for a usable answer, the run is refused with a message naming both numbers.
  That is the case to raise the budget for, or to send the review less.

Check-Ins run between reviews on the fortnightly rhythm. They read what the
student reported under "recent developments", follow up on accepted commitments
by name, and cost nothing at all when the deterministic pass finds nothing
material moved.

If a review is discarded — the model's output fails its schema, or contains
phrasing the app refuses to show a student — the attempt is still recorded in
history as failed, **with what it cost**. A run that spent money always leaves a
trace, so the spend total and your bill cannot disagree.

### ⚠️ Set `SIGNUP_ALLOWED_EMAILS`

Once deployed, the signup page is reachable by anyone with the URL, and **every
account can spend your Anthropic credits**. Restrict registration to yourself:

```
SIGNUP_ALLOWED_EMAILS=you@example.com
```

Add more addresses separated by commas to let specific people in. Leaving it
empty means open registration — fine locally, risky in production.

This gate covers **both** kinds of account. Signup asks whether the account is
for a student or for a counselor running a caseload, and the counselor choice
is the one that matters here: it is the only way a `CounselorAccount` is ever
created, and there is deliberately no path for an existing account to grant
itself one later. A counselor account still sees nothing about any student
until that student issues an invite code and both they and a guardian agree —
but it is the more privileged of the two, so keep the allowlist set.

Three further safety nets are in place:

- **A per-account spending cap**, `ACCOUNT_SPEND_LIMIT_USD`, default **$3**.
  Once an account has spent that, its evaluations and projections are refused
  with an explanation. It covers every student on the account and counts failed
  runs, which still burn tokens. Two honest caveats: the figure is an estimate
  from recorded token counts against a price table in this repo — not your bill,
  and it will drift — and it can overshoot by one run, because a run's cost is
  not knowable until it finishes. The overshoot is bounded by a single run.
- **Rate limits** per user (20s cooldown, 10 billable evaluations per hour).
- **The Anthropic console's own limit**, under **Settings → Limits**. Set this
  as well. It is the only one that genuinely cannot be exceeded.

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

### How long a run may take

Both AI routes declare `maxDuration = 300` (`app/api/evaluate/route.ts`,
`app/api/project/route.ts`). That is the whole request budget on a serverless
host — model call, retry and all. It was 60, which an Opus evaluation of a full
profile does not fit into; those runs were killed mid-stream, billed, and lost.

**Your plan caps this, and the cap is not visible to the app.** Next passes the
number to the host through the build output; if the host enforces something
lower, nothing says so. That is why the safety net is a separate setting:

| Variable | What it does |
|---|---|
| `EVAL_TIME_BUDGET_SECONDS` | What the evaluation route *believes* it has. Defaults to `maxDuration`. |
| `PROJECTION_TIME_BUDGET_SECONDS` | The same, for projections. |

If runs are still being killed, set these to the ceiling your plan really
enforces. The route then aborts itself just before that point and records a run
explaining what happened — rather than being killed mid-stream and surfacing
five minutes later as "the server stopped waiting for the model".

The other lever is a shorter run: `ANTHROPIC_EFFORT=low` trades thoroughness for
speed and fits comfortably in a minute.

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

## Step 5 — Payments (optional)

**The app runs fine without any of this.** With no Stripe keys set, everybody is
on the free plan, checkout buttons are not rendered at all, and the webhook
endpoint returns 503. Nothing else changes. Skip this section until you actually
want to charge somebody.

### 5a — Create the products in Stripe

In the Stripe dashboard, in **test mode** first, create one product per plan and
give each a **recurring monthly** price:

| Product | Monthly | What it grants |
|---|---|---|
| Plus (students) | $9 | Raises the account's model budget to $25/mo |
| Up to 20 students (tutors) | $29 | Caseload band of 20 |
| Up to 50 students (tutors) | $49 | Caseload band of 50 |

Copy each price's id — it looks like `price_1QxYz...`, **not** the product id
(`prod_...`). Getting these two confused is the most common setup mistake, and
the symptom is a checkout that 400s.

> The amounts above are what `lib/billing/plans.ts` *displays*. **Stripe holds
> the amount actually charged.** If you price something differently in Stripe,
> change it here too (or set `STUDENT_PLUS_PRICE_USD`, `TUTOR_20_PRICE_USD`,
> `TUTOR_50_PRICE_USD`) or the app will quote a price it does not charge.

### 5b — Add the webhook endpoint

In Stripe → **Developers → Webhooks → Add endpoint**:

- **URL**: `https://your-app.vercel.app/api/billing/webhook`
- **Events**: `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`

Copy the **signing secret** (`whsec_...`).

This endpoint is the only thing that grants anybody a plan. The success page
after checkout grants nothing — it is just a redirect, and anyone can type it.

### 5c — Set the environment variables

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` while testing, `sk_live_...` in production |
| `STRIPE_WEBHOOK_SECRET` | The `whsec_...` from 5b |
| `STRIPE_PRICE_STUDENT_PLUS` | The `price_...` for Plus |
| `STRIPE_PRICE_TUTOR_20` | The `price_...` for the 20-student band |
| `STRIPE_PRICE_TUTOR_50` | The `price_...` for the 50-student band |
| `APP_URL` | Already needed for password resets. Stripe returns customers here, so a wrong value sends a paying customer to the wrong host. |

Live and test mode have **separate** prices and webhook secrets. Copying a test
`price_` id into a live deployment fails at checkout.

### 5d — Test it before charging anyone

Use Stripe's test card `4242 4242 4242 4242`, any future expiry, any CVC.

```bash
# Replay events at your local server without a card, using Stripe's CLI:
stripe listen --forward-to localhost:3000/api/billing/webhook
stripe trigger customer.subscription.created
```

Worth confirming, in this order:

1. Subscribing moves the plan on `/settings/billing` (students) or
   `/students-testprep/plan` (tutors).
2. **Cancelling in the portal leaves access intact until the period ends.** This
   is the one most likely to be wrong, and the one customers notice.
3. Replaying the same event twice changes nothing the second time.

### 5e — Before going live

- Switch the keys to live mode and re-copy the price ids and webhook secret.
- Fill in Stripe's **customer portal** settings (business name, cancellation
  policy) — the portal is where your customers cancel, and it shows your details.
- Decide what happens to a lapsed tutor over their old band. Today: nothing is
  disabled, they are simply notified. That is deliberate — see
  `lib/testprep/entitlement.ts`.

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
| An evaluation stays "Running…" | It was interrupted (usually a function timeout). A run that overruns its own budget now aborts itself and says so immediately; anything else abandoned is swept after 15 minutes. Just run it again. |
| Build fails on `prisma migrate deploy` | `DATABASE_URL` missing/wrong in Vercel, or the database rejects connections. |
| `P1002 ... Timed out trying to acquire a postgres advisory lock` | Migrations take a session-scoped advisory lock, which a transaction-mode pooler (Neon's `-pooler` host, PgBouncer) cannot hold — the lock is taken on one backend and looked for on another. Migrations now run over a direct connection automatically when one of `DIRECT_URL`, `DATABASE_URL_UNPOOLED` or `POSTGRES_URL_NON_POOLING` is set; Neon and Vercel Postgres set one of those for you. If none is present, add `DIRECT_URL` with your provider's **direct** (non-pooled) string. **This error is also often transient** — a cold/suspended database, or two deploys racing to migrate. Retry once before changing anything. |
| "DATABASE_URL is not set" locally | No `.env` file, or it is in the wrong folder. |
| Login works locally but not deployed | `AUTH_SECRET` not set in Vercel. The build now stops on this rather than deploying a site that loads fine and cannot log anyone in — if an older deploy is live and broken this way, the symptom is `MissingSecret` in the function logs and a failing login form on a page that otherwise renders normally. |
| Build stops with "required configuration is missing" | Working as intended — the named variable is not set where the app is hosted. Add it and redeploy. |
| The deploy succeeded but is missing recent work | Vercel builds the **production branch**, which is `main`. Work pushed only to a feature branch builds as a preview, not production. Merge into `main` to release it. |
| Signup says "not on the invite list" | Working as intended — add the address to `SIGNUP_ALLOWED_EMAILS` and redeploy. |
| Evaluations return sample output | `ANTHROPIC_API_KEY` not set in Vercel. |
| Checkout button does nothing / no button at all | `STRIPE_SECRET_KEY` not set. With no key the buttons are deliberately not rendered — a dead checkout button is worse than none, because someone presses it and concludes they have paid. |
| Checkout returns 400 | A `STRIPE_PRICE_*` variable holds a product id (`prod_...`) instead of a price id (`price_...`), or a test-mode price id is set on a live deployment. |
| Paid, but the plan did not change | The webhook is not reaching the app. Check Stripe → Developers → Webhooks for failed deliveries. A 400 there means `STRIPE_WEBHOOK_SECRET` is wrong; a 503 means `STRIPE_SECRET_KEY` is unset on the deployment Stripe is calling. |
| Stripe shows the same event delivered repeatedly | Only a problem if the responses are non-2xx. Duplicates answering 200 are expected and are applied once — see `lib/billing/webhook.ts`. |
| A customer says they cancelled but still has access | Working as intended. A cancelled plan runs until the period they paid for ends. |
