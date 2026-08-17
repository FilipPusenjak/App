# Research waves

Raw output from the course-requirements research brief
(`lib/prompts/research/course-requirements-v1.md`), one file per wave, named
by the date it was gathered.

These are checked in for two reasons. The practical one is that the ingest has
to run from a machine that can reach the production database, which is not
always the machine the research landed on — the repo is the transfer channel
that always works. The better one is that a row in `CourseRequirement` says
what the app believes; this says where that belief came from, and lets an
ingest be re-run or audited later without redoing the research.

Nothing here is personal data. It is public admissions information plus the
source URL each fact was quoted from.

## Ingesting a wave

Dry run first — it validates and reports without writing anything:

    DATABASE_URL="<production>" npx tsx scripts/ingest-requirements.ts \
      --dry-run data/research/course-requirements-2026-08-09.json

Then drop `--dry-run` to write. Rows upsert on `matchKey`, so re-running a
wave is safe and a later wave supersedes an earlier one course by course.

Expect a large number of rejections. A record with no sourced requirement is
refused on purpose: an empty row claims the app looked and found nothing,
which is a different and more misleading thing than never having looked.

| Wave | Records | Accepted | Rejected |
| --- | --- | --- | --- |
| 2026-08-09 | 1185 | 839 | 346 |

## Size

These files are a few megabytes each. If the directory ever becomes a burden,
the ingested rows are the thing that matters and these can be moved to release
assets or object storage without changing any code.
