# Research brief — course entry requirements (v3)

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

## What changed since v2, and why

v2 was never run. These changes come from the operator's account of what went
wrong in the earlier waves, plus two constraints in the code that neither brief
had accounted for.

**From the earlier waves.** University lists were expanded without real
student-targeted pairs, so course titles were invented rather than taken from a
catalogue. One batch relied on institution-wide admissions pages, which can
support a genuinely university-wide rule and nothing course-specific. Some pages
were for the wrong entry cycle. And a whole batch of ~2,000 records carried
nothing sourced at all.

**Measured, from re-running the surviving batch through the validator.** Two
numbers shape this version:

- Of 1185 records, 346 were refused; 345 of those carried no sourced
  requirement at all, and they were almost entirely continental European. v2's
  EU sourcing section addresses that and is kept unchanged.
- Of the 839 that landed, **400 — 48% — carry nothing but the application
  route.** Almost all UK. "Apply through UCAS, 15 October deadline" is true,
  university-wide, and useless for deciding which A levels to take. That is the
  institution-wide-page failure, quantified.

**Two constraints in the code**, which change what this brief can honestly ask
for:

1. **A stored record is keyed on `country::university::course` and nothing
   else.** There is no field for qualification or route. Two records for the
   same course under different qualifications do not coexist — the second
   silently overwrites the first. So this brief fixes **one applicant profile
   per run**, and requires each `value` to name the route it describes.
2. **Subjects and admissions tests are compared mechanically** against what the
   student has recorded; grades are not (they resolve to "unknown" by design,
   because no honest arithmetic compares A*AA to a GPA). So a `requiredSubjects`
   or `admissionsTest` gathered for the wrong qualification does not merely sit
   there — it produces a wrong met/unmet verdict for a real student.

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

2. **Decide the applicant profile, and ingest one only.** A stored record is
   keyed on country + university + course, with no room for a qualification or
   route, so two profiles cannot coexist for the same course.

   **Separate files do not fix this.** They organise the research; they change
   nothing at ingest. If you load two profiles into the same dataset the second
   still overwrites the first, and naming the route inside `value` does not help
   either — the app matches subjects and admissions tests mechanically and never
   reads that prose. Until `matchKey` is extended with an `applicantProfile` or
   `qualificationRoute` component, **exactly one profile may go into the live
   dataset.** Research others if you like; keep them out of the database.

3. Open a Claude conversation with **web research enabled**.
4. Paste everything below the line, then the run header and the pairs. Every
   line carries the entry year and the applicant profile, because in Europe the
   same course has different requirements for VWO, A levels, IB, an EU
   qualification and an international applicant:

   ```
   ENTRY YEAR: 2027
   APPLICANT PROFILE: GCE A levels, international (non-EU/EEA) applicant

   University of Cambridge | Medicine (A100) | GB
   Trinity College Dublin  | Medicine | IE
   Utrecht University | Liberal Arts and Sciences | NL
   ```

   Per-line overrides are allowed where a pair genuinely differs — append them
   after the country code:

   ```
   Utrecht University | Liberal Arts and Sciences | NL | 2027 | IB, EU applicant
   ```

5. Save the output as `data/research/course-requirements-YYYY-MM-DD.json`.
6. **Dry-run one record first**, to prove the envelope parses before you
   commit a whole batch to a format:

   ```bash
   npx tsx scripts/ingest-requirements.ts --dry-run one-record.json
   ```

   (The envelope below has been checked against this ingest, including with
   `records` as the last key — but check yours, not mine.)

7. **Dry-run the full batch before it becomes data:**

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

## Before anything else: the two checks that decide if a record is real

### 1. The course must exist, in the catalogue, at this level

Before you research requirements, confirm the **exact course title exists on an
official programme page** for that institution and entry level (undergraduate
unless told otherwise).

`primarySourceUrl` must be **that programme page** — not the university's
admissions homepage, not a faculty index, not a search-results URL.

An earlier wave built its course list from general knowledge rather than from
catalogues, and produced records for programmes that do not exist under those
titles. A requirement attached to an invented course is worse than no record:
it looks researched.

If the title I gave you does not appear in the catalogue, do **not** substitute
the closest match. Report it under `unmatchedCourses` with what you did find,
and move on. Renaming a course is my job, not yours.

### 2. The requirement must be for the course, not for the university

An institution-wide admissions page can support a genuinely institution-wide
rule — the application route, an English-language threshold applied to all
programmes, an interview policy that covers everything. It **cannot** support a
course's grades, subjects, admissions test, or quota.

In the last batch, 48% of everything that landed carried only "apply through
UCAS" — true, university-wide, and no help at all to someone choosing A levels.

So: if the only page you can find is institution-wide, you may record the
fields it genuinely covers, and every course-specific field stays `null`. Do not
promote a university-wide statement into a course requirement.

### The applicant profile is part of the question

I will give you an **entry year** and an **applicant profile** (qualification,
and residence/nationality where it matters). Continental European requirements
routinely differ by qualification, by EU/non-EU status, by teaching language and
by route — "university + course + country" does not identify one requirement.

Research **only** the profile I give you. Where a page states requirements for
several routes, take the one that matches and say so in the `value`:

> `"A*AA including Chemistry — GCE A level route, international applicant"`

That prefix matters: the app compares subjects and admissions tests
mechanically against what a student has recorded, so a requirement captured for
the wrong route produces a wrong verdict rather than a harmless extra line. If a
page does not distinguish routes and you cannot tell whether it applies to the
stated profile, the field is `null`.

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

7. **Never state, estimate or imply an applicant's chances** in a requirement
   field. No odds of getting in, no "competitive for", no inventing a figure.

   Two things this does **not** forbid, because both are sourced facts rather
   than predictions:

   - **The `acceptanceRate` object is exempt.** It is permitted internal
     metadata, it is never rendered to a student, and recording an officially
     published rate there is the correct place for it.
   - **A published threshold that happens to be a number or a percentage is a
     requirement, not a chance.** A Spanish `nota de corte`, a Dutch decentrale
     selectie ranking, an Italian graduatoria position, a "top 10% of your
     cohort" rule — record all of these in the relevant requirement field, with
     the quote. What is banned is *your* estimate of whether a given student
     would clear it.

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

**Quote in the source's language, write `value` in English.** The `quote` must
be verbatim from the page — German stays German, Italian stays Italian.
Translating it destroys the thing a quote is for, which is that someone can find
that string on that page a year from now. The `value` beside it is your concise
English rendering of the same fact, and it must name the applicant route it
applies to. So:

> `"quote": "Für den Studiengang Physik besteht kein Numerus Clausus."`
> `"value": "No NC — open admission for Physics; GCE A level route, international applicant"`

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

So: **a record needs at least one fully-sourced requirement field.**

And a stronger floor, which the validator does not enforce but I am asking you
to hold to: **at least one of these five**, the fields a student can actually
plan around —

`gradeRequirement` · `requiredSubjects` · `admissionsTest` ·
`languageRequirement` · `restrictedEntry`

A record whose only content is `applicationRoute`, `interview` or
`workExperience` will be accepted and then counted as thin in the ingest report.
48% of the last batch was exactly that. It inflates coverage without helping
anyone choose a subject, and it is the visible symptom of having read an
institution-wide page instead of a course page.

If you cannot source one of those five for a course, do not emit a record for
it. List it under `noSourceableData` instead. That is a good outcome, reported
rather than hidden.

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

### 4. `cycleYear` is the year the student STARTS the course

An integer, no quotes, no `"2026/27"`. **For this run, use the entry year given
in the run header** — if that is 2027, every record says `2027`.

Only cite a source that is explicitly applicable to that entry year. This is the
distinction that went wrong before: a page headed "2026/27" is an *academic
year*, and it may be describing entry in 2026, not 2027. If a page does not
state which entry it governs, you have not confirmed it.

If the only page you can find is for an earlier entry year, you have two honest
options and no third:

- record it with the **earlier** `cycleYear` and `stale: true`, so the app
  labels it "not confirmed current" to the student; or
- omit the record entirely.

Never relabel an older page with the target year. The validator additionally
refuses any `cycleYear` more than three years from today (for a 2026 run:
2023–2029), and `stale: true` does not exempt you from that bound.

### 5. `country` must be one of these exact codes

Uppercase codes from **the app's permitted-country list**, below. Most are ISO
3166-1 alpha-2, but the list is not ISO — `OT` means "Other" and exists only in
this app. Do not derive a code from the ISO standard; take it from here.
Nothing outside this list can ever be paired with a student's target:

```
AE AT AU BD BE BG BR CA CH CL CN CO CZ DE DK EE EG ES FI FR GB GH GR HK HR
HU ID IE IL IN IS IT JO JP KE KR KW LB LK LT LU LV MX MY NG NL NO NZ OT PH
PK PL PT QA RO RS RU SA SE SG SI SK TH TR TW UA US VN ZA
```

**`UK` is not on it**, and that is the single most damaging mistake available to
you, because it is not rejected: it is stored, and then matches no student ever,
because the app records the United Kingdom as `GB`. Same for `EN`, `USA`, `UAE`.

Use the code on the input line. If a line has none, take it from this list and
say which you chose in your report.

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

`stale` defaults to `false`, so it may be left out when false.

**`omitted` is not optional in practice: every `null` requirement field must
have exactly one matching entry** saying what you looked for and why you
stopped. Eight fields, so a record with three sourced facts carries five
`omitted` entries. The validator will accept a record without them; I am asking
for them because they are the only way to tell "no such requirement exists for
this course" apart from "I could not find the page", and those call for
completely different follow-up work. Each `reason` must be at least 10
characters — "not found" is refused by the schema anyway.

Extra fields outside this shape are discarded rather than rejected — but do not
add them.

### Delivering the output

Earlier versions of this brief asked for four things that cannot all be true at
once — stream records as you go, emit one final array, emit no prose, and report
at the end. Here is the single answer.

**Work in two phases, and never type the same record twice.**

**Phase 1 — as you go, for recovery only.** After each course, emit one fenced
```json block containing that one record and nothing else. This exists so an
interrupted run leaves behind what it completed. Work through the list **in the
order given**.

**Phase 2 — one envelope, assembled and not retyped.** When you finish, or when
you are stopping early, produce the envelope below **as a file** named
`course-requirements-YYYY-MM-DD.json`, assembling `records` from the phase-1
blocks you already emitted.

Do **not** paste a second copy of every record into the conversation. On a batch
of any size that doubles your output, and the usual results are a truncated
final block, a silently dropped course, or one course appearing twice — all of
which look like a complete file.

If you cannot write a file, emit the envelope in **numbered chunks** —
`{"part": 1, "of": 4, "records": [ ... ]}` — each small enough to be in no
danger of being cut off, then one final block carrying `noSourceableData`,
`unmatchedCourses` and `unreached` with `"records": []`. Never one enormous
final message.

The envelope:

```json
{
  "records": [],
  "noSourceableData": [
    {
      "university": "Heidelberg University",
      "course": "Physics B.Sc.",
      "country": "DE",
      "reason": "Searched hochschulstart.de and the faculty pages in German; the programme is open-admission with no stated NC, and no page states subject or language requirements for 2027 entry."
    }
  ],
  "unmatchedCourses": [
    {
      "given": "Imperial College London | Data Science B.Sc.",
      "found": "Closest catalogue entries are 'Mathematics with Statistics for Finance' and an MSc in Computing (Data Science). No undergraduate Data Science B.Sc. listed."
    }
  ],
  "unreached": ["KU Leuven | Law | BE"]
}
```

`records` is shown empty only so this example is itself valid JSON — fill it
with the phase-1 records, in order.

The ingest reads `records` **by name**, so key order does not matter and the
other three lists cost nothing to include. They are for me, not for the
database: `noSourceableData` says a course was genuinely researched and came up
empty, `unmatchedCourses` says my own input list was wrong, and neither is
recoverable from a file that simply omits them.

**Prose is allowed in exactly one place**: a short plain-text report after the
final block, covering the counts listed at the end of this brief. Nowhere else —
no commentary between records, no summary of what you found, no rankings, no
comparisons, no advice about where to apply.

## Pre-flight check — run this on every record before you emit it

Go field by field. If any answer is wrong, fix the record rather than emitting
it. Items 1–9 are enforced mechanically; 10–15 are the ones that produced real
damage in earlier waves.

1. Does **every** non-null requirement field have all three of `value`, `quote`,
   `sourceUrl`? (A partial field discards the whole course.)
2. Is at least one of **`gradeRequirement`, `requiredSubjects`,
   `admissionsTest`, `languageRequirement`, `restrictedEntry`** non-null? If
   not, this belongs in `noSourceableData`, not in `records`.
3. Is every `quote` **at least 15 characters** and copied verbatim?
4. Is every `value` **at most 450 characters**?
5. Does every URL start `https://`, and is none on a banned host?
6. Is `cycleYear` the **entry year from the run header**, as a bare integer —
   or an earlier year with `stale: true`, never a relabelled old page?
7. Is `country` on the code list — **`GB` and never `UK`**?
8. Is `gatheredOn` exactly `YYYY-MM-DD`?
9. Does every `null` requirement field have exactly one `omitted` entry, with a
   `reason` of at least 10 characters?
10. Did I confirm this **exact course title on an official programme page**, and
    is `primarySourceUrl` that page rather than an admissions homepage?
11. Is every course-specific fact from a **course** page? Did I promote any
    university-wide statement into a course requirement?
12. Do the requirements match the **applicant profile in the run header** —
    qualification, and residence/nationality where the page distinguishes them?
    Does each route-specific `value` say which route it describes?
13. Is `university` the full official name, and `course` the catalogue's own
    title including any code?
14. Have I emitted this `university + country + course` only once? (A second
    record silently overwrites the first — there is no room in the key for a
    qualification.)
15. Could I have confused this with a different campus or entry route (standard
    vs. graduate vs. foundation)?

## Report at the end

Plain text, after the final JSON envelope:

- Pairs given, records emitted, and the entry year and applicant profile used.
- How many records carry each of the five decision-relevant fields.
- Counts for `noSourceableData`, `unmatchedCourses` and `unreached`.
- Any country codes you had to choose yourself.
- How many fields you left `null` in total.

**A high null count is a good outcome.** It means the tool will ask students to
verify rather than telling them something untrue. A high `noSourceableData`
count is also a good outcome — it is the honest form of the 345 empty records
the last run emitted and lost. What is *not* a good outcome is a record that
exists to say "apply through UCAS".
