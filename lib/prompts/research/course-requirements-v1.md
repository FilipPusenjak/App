# Research brief — UK & EU course entry requirements (v1)

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

**On cost.** Adding this to an evaluation costs almost nothing: input is ~22% of
a run, and 200–300 tokens per course works out at 1–2% of the total. Density is
requested for attention and latency reasons, not money. Do not let the agent
drop a fact to save space.

## How to run it

1. Open a Claude conversation with **web research enabled**.
2. Paste everything below the line.
3. Then paste your list of targets, one per line, as `University | Course`:

   ```
   University of Cambridge | Medicine (A100)
   Trinity College Dublin  | Medicine
   Utrecht University      | Liberal Arts and Sciences
   ```

   Use the courses your students are **actually targeting**. This is
   demand-driven on purpose — there are tens of thousands of course/university
   pairs and no reason to gather one nobody has picked.

4. When it finishes, save the output to Google Drive (or send me the file) and
   tell me. The brief asks it to name the file for you.

---

You are researching university entry requirements that will be fed directly
into a tool used by 14–18 year old students to plan their applications. **No
human will check your output before students see its effects.**

That single fact governs everything below. A missing requirement makes the tool
say "we don't know — check the course page", which is safe. A *wrong*
requirement makes it confidently tell a 15-year-old to drop Chemistry. Omitting
is cheap. Being wrong is not.

## What to research

I will give you a list of (university, course) pairs. For each one, find the
official entry requirements for the **current or next admissions cycle**.

Gather only these fields. They map onto the criteria the tool actually scores
against, and anything else is noise:

| Field | What it is | Applies to |
|---|---|---|
| `gradeRequirement` | The headline offer, e.g. "A*AA", "38 points IB", "8.0 GPA" | UK, EU |
| `requiredSubjects` | Subjects that must be taken, and at what grade | UK, EU |
| `admissionsTest` | UCAT, LNAT, TSA, MMI, national entrance exam — name and whether required | UK, EU |
| `languageRequirement` | Language of instruction, and the test score that proves it | EU mainly |
| `interview` | Whether interviews form part of selection | UK, EU |
| `workExperience` | Required or expected experience (common for Medicine, Nursing, Education) | UK, EU |
| `restrictedEntry` | Numerus clausus, quota, or capped-place systems | EU mainly |
| `applicationRoute` | UCAS, Studielink, national portal — and the deadline if stated | UK, EU |
| `acceptanceRate` | Admission or offer rate, **if officially published** | Both |

## Sourcing rules — these are not guidance

1. **Official sources only.** The university's own admissions or course page, or
   the national admissions body (UCAS, Studielink, DUO, Uni-Assist, the
   ministry). Not league tables, not The Student Room, not a blog, not an agency
   site, not a summary written by someone else.

2. **Every fact needs a verbatim quote and the URL it came from.** If you cannot
   quote the source saying it, you do not have it. The quote is what makes the
   claim checkable months from now without redoing the work.

3. **Never infer across courses.** Requirements for Medicine at a university
   tell you nothing about Dentistry there. If you did not find the page for the
   exact course, the field is unknown.

4. **Never carry a requirement across cycles.** If the page states a year, record
   it. If the only page you can find is for a past cycle, say so in `cycleYear`
   and mark `stale: true` rather than assuming it still holds.

5. **When sources disagree, omit and say so.** Two official pages giving
   different grades is a real finding and the tool can handle "unknown". A
   confident average of the two is a fabrication.

6. **Never convert between grading systems.** Record what the page says. "A*AA"
   stays "A*AA"; do not helpfully translate it to a GPA or an IB score.

7. **`acceptanceRate` is for internal calibration only** and will never be shown
   to a student. Record it only if officially published, and always record its
   `scope` — a university-wide rate is a different number from a course rate,
   and neither is the rate for a given applicant. If only an unofficial figure
   exists, omit it.

## Output format

One JSON object per (university, course). No prose around them. Every field is
either a fully-sourced object or `null`.

```json
{
  "university": "University of Cambridge",
  "country": "GB",
  "course": "Medicine (A100)",
  "cycleYear": 2027,
  "stale": false,
  "gatheredOn": "2026-08-08",
  "primarySourceUrl": "https://www.undergraduate.study.cam.ac.uk/courses/medicine",
  "requirements": {
    "gradeRequirement": {
      "value": "A*A*A at A Level",
      "quote": "The typical offer for Medicine is A*A*A at A Level.",
      "sourceUrl": "https://..."
    },
    "requiredSubjects": {
      "value": "Chemistry and one of Biology, Physics or Mathematics at A Level",
      "quote": "All applicants must have Chemistry plus one of ...",
      "sourceUrl": "https://..."
    },
    "admissionsTest": null,
    "languageRequirement": null,
    "interview": {
      "value": "Required; all shortlisted applicants are interviewed",
      "quote": "...",
      "sourceUrl": "https://..."
    },
    "workExperience": null,
    "restrictedEntry": null,
    "applicationRoute": {
      "value": "UCAS, 15 October deadline",
      "quote": "...",
      "sourceUrl": "https://..."
    }
  },
  "acceptanceRate": {
    "percent": 4.5,
    "scope": "course",
    "quote": "...",
    "sourceUrl": "https://..."
  },
  "omitted": [
    {
      "field": "admissionsTest",
      "reason": "Course page references an 'admissions assessment' without naming it; no official page found confirming which test applies for this cycle."
    }
  ]
}
```

### Delivering the output

- **Emit each record as soon as you finish it**, rather than holding everything
  for one block at the end. A long run that is interrupted should leave behind
  the records it already completed, not nothing.
- When you are done, save the full set as a single file named
  **`course-requirements-YYYY-MM-DD.json`** (today's date), containing a JSON
  array of the record objects. If you can write to Google Drive, put it there.
  Otherwise output it as a single final block for the user to save.
- Work through the list **in the order given**. If you run out of time or
  budget, stop cleanly and report which pairs you did not reach — a partial set
  with a known boundary is usable; a partial set that looks complete is not.

### Rules about the output itself

- **`null` is a valid, useful answer** and is always better than a plausible
  guess. Every `null` must have a matching entry in `omitted` saying what you
  looked for and why you stopped.
- **Keep `value` dense.** One line, the substance only — no hedging, no
  restating the question, no "applicants are advised that". The quote carries
  the exact wording; `value` is the compressed fact.
- **Do not add fields.** Anything outside this shape will be discarded on
  ingest.
- **Do not summarise across the set.** No rankings, no comparisons, no advice —
  just the records.

## Before you finish

For each record, check yourself on these. If any answer is "no", change the
record rather than submitting it:

- Does every non-null field have a quote **and** a URL?
- Is every URL on the university's own domain or an official national body?
- Could I have confused this with a different course, a different campus, or a
  different entry route (standard vs. graduate vs. foundation)?
- Is the `cycleYear` what the page actually says, rather than what I assume?
- Have I recorded any figure I could not quote?

Report at the end: how many (university, course) pairs you were given, how many
records you produced, and how many fields you left `null`. **A high null count
is a good outcome, not a failure** — it means the tool will ask students to
verify rather than telling them something untrue.
