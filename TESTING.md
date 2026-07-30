# Testing

Three layers, each answering a different question:

| Layer | Command | Needs | Answers |
| --- | --- | --- | --- |
| Unit | `npm run test:unit` | nothing | Is the pure logic right? Rubric routing, validation schemas, prompt rendering, old-evaluation compatibility. |
| Integration | `npm run test:integration` | a test Postgres | Do the database rules hold? **Ownership (no user can ever read another user's data)**, rate limiting, login lockout, stale sessions. |
| End-to-end | `npm run test:e2e` | a test Postgres | Does the whole app work in a real browser? Signup → profile → target → evaluation → export → delete. |

`npm test` runs unit + integration together (integration skips itself, with a
notice, when no test database is configured). Everything also runs
automatically on every push via GitHub Actions (`.github/workflows/ci.yml`).

## After pulling a branch that changed the database

Nothing to do — `npm run dev` and `npm run build` both apply pending
migrations before starting. If you ever want to apply them on their own:

```bash
npm run db:deploy
```

(Before this was automatic, pulling a migration and running `npm run dev`
left the database a version behind, and the new pages crashed with Prisma
error P2021 — "the table does not exist".)

## Everyday use

```bash
npm test              # quick check — run this before pushing
npm run test:watch    # re-runs affected tests as you edit
npm run test:e2e      # the full browser journey (slower; needs the test DB)
```

The unit layer finishes in about a second and needs no setup at all, so there
is never a reason to skip it.

## Setting up the test database (optional, for the two DB layers)

The integration and e2e layers run against a **separate, throwaway** Postgres
database — never your real one. Tests delete data, so there's a guard: the
database name must contain "test" or the run refuses to start.

1. Create an empty database (locally, or a second free database on Neon):

   ```bash
   createdb apptest        # if you have local Postgres
   ```

2. Add its URL to `.env`:

   ```bash
   TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:5432/apptest"
   ```

That's it — migrations are applied automatically before each run. Without
`TEST_DATABASE_URL`, `npm test` still passes (integration tests skip and say
why), and `npm run test:e2e` stops with an explanation.

Don't point `TEST_DATABASE_URL` at your Neon dev database: tests wipe what
they touch, and the guard will reject the name anyway.

## What the e2e test does

Playwright boots the real app (`next dev`, port 3100 — your normal dev server
on 3000 can stay up) against the test database, **without** an Anthropic API
key, so the evaluation runs in sample mode. It drives one full student
journey and finishes by deleting the account and proving the login no longer
works. It never calls the Anthropic API and never costs anything.

First time only, install Playwright's browser:

```bash
npx playwright install chromium
```

Note for the config-curious: the e2e server is addressed as `localhost`, not
`127.0.0.1`. Next 16's dev server treats a browser arriving via `127.0.0.1`
as a cross-origin client, refuses its hot-reload websocket, and the page then
never hydrates — every client-side button silently does nothing.

## What is deliberately NOT tested

The quality of real AI evaluations. Tests verify the machinery — the prompt
is assembled correctly, the right rubric reaches the right school, responses
are validated before storage, malformed output fails safely — but whether the
model's judgement is *good* is checked by reading real evaluations, not by
asserting on them.

## Where things live

```
tests/unit/           pure logic, no database
tests/integration/    against TEST_DATABASE_URL (Vitest)
tests/e2e/            the browser journey (Playwright)
tests/support/        the shared "is this really a test database?" guard
vitest.config.ts      unit + integration projects
playwright.config.ts  e2e runner + test web server
```

When you add an ownership helper to `lib/ownership.ts`, the integration suite
fails until you add tests for it — that's intentional (see the
"completeness" test in `tests/integration/ownership.test.ts`).
