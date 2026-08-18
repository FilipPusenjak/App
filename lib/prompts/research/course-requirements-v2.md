# Research brief — course entry requirements (v2)

Paste this into a Claude conversation with web research enabled.

Everything below the line is the prompt. The notes here are for whoever is
running it, not for the agent.

**Why it is written this way.** The output goes straight into an app used by
14–18 year olds to decide what to study and where to apply, **with no human
review step**. A wrong A-level requirement is not a bad answer — it is a
teenager planning two years around a subject they did not need, or dropping one
they did. So the brief is built to *omit* rather than guess, and every fact has
to carry a verbatim quote and a URL so it can be checked later without
re-researching.

## What changed since v1, and why

Not guesswork — the v1 output was re-run through the current validator and the
rejections counted. Of 1185 records, 346 were refused, and they break down as:

| Cause | Count |
|---|---|
| Record had **no sourced requirement at all** | 345 |
| Quote shorter than 15 characters | 1 |

So there is essentially **one** failure mode, and it is not carelessness. It is
geographic:

| Country | Rejected / total |
|---|---|
| GB | 0 / 400 |
| US | 0 / 400 |
| CH | 13 / 33 |
| DE | 40 / 60 |
| BE, DK, FR, IT, ES, NL, SE | **all of them** |

The agent sourced UK and US requirements perfectly and could not source a
single field for most of continental Europe. It behaved honestly — each of
those 345 records carried nine `omitted` entries saying the requirement "was
not verified on an official source" — and v1 had told it that nulls were a good
outcome without telling it that an *entirely* null record is refused. So the
work was emitted, then discarded.

That produces two changes, and the second is the one that matters:

1. **Say that an all-null record is rejected**, so the agent reports the course
   as unsourceable instead of spending output on a record that cannot land.
   This makes the failure honest. It does not create any data.
2. **Give continental Europe the sourcing help the UK and US never needed** —
   the national admissions bodies and the local-language terms. This is the
   change that could actually move EU coverage off zero. Without it the next
   batch produces the same nothing, just labelled more accurately.

The remaining additions below are limits the ingest already enforced and v1
never stated, so an agent had no number to hit: exact lengths, `cycleYear`
bounds, the literal banned-host list, and `https`. Plus two rules that cost
nothing to follow and are expensive to break — a partial fact rejects the whole
course, and `country` must be a code the app actually uses (`GB`, never `UK`;
the wrong one is stored and then silently matches nobody).

## How to run it

1. Get the list of pairs students are actually targeting, and which of them are
   still missing data:

   ```bash
   DATABASE_URL="<production>" npx tsx scripts/requirements-coverage.ts --missing > next-wave.txt
   ```

   This is demand-driven on purpose. A record nobody targets is effort spent on
   data that goes stale before it is ever read. It also resolves through the
   real matcher, so a pair it reports as missing is genuinely missing rather
   than merely spelled differently — a spelling mismatch is a job for
   `lib/requirements/aliases.ts`, not for research.

2. Open a Claude conversation with **web research enabled**.
3. Paste everything below the line, then paste the pairs, one per line, as
   `University | Course | CC`:

   ```
   University of Cambridge | Medicine (A100) | GB
   Trinity College Dublin  | Medicine        | IE
   Utrecht University      | Liberal Arts and Sciences | NL
   ```

4. Save the output as `data/research/course-requirements-YYYY-MM-DD.json`.
5. **Dry-run before it becomes data:**

   ```bash
   npx tsx scripts/ingest-requirements.ts --dry-run data/research/course-requirements-YYYY-MM-DD.json
   ```

   It reports what would land, what was rejected and exactly why, without
   writing. Drop `--dry-run` when the report looks right. Add `--prune` only
   after a change to how names normalize.

---

You are researching university entry requirements that will be fed directly
into a tool used by 14–18 year old students to plan their applications. **No
human will check your output before students see its effects.**

That single fact governs everything below. A missing requirement makes the tool
say "we don't know — check the course page", which is safe. A *wrong*
requirement makes it confidently tell a 15-year-old to drop Chemistry. Omitting
is cheap. Being wrong is not.

Your output is validated by a strict machine schema before anything is stored.
A rejected record is not a partial loss — the whole course is discarded and
students get nothing for it. The rules below are that schema in words. Follow
them exactly and nothing you produce will be thrown away.

## What to research

I will give you a list of `University | Course | CountryCode` lines. For each,
find the official entry requirements for the **current or next admissions
cycle**.

Gather only these eight fields. They map onto what the tool actually scores
against; anything else is discarded on ingest.

| Field | What it is |
|---|---|
| `gradeRequirement` | The headline offer — "A*AA", "38 points IB", "numerus fixus GPA 7.5" |
| `requiredSubjects` | Subjects that must be taken, and at what grade |
| `admissionsTest` | UCAT, LNAT, TSA, ESAT, MMI, national entrance exam — named, and whether required |
| `languageRequirement` | Language of instruction and the test score that proves it |
| `interview` | Whether interviews form part of selection |
| `workExperience` | Required or expected experience (common for Medicine, Nursing, Education) |
| `restrictedEntry` | Numerus clausus, quota, or capped-place systems |
| `applicationRoute` | UCAS, Studielink, national portal — and the deadline if stated |

`acceptanceRate` is gathered separately and is **internal only** — never shown
to a student.

## Sourcing rules — these are not guidance

1. **Official sources only.** The university's own admissions or course page, or
   the national admissions body (UCAS, Studielink, DUO, Uni-Assist, the
   ministry). Not league tables, not blogs, not agency sites, not a summary
   written by someone else.

   Mechanically enforced, so these are not judgement calls:
   - Every URL **must** begin `https://`. A plain `http://` page is rejected.
   - These hosts are refused outright, including subdomains:
     `thestudentroom.co.uk`, `wikipedia.org`, `reddit.com`, `quora.com`,
     `medium.com`, `chatgpt.com`, `claude.ai`.

2. **Every fact needs a verbatim quote and the URL it came from.** If you cannot
   quote the source saying it, you do not have it.

3. **Never infer across courses.** Requirements for Medicine at a university
   tell you nothing about Dentistry there. If you did not find the page for the
   exact course, the field is unknown.

4. **Never carry a requirement across cycles.** Record the year the page states.
   If the only page you can find is for a past cycle, set `stale: true` — but
   see the `cycleYear` bounds below, which that does not exempt you from.

5. **When sources disagree, omit and say so.** Two official pages giving
   different grades is a real finding and the tool handles "unknown". A
   confident average of the two is a fabrication.

6. **Never convert between grading systems.** "A*AA" stays "A*AA". Do not
   helpfully translate it to a GPA or an IB score.

7. **Never state, estimate or imply an applicant's chances.** No percentages of
   getting in, no "competitive for", no odds. Record only what a page states
   about its requirements.

## Continental Europe — read this before you start

The last run of this brief sourced **every** UK and US course and **almost no**
continental European one. Not for lack of trying: it searched in English, found
prospectus pages that describe programmes without stating requirements, and
correctly refused to guess.

The requirements exist. They are usually on a national admissions portal rather
than the university's own site, and they are usually **not in English**.

**Search in the country's own language.** An English-language page for an
international audience often omits the exact thresholds that the national-
language page states plainly. These are the terms that find them:

| Country | Search terms | Where the requirement usually lives |
|---|---|---|
| DE | `Zulassungsvoraussetzungen`, `NC`, `Numerus Clausus`, `Studiengang` | hochschulstart.de for restricted subjects; the university's own `NC-Werte` page; uni-assist for international applicants |
| NL | `toelatingseisen`, `numerus fixus`, `decentrale selectie` | studielink.nl; the programme's own `toelating` page |
| FR | `conditions d'admission`, `attendus`, `capacité d'accueil` | parcoursup.fr; Campus France for international |
| IT | `requisiti di accesso`, `bando di ammissione`, `test di ingresso` | universitaly.it; the faculty's `bando` (a dated PDF, which is a good source); CISIA for TOLC tests |
| ES | `requisitos de acceso`, `nota de corte`, `EvAU` / `PAU` | the regional `distrito único`; UNEDasiss for international; the university's published `notas de corte` |
| SE | `behörighet`, `antagningspoäng`, `meritvärde` | universityadmissions.se / antagning.se |
| DK | `adgangskrav`, `adgangskvotient`, `kvote 1`, `kvote 2` | optagelse.dk; the university's `adgangskrav` page |
| BE | `toelatingsvoorwaarden` (Flemish), `conditions d'accès` (French) | differs by community — check which one the institution belongs to |
| CH | `Zulassung`, `conditions d'admission` | swissuniversities; ETH and EPFL publish their own; medicine goes through the EMS test |

Treat that table as **starting points, not facts**. Portals get renamed and
merged. Confirm the body is still the right one for the cycle you are recording,
and cite the page you actually read.

Three things that are normal in Europe and rare in the UK/US, so they are easy
to miss:

- **A cut-off is not an offer.** A Spanish `nota de corte` or a German `NC` is
  the lowest score admitted *last year*, not a threshold the university
  promises. Record it as what it is, in `gradeRequirement`, and let the quote
  carry that nuance. Do not restate it as "you need X".
- **Restricted entry is a requirement.** `numerus fixus`, `numerus clausus`,
  `programmazione nazionale`, a `kvote` system — these belong in
  `restrictedEntry` and they are often the single most decision-relevant fact
  about the course.
- **Language of instruction is frequently the real gate**, more than grades.
  If the programme is taught in the national language and states a certificate
  level (`C1`, `TestDaF 4`, `DELF B2`, `NT2`), that is a `languageRequirement`
  and it matters more to a British 16-year-old than the grade line does.

If after searching in the local language you still cannot source a single field
for a course, that is a real finding — report it under "no sourceable data" and
move on. But do not reach that conclusion from an English-language search alone.

## The five rules that decide whether a record survives

Everything else is craft. These are the ones that discard work.

### 1. A partial fact destroys the entire record

A requirement field is **all three of** `value`, `quote`, `sourceUrl`, or it is
`null`. There is no middle state. A field carrying a `value` with no `quote`
does not quietly become null — **the whole course is rejected and every other
field you researched for it is lost with it.**

If you have the fact but not a quotable line, the field is `null`. That costs
one field. Guessing at a quote costs the record.

### 2. A record where every field is null is rejected

This is the one that surprises people, because nulls are otherwise encouraged.

An all-null row would make the app claim it researched a course and found no
requirements — a stronger and more misleading claim than never having looked.
Absence of a row means "not checked"; a row means "checked".

So: **a record needs at least one fully-sourced requirement field.** If you
genuinely cannot source a single one of the eight for a course, do not emit a
record for it at all. List it at the end under "no sourceable data" instead.
That is a good outcome and it is reported, not hidden.

### 3. Lengths are enforced, with numbers

| Field | Minimum | Maximum |
|---|---|---|
| `value` | 3 characters | **450** |
| `quote` | **15** characters | 1000 |
| `omitted[].field` | 2 characters | — |
| `omitted[].reason` | **10** characters | — |
| `university`, `course` | 2 characters | 200 |
| `acceptanceRate.scope` | 3 characters | 200 |
| `acceptanceRate.quote` | 15 characters | 1000 |

The 15-character floor on `quote` exists because "Required." is not a quotation
of anything — quote the whole sentence. The 450 ceiling on `value` is generous
on purpose: a genuinely dense fact like the University of California's fifteen-
course "A-G" subject list runs close to it. Do not truncate a real requirement
to be tidy; do not pad one to look thorough.

`reason` at 10 characters means "not found" (9) is refused. Say what you looked
for and why you stopped.

### 4. `cycleYear` must be within three years of today

An integer, no quotes, no `"2026/27"`. For a run in 2026 the accepted range is
**2023–2029**. Outside it, the record is refused as either an archived page or a
guess — and `stale: true` does not exempt you. If the only page you can find is
older than that, treat the course as having no sourceable data (rule 2) rather
than citing it.

### 5. `country` must be one of these exact codes

`AU CA DE GB IE NL US` — and the others in the app's country list. Use the ISO
3166-1 alpha-2 code, uppercase.

**`UK` is not one of them.** It is the single most damaging mistake available to
you, because it does not get rejected: it is stored, and then never matches a
single student, because the app records the United Kingdom as `GB`. The work is
lost silently rather than reported. Same for `EN`, `UAE`, `USA`.

Use the code I give you on each input line. If a line has none, infer it and say
which you chose in your final report.

## Naming, so records can actually be found

The stored key is built from `university` + `country` + `course`. It is matched
against what a student typed, after lowercasing, stripping accents and
punctuation, and dropping the words `the`, `of`, `at`. Matching is deliberately
strict — a wrong match would show one university's requirements under another's
name — so these matter:

- **`university`: the institution's full official name.** "University of
  Cambridge", not "Cambridge". Not the acronym alone. A trailing acronym in
  parentheses is stripped automatically, so "University College London (UCL)"
  is fine and stores identically to "University College London".
- **`course`: the name as the course page titles it**, including any code in
  parentheses — "Medicine (A100)", "Computer Science and Engineering (Course
  6-3)". Course parentheticals are *not* stripped, and they distinguish real
  courses, so keep them.
- **A name made only of the dropped words is rejected** — "The University"
  normalizes to nothing and would collide with every other vague entry.
- **One record per `university + country + course`.** If you emit two, the
  second silently overwrites the first and the first's research is lost. Merge
  them before you finish.

## `acceptanceRate` — it can never cost you a record

Internal calibration only; never rendered, never given to the model as a number.
If it is malformed it is **dropped on its own** and the record still lands. So
never discard or weaken a course's requirements over an uncertain rate.

Record it only if officially published, with `scope` in the source's own words —
"university-wide first-year admission, Fall 2025" is better than "institution",
because a university-wide rate, a faculty rate and a course rate are three
different numbers and none is the rate for a given applicant.

## Output format

One JSON object per (university, course). No prose around them. `requirements`
must always be present, even if most of it is null.

```json
{
  "university": "University of Cambridge",
  "country": "GB",
  "course": "Medicine (A100)",
  "cycleYear": 2027,
  "stale": false,
  "gatheredOn": "2026-08-18",
  "primarySourceUrl": "https://www.undergraduate.study.cam.ac.uk/courses/medicine",
  "requirements": {
    "gradeRequirement": {
      "value": "A*A*A at A Level",
      "quote": "The typical conditional offer for Medicine is A*A*A at A Level.",
      "sourceUrl": "https://www.undergraduate.study.cam.ac.uk/courses/medicine"
    },
    "requiredSubjects": {
      "value": "Chemistry plus one of Biology, Physics or Mathematics at A Level",
      "quote": "All applicants are required to take Chemistry and at least one of Biology, Physics or Mathematics.",
      "sourceUrl": "https://www.undergraduate.study.cam.ac.uk/courses/medicine"
    },
    "admissionsTest": null,
    "languageRequirement": null,
    "interview": {
      "value": "Required; all shortlisted applicants are interviewed",
      "quote": "Almost all applicants who are shortlisted will be invited to interview in December.",
      "sourceUrl": "https://www.undergraduate.study.cam.ac.uk/applying/interviews"
    },
    "workExperience": null,
    "restrictedEntry": null,
    "applicationRoute": {
      "value": "UCAS, 15 October deadline",
      "quote": "Applications must be submitted through UCAS by 15 October.",
      "sourceUrl": "https://www.undergraduate.study.cam.ac.uk/applying"
    }
  },
  "acceptanceRate": {
    "percent": 4.5,
    "scope": "offers made to applicants for Medicine A100, 2025 entry",
    "quote": "In the 2025 cycle there were 1,782 applicants for Medicine and 80 offers were made.",
    "sourceUrl": "https://www.undergraduate.study.cam.ac.uk/apply/statistics"
  },
  "omitted": [
    {
      "field": "admissionsTest",
      "reason": "Course page references an 'admissions assessment' without naming it; no official page found confirming which test applies for this cycle."
    }
  ]
}
```

`stale` defaults to `false` and `omitted` to `[]`, so both may be left out.
Extra fields outside this shape are discarded rather than rejected — but do not
add them.

### Delivering the output

- **Emit each record as soon as you finish it**, rather than holding everything
  for one block at the end. A long run that is interrupted should leave behind
  the records it already completed, not nothing.
- When done, output the full set as a JSON **array** of record objects, in a
  single block, named `course-requirements-YYYY-MM-DD.json` (today's date).
- Work through the list **in the order given**. If you run out of time or
  budget, stop cleanly and report which pairs you did not reach — a partial set
  with a known boundary is usable; one that looks complete is not.
- **Do not summarise across the set.** No rankings, no comparisons, no advice.

## Pre-flight check — run this on every record before you emit it

Go field by field. If any answer is wrong, fix the record rather than submitting
it. Every line here is a rule the validator enforces mechanically.

1. Does **every** non-null requirement field have all three of `value`, `quote`,
   `sourceUrl`? (Rule 1 — a partial field discards the whole course.)
2. Is at least **one** of the eight requirement fields non-null? (Rule 2 — if
   not, drop the record entirely and list the course as unsourceable.)
3. Is every `quote` **at least 15 characters** and copied verbatim?
4. Is every `value` **at most 450 characters**?
5. Does every URL start `https://`, and is none of them on a banned host?
6. Is `cycleYear` a bare integer within three years of today?
7. Is `country` a real alpha-2 code from the list — **`GB` and never `UK`**?
8. Is `gatheredOn` exactly `YYYY-MM-DD`?
9. Does every `omitted` entry have a `reason` of **at least 10 characters**?
10. Is `university` the full official name, and `course` the page's own title
    including any code?
11. Have I emitted this `university + country + course` only once?
12. Could I have confused this with a different course, campus, or entry route
    (standard vs. graduate vs. foundation)?

## Report at the end

- How many pairs you were given, and how many records you produced.
- Which pairs you did not reach.
- Which pairs you deliberately produced **no record** for, because nothing was
  sourceable — with the course named. This is a real finding, not a gap in your
  work.
- How many fields you left `null` in total.

**A high null count is a good outcome, not a failure.** It means the tool will
ask students to verify rather than telling them something untrue.
