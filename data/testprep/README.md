# School test policies

What each school does with each test, per admissions cycle. Ingested by
`scripts/seed-testprep.ts`; the shape is validated by
`lib/testprep/policy-record.ts`.

## Why there is no committed policy file

Because the numbers are the product's liability, not its convenience.

`lib/testprep/target.ts` opens by saying it plainly: a model asked to recall a
school's 75th percentile "will produce a number with total confidence and no
source, and a tutor will repeat it to a parent." Everything downstream of these
figures is exactly that path — `p75` becomes the bar a student is aimed at,
`p25`/`p50` decide whether a test-optional school is worth submitting to, and
the stopping engine tells a family to stop paying once the bar is cleared.

A wrong figure here does not surface as a bug. It surfaces as a student who
kept paying for sittings they did not need, or one who stopped before they were
ready, and neither is visible from inside the app.

So these come from research against primary sources — each school's Common Data
Set or its own published admissions page — not from anybody's memory.

## Getting the data

Same pipeline as course requirements (`scripts/ingest-requirements.ts`): an
agent or a person researches a batch, writes this file, and the ingest script
validates every record before any of it becomes data.

Always dry-run first. It validates, range-checks and reports without writing:

```bash
npx tsx scripts/seed-testprep.ts --dry-run data/testprep/policies-2027.json
npx tsx scripts/seed-testprep.ts           data/testprep/policies-2027.json
```

A rejected record never becomes data, and the batch carries on — the useful
output is "40 landed, 6 did not, here is why".

## Shape

```json
{
  "sourceDataVersion": "testprep/2027-common-data-set",
  "records": [
    {
      "school": "Duke University",
      "country": "US",
      "region": "North Carolina",
      "city": "Durham",
      "test": "SAT",
      "cycle": 2027,
      "policy": "OPTIONAL",
      "superscores": true,
      "scoreChoice": true,
      "p25": null,
      "p50": null,
      "p75": null
    }
  ]
}
```

`sourceDataVersion` is stamped onto every policy row and is what a recomputation
keys on when a cycle is superseded. Name it after where the batch came from and
which cycle, so "where did 1500 come from" has an answer months later.

### Fields

| Field | Notes |
|---|---|
| `school` | The official name. Also canonicalised into `School.normalizedName`, which is what a student's free-text target ("MIT", "Cambridge") is matched against. |
| `country` | ISO 3166-1 alpha-2. Part of matching — a name alone is not unique globally. |
| `region` | State or province. Part of `School`'s uniqueness, so it pins which campus. |
| `test` | A `TestType.code` — `SAT` or `ACT` as seeded. An unknown code is rejected. |
| `cycle` | The admissions cycle, e.g. `2027` for students applying in autumn 2026. |
| `policy` | `REQUIRED`, `OPTIONAL` or `BLIND`. |
| `superscores` | Whether the school reads the best section from each sitting. Changes the composite a student is measured on. |
| `scoreChoice` | Whether the student chooses which sittings to send. |
| `p25` `p50` `p75` | Middle 50% of submitted scores, on that test's own scale. Omit rather than guess. |

### What the validator refuses

- **Out-of-order quartiles.** `p25 <= p50 <= p75`, or the comparisons
  downstream are meaningless in a way nothing can detect.
- **A `BLIND` school with quartiles.** A school that will not look at a score
  reports no middle 50% of submitted scores, and `target.ts` excludes it
  entirely — so the numbers would sit there looking authoritative and never be
  read.
- **A percentile outside the test's scale.** An ACT figure filed under `SAT` is
  the likeliest research error and the hardest to spot later.
- **An unknown `test` code, or a missing `sourceDataVersion`.**

A `REQUIRED` or `OPTIONAL` school with no quartiles is **accepted** and simply
sets no bar. A school that is present but silent is more honest than one absent
from the catalogue entirely.

## After an ingest

Policies are what targets rest on, so a new `sourceDataVersion` makes every
target derived against an older one stale. The script says so rather than acting:
recomputation touches every student on the superseded cycle, and a data import
that silently rewrote targets families had already been told about would be the
wrong thing to do quietly. See `recomputeForPolicyVersion` in
`lib/testprep/derive.ts`.
