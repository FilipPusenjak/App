# Application Profile Evaluator

A private tool for students building a university application. You describe your
profile — grades, curriculum, test scores, and everything you do outside class —
name the universities you're aiming at, and get an honest, calibrated read on
where you stand against each one.

Deployment is covered in [DEPLOYMENT.md](DEPLOYMENT.md); running the tests is in
[TESTING.md](TESTING.md). This file is about what the app is and why it is built
the way it is.

## What it does

- **Profile** — grades, curriculum, school context, test scores, and a resume of
  everything you do.
- **Targets** — the universities and courses you're aiming at. The course field
  offers the exact names we hold researched requirements for.
- **Evaluations** — scored against your named targets, under the right country's
  admissions rubric, with a per-item read on everything on your resume and a
  prioritized list of what to do next.
- **Plans and projections** — what you're considering doing, and what it would
  be worth if you did it. Recommended actions can be added to a plan in one
  click.
- **Students** — a legacy view for accounts that already ran several students,
  each with their own targets and history, from before this closed to new
  signups. Nothing offers it any more; see the Counselor Edition below for how
  a professional manages several students today.

## The rules it is built around

Everything below is load-bearing. Where a decision looks like an omission, it is
usually one of these.

**It never invents an admissions statistic.** No made-up acceptance rates, no
guessed grade requirements. Anything the model is not sure of comes back as
"verify this", and the entry requirements it does show come from a database of
researched facts, each with a verbatim quote and the URL it was taken from.
A record with no source is not stored.

**US, UK and EU admissions are never flattened into one number.** They reward
different things, so a single blended score is a number about nothing. Each
system is scored separately under its own rubric.

**It is honest in both directions.** A score can go down, and the app says so
and why. It also refuses to let a score drift for no reason — every run is
anchored to the previous one, and when a prompt version genuinely redefines what
a score means, that is recorded in `lib/prompts/evaluation/versions.ts` and the
anchor is released for that score only.

**It does not tell a student to fix something they cannot touch.** A Grade 9
student is judged against Grade 9, not against applicants submitting this year,
and is never prompted for a test they will not sit for two years.

**Nothing is public or shareable.** Every query is scoped to the authenticated
user through `lib/ownership.ts`. There is no public link, no share button, and
no client-supplied ids.

There is exactly **one** way data reaches somebody outside the account, and it
is the Counselor Edition below. It reads through `lib/counselor/access.ts`
rather than `lib/ownership.ts`, and that module is the only door: it requires an
ACTIVE link plus **both** a student and a guardian consent as conditions inside
the Prisma query, applies the grant's scope in the `SELECT` rather than in a
component, logs every read where the student can see it, and contains no write
path to any student-owned table at all. A student ends a grant instantly, alone,
without a reason and without the counselor's agreement.

## The Counselor Edition

A separate product surface, at `/caseload`, for an independent counselor or
tutor running a caseload. It is not the student app with a different header: the
question it answers is *who needs me this week, and what do I say to them*,
which is an attention-allocation problem rather than an advice problem.

**One front door, two products.** Signup asks which kind of account this is,
and that choice decides what gets created — a student profile or a caseload —
not merely which screen appears first. There is deliberately no way for an
existing account to grant itself a caseload later: that would be a self-service
escalation into other families' records. Signing in routes by account kind
through `/start`, the single place that decides.

**Triage ranks by need, never by quality.** Eight deterministic detectors —
stale profile, a prerequisite that just became binding, an overdue commitment, a
stalled activity, a deadline, and so on — write signals with a severity that is
grade- and time-aware, because the same unmet prerequisite is a plan for a Grade
9 student and a crisis for a Grade 12 one. There is no readiness number, band or
percentile anywhere on the caseload surface. A leaderboard of a counselor's own
students would be professionally toxic and useless: the strongest student may
need the most attention.

**Triage calls no model at all.** That is what makes monitoring forty students
free, and it is also why the margin works — a counselor generates prep for the
handful triage surfaced, not for the caseload.

**Session prep is drafting material, and every claim in it names its source.**
Each discussion point and option carries a `basis` naming the computed signal it
came from, because a counselor is about to repeat some of it to a fee-paying
parent and "the system said so" is not something a professional can repeat. The
model writes options with their costs, never recommendations — it knows less
about admissions than its reader does.

**It never states odds of admission**, in any phrasing, and a prep containing
one is discarded rather than shown. The run is still recorded with what it cost.

**What the counselor declined to pass on is recorded.** That judgement is the
one thing here the model never makes. It is surfaced as pattern observation
only: no effectiveness metric, no comparison between counselors, and no join to
admissions outcomes — that last one looks the most valuable and is the most
dangerous, because across a caseload of forty it would imply causation from a
sample that cannot support it.

## Deliberately not built: activity discovery

An earlier plan included a feature that would aggregate what students do and
suggest activities based on it. **It is shelved on purpose, and should stay
shelved unless the reasoning below stops holding.**

This app exists to give a student an honest private read on their own progress.
A feature that says "here's what other applicants are doing" turns that into a
comparison, and admissions already supplies more comparison than any teenager
needs. It would also push every user toward the same activities — which is both
bad advice, since a profile is worth more for being coherent than for being
populated, and self-defeating as the aggregate converges.

The underlying need is real: a student told "your UK targets need
subject-specific evidence" may not know what that means. The answer is better
specificity in the evaluation and the researched-requirements data, not a
leaderboard.

## The researched requirements data

`data/research/` holds the raw output of the research brief in
`lib/prompts/research/course-requirements-v3.md`, one file per wave. Ingesting
is a two-step, dry-run-first process — see the README in that directory.

v3 is the brief to run; earlier versions are kept because v1 produced the
current rows. The v2 changes came from re-running v1's output through the
validator and counting: of 346 rejections, 345 were records with nothing sourced at all, and they were
almost entirely continental European. v1 sourced 400/400 UK and 400/400 US
courses and close to nothing in the EU, because it searched in English and the
thresholds are published on national portals in the national language. v2 adds
those portals and search terms, and states the limits v1 left the agent to
guess at. v3 adds what the operator hit on later waves: the entry year and
applicant profile belong on every input line (a stored record is keyed on
country + university + course, with no room for a qualification, so two profiles
overwrite each other), the course title must be confirmed against an official
catalogue page, and an institution-wide page cannot support a course-specific
requirement — 48% of the rows that landed carry nothing but "apply through
UCAS". `tests/unit/research-brief.test.ts` keeps the brief's worked example, its
delivery envelope and every number it quotes pinned to the schema, so the two
cannot drift again.

Matching a student's target to a record is deliberately strict: a wrong match
would show one university's requirements under another's name, sourced and dated
and looking authoritative. So names are normalized, aliases are enumerated by
hand in `lib/requirements/aliases.ts` rather than inferred, and a name that
could mean two institutions matches neither.

```bash
# What is covered, and what the next research wave should target
DATABASE_URL="<production>" npx tsx scripts/requirements-coverage.ts
```

## Getting started

```bash
npm install
cp .env.example .env          # then fill in DATABASE_URL and AUTH_SECRET
npx prisma migrate dev
npx prisma generate           # Prisma 7 does NOT do this for you
npm run dev
```

Open [localhost:3000](http://localhost:3000) — **not** `127.0.0.1`, which Next
16 treats as a cross-origin dev client and never hydrates.

Without `ANTHROPIC_API_KEY` the app runs in sample mode: the whole flow works
end to end and evaluations return clearly-labelled placeholder output.

## Operator scripts

Run with an explicit `DATABASE_URL`. None of these are routes, because they all
read or write across accounts.

| Script | What it does |
| --- | --- |
| `scripts/ingest-requirements.ts` | Load a research wave. `--dry-run` first; `--prune` after a matcher change. |
| `scripts/requirements-coverage.ts` | Which targeted courses have data, and which need research. |
| `scripts/requirements-to-sql.ts` | The same ingest as SQL, for when the machine with the data can't reach the database. |
| `scripts/reset-link.ts` | Mint a password reset link for an account. |
| `scripts/target-pairs.ts` | The (university, course) pairs students actually target. |
| `scripts/set-password.ts` | Set an account's password directly. |

## Testing

```bash
npm test              # unit + integration
npm run test:e2e      # real browser, real database
```

Integration and e2e tests need `TEST_DATABASE_URL` pointing at a throwaway
database whose name contains "test" — enforced, because these wipe it. Full
detail in [TESTING.md](TESTING.md).
