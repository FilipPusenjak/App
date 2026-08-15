// Shared rendering helpers for evaluation prompts.
//
// The prompt TEXT is what gets versioned (v1.ts, v2.ts). Turning the snapshot
// and rubrics into text is mechanical, so it lives here and is shared — keeping
// a formatting fix from having to be made in every version.
import { getRubric, renderRubric, rubricsForCountries } from "@/lib/rubrics";
import type { EvaluationSnapshot } from "@/lib/evaluation/snapshot";
import type { SnapshotDiff } from "@/lib/evaluation/diff";
import { SCORE_KEYS, SCORE_LABELS, type ScoreKey } from "./versions";

const DAY_MS = 86_400_000;

/**
 * Parse a `YYYY-MM-DD` (or full ISO) string as a UTC day.
 *
 * Day precision on both sides deliberately: comparing a date-only start against
 * a timestamped `capturedAt` at full precision makes something started this
 * morning "under a day", which is a distinction nobody wants stated.
 */
function parseDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / DAY_MS);
}

/** Whole calendar months between two days, not an average-length approximation. */
function monthsBetween(a: Date, b: Date): number {
  let months =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return months;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** A span in the unit a person would actually use for it. */
function humanDuration(from: Date, to: Date): string {
  const days = daysBetween(from, to);
  if (days < 1) return "less than a day";
  if (days < 14) return plural(days, "day");
  const months = monthsBetween(from, to);
  if (months < 2) return plural(Math.floor(days / 7), "week");
  // Years as soon as there is one. The prompt tells the model to weigh "years
  // sustained" heavily, and "23 months" buries exactly that: a two-year
  // commitment should not have to be converted before it registers as one.
  if (months < 12) return plural(months, "month");
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0
    ? plural(years, "year")
    : `${plural(years, "year")} ${plural(rest, "month")}`;
}

/**
 * How long a resume item has run, stated in words rather than left as arithmetic.
 *
 * The model was given `[2026-08-08 to present]` and nothing else — no statement
 * of what "present" was — and described a project started a week earlier as
 * "a month or two in with no shipped product". It had no way to do better: with
 * no reference point, elapsed time is a guess, and the guess landed on the
 * training-data prior rather than on this student.
 *
 * Rendering today's date fixes the missing reference point, but a date pair
 * still leaves the model doing calendar arithmetic mid-judgement. So the
 * duration is computed here and handed over as a phrase. It is the difference
 * between an item's effort being read correctly and a student being told their
 * week-old project is behind schedule.
 */
export function describeSpan(
  startDate: string | null,
  endDate: string | null,
  capturedAt: string,
): string {
  if (!startDate && !endDate) return "";

  const shown = `${startDate ?? "?"} to ${endDate ?? "present"}`;
  const start = parseDay(startDate);
  const end = parseDay(endDate);
  const today = parseDay(capturedAt);

  const wrap = (note: string) => ` [${shown}${note ? ` — ${note}` : ""}]`;

  // A start is what a duration is measured from. Without one, say so rather
  // than let the gap be filled in.
  if (!start) return wrap("no start date given, so how long this ran is unknown");
  if (!today) return wrap("");

  if (end) {
    if (end.getTime() < start.getTime()) {
      return wrap("the end date is before the start date, so the dates are unreliable");
    }
    if (end.getTime() <= today.getTime()) {
      return wrap(`ran ${humanDuration(start, end)}, now finished`);
    }
    // Ends in the future: running now, with a planned end.
    if (start.getTime() <= today.getTime()) {
      return wrap(
        `${humanDuration(start, today)} so far, scheduled to run until ${endDate}`,
      );
    }
    return wrap(`has not started yet — begins in ${humanDuration(today, start)}`);
  }

  if (start.getTime() > today.getTime()) {
    return wrap(`has not started yet — begins in ${humanDuration(today, start)}`);
  }
  return wrap(`${humanDuration(start, today)} so far, still ongoing`);
}

/**
 * How far off a planned date is, for the same reason spans are computed.
 *
 * A projection is a judgement about what fits in the time remaining, so a bare
 * "Target date: 2026-12-01" leaves the single most important variable to be
 * inferred. It also catches the case a plan quietly rots into: a target date
 * that has already gone by, which should be named rather than read as upcoming.
 */
export function describeLeadTime(
  targetDate: string | null,
  capturedAt: string,
): string {
  const target = parseDay(targetDate);
  const today = parseDay(capturedAt);
  if (!target || !today) return "";

  const days = daysBetween(today, target);
  if (days === 0) return " — that is today";
  if (days < 0) {
    return ` — that date has already PASSED (${humanDuration(target, today)} ago), so this plan is overdue rather than upcoming`;
  }
  return ` — ${humanDuration(today, target)} from now`;
}

/** Compact, readable rendering of the student's data. */
export function renderSnapshot(s: EvaluationSnapshot): string {
  const st = s.student;
  const lines: string[] = [];
  const today = s.capturedAt.slice(0, 10);

  lines.push(`## Today's date: ${today}`);
  lines.push(
    `Every judgement about what is current, how long something has run, and how much time remains is relative to ${today}. Do not assume any other date, and do not estimate how long an item has been going — the elapsed time is stated on each item below.`,
  );
  lines.push("");

  lines.push("## Student");
  lines.push(
    `- Grade level: ${st.gradeLevel ?? "not stated"} — this is the grade the student is currently IN, or has JUST COMPLETED. Read it together with today's date: late in a school year or over the summer it most likely means the year is finished and the next one is about to start, so do not assume they still have the whole of that year ahead of them.`,
  );
  lines.push(`- School: ${st.schoolName ?? "not stated"}`);
  lines.push(
    `- School context (rigor, courses offered, grading): ${st.schoolContext ?? "NOT PROVIDED — say that GPA cannot be fully judged without it"}`,
  );
  lines.push(`- Curriculum: ${st.curriculum ?? "not stated"}`);
  lines.push(
    `- GPA: ${st.gpa != null ? `${st.gpa}${st.gpaScale ? ` (scale ${st.gpaScale})` : ""}` : "not stated"}`,
  );
  lines.push(`- Intended major: ${st.intendedMajor ?? "not stated"}`);
  lines.push(`- Career goal: ${st.careerGoal ?? "not stated"}`);
  lines.push(
    `- Country of origin: ${st.countryOfOrigin ?? "not stated"} (relevant to domestic vs international status)`,
  );

  lines.push("");
  lines.push("## Test scores and predicted grades");
  if (s.testScores.length === 0) {
    lines.push("- None recorded.");
  } else {
    for (const t of s.testScores) {
      lines.push(
        `- ${t.label} (${t.kind}): ${t.score}${t.maxScore ? ` / ${t.maxScore}` : ""}${t.predicted ? " [PREDICTED]" : ""}`,
      );
    }
  }

  lines.push("");
  lines.push("## Resume items");
  lines.push(
    "Each item has a reference like [R1]. Use that exact reference as itemRef when assessing it.",
  );
  // Without this, hours/week gets read as a commitment score: a normal school
  // club (about an hour a week) was being rated down for meeting as often as
  // clubs actually meet.
  lines.push(
    "Hours per week, where given, is CONTEXT — not a measure of quality. About an hour a week is the standard cadence for a school club and says nothing bad about it. Weigh years sustained, role held, and what was produced far above hours.",
  );
  // Judging effort against an imagined timeline is the specific failure here:
  // a project a week old was told it should have shipped by now.
  lines.push(
    "Elapsed time is stated on each item and is computed from today's date — use it exactly as given. Never estimate or round it up, and never say an item is further along than the stated span. Judge what it is reasonable to have produced in THAT amount of time: something a week old is at its beginning, and having nothing finished yet is the expected state, not a shortfall. Where a span says the duration is unknown, treat it as unknown rather than assuming one.",
  );
  if (s.resumeItems.length === 0) {
    lines.push("- None recorded.");
  } else {
    for (const i of s.resumeItems) {
      const when = describeSpan(i.startDate, i.endDate, s.capturedAt);
      const hours = i.hoursPerWeek != null ? ` [${i.hoursPerWeek} hrs/week]` : "";
      lines.push(
        `- [${i.ref}] (${i.type}) ${i.title}${i.org ? ` — ${i.org}` : ""}${when}${hours}`,
      );
      if (i.description) lines.push(`    Description: ${i.description}`);
      if (i.evidenceNotes) lines.push(`    Evidence: ${i.evidenceNotes}`);
    }
  }

  lines.push("");
  lines.push("## Target schools");
  if (s.targets.length === 0) {
    lines.push("- None recorded.");
  } else {
    for (const t of s.targets) {
      lines.push(
        `- ${t.name} (${t.countryName}) — course: ${t.course ?? "NOT SPECIFIED"}${t.priority != null ? ` — student's priority ${t.priority}` : ""} — YOU must classify this as reach/match/safety`,
      );
      if (t.notes) lines.push(`    Notes: ${t.notes}`);
    }
  }

  return lines.join("\n");
}

/** The rubrics needed for this snapshot's targets, rendered as text. */
export function renderRubricSection(s: EvaluationSnapshot): string {
  const rubrics = rubricsForCountries(s.targets.map((t) => t.country));
  return rubrics.map(renderRubric).join("\n\n---\n\n");
}

/**
 * The previous evaluation and what has changed since — the anti-drift section.
 *
 * Returns null when this is the student's first evaluation.
 */
export function renderPreviousContext(diff: SnapshotDiff | null): string | null {
  if (!diff) return null;

  const lines: string[] = [];
  const p = diff.previousScores;

  lines.push(
    `Your previous evaluation was captured ${diff.previousAt.slice(0, 10)}.`,
  );
  lines.push("");
  const rescored = p.rescoredKeys ?? [];
  const isRescored = (key: ScoreKey) => rescored.includes(key);
  const stable = SCORE_KEYS.filter((key) => !isRescored(key));
  // Marks the individual numbers, so the model does not have to hold the list
  // in its head while reading them.
  const mark = (key: ScoreKey) => (isRescored(key) ? "  [REDEFINED — not a baseline]" : "");

  lines.push("Scores from that run:");
  lines.push(
    `- overallScore: ${p.overallScore ?? "not recorded"}${mark("overallScore")}`,
  );
  lines.push(
    `- gradeRelativeScore: ${p.gradeRelativeScore ?? "not recorded"}${mark("gradeRelativeScore")}`,
  );
  const fits = Object.entries(p.fitScores);
  if (fits.length > 0) {
    lines.push(`- fitScore per school:${mark("fitScore")}`);
    for (const [school, score] of fits) {
      lines.push(`    ${school}: ${score}`);
    }
  }

  lines.push("");
  lines.push("What the student changed since then:");
  const bullets: string[] = [];
  const list = (label: string, values: string[]) => {
    if (values.length > 0) bullets.push(`- ${label}: ${values.join("; ")}`);
  };
  list("ADDED resume items", diff.addedItems);
  list("REMOVED resume items", diff.removedItems);
  list("ADDED test scores", diff.addedTestScores);
  list("REMOVED test scores", diff.removedTestScores);
  list("ADDED targets", diff.addedTargets);
  list("REMOVED targets", diff.removedTargets);
  list("CHANGED fields", diff.changedFields);
  if (bullets.length === 0) {
    bullets.push("- Nothing. The profile is identical to last time.");
  }
  lines.push(...bullets);

  lines.push("");

  // A redefinition and the stability rule are direct opposites: for a
  // redefined score the stability rule is not merely unhelpful, it pins the new
  // number to a measurement of something else. But the release is PER SCORE.
  // Releasing all of them together because one changed is how a readiness
  // score fell eight points with nothing behind it.
  if (rescored.length > 0) {
    const names = rescored.map((key) => SCORE_LABELS[key]).join(", ");
    lines.push(
      `THE DEFINITION OF ${names.toUpperCase()} HAS CHANGED SINCE THAT EVALUATION. Those numbers measured something else. They are NOT a baseline.`,
    );
    lines.push(
      "For those scores only: do NOT hold near the old number, and do NOT treat a difference as drift needing justification. Work each out from the definitions in your instructions as if scoring this profile for the first time. If the right answer under the current definitions is far from the old one, that IS the right answer.",
    );
    lines.push(
      "In changeSinceLast, say plainly that the way those scores are defined has changed, so the student reads a move as a change in the measurement rather than a change in them.",
    );
    if (stable.length > 0) {
      lines.push("");
      lines.push(
        `${stable.map((key) => SCORE_LABELS[key]).join(" and ").toUpperCase()} ARE DEFINED EXACTLY AS BEFORE. The rules below apply to them in full, and a redefinition elsewhere is not a reason for them to move.`,
      );
    }
    lines.push("");
  }

  // Consistency rules. When some scores were redefined these govern the rest,
  // which is why the block is scoped rather than skipped.
  const scope =
    rescored.length === 0
      ? ""
      : stable.length === 0
        ? null
        : ` This applies to ${stable.map((key) => SCORE_LABELS[key]).join(" and ")}.`;

  if (scope === null) {
    // Every score was redefined; there is nothing left to hold steady.
    lines.push(
      "Use changeSinceLast to tell the student plainly what moved, in which direction, and why — referring to what they actually changed.",
    );
    return lines.join("\n");
  }

  if (diff.unchanged) {
    lines.push(
      `THE PROFILE IS UNCHANGED. Your scores must therefore stay essentially the same as last time (within a point or two). Drifting on identical input would tell the student their work changed something when it did not.${scope}`,
    );
  } else if (diff.onlyGained) {
    lines.push(
      "THE PROFILE ONLY GAINED CONTENT — nothing was removed or emptied. A score MUST NOT FALL in this situation. The student did more work; a number that drops when they add work is telling them a lie and destroys their reason to keep going.",
    );
    lines.push(
      "The one exception: an addition can genuinely weaken a profile (for example, it contradicts their stated goals, or it reveals a commitment was much shorter than assumed). If you lower a score, you MUST name that specific addition and explain the damage in changeSinceLast. If you cannot name one, the score does not go down.",
    );
    lines.push(
      "Note also that a modest addition may simply not move the number much. Holding a score steady and saying why is honest; lowering it for having more to critique is not.",
    );
  } else {
    lines.push(
      "Content was removed or replaced as well as added. Judge the profile as it now stands, and account for the movement in changeSinceLast.",
    );
  }
  lines.push("");
  lines.push(
    "Use changeSinceLast to tell the student plainly what moved, in which direction, and why — referring to what they actually changed.",
  );

  return lines.join("\n");
}

/**
 * Explicit school -> rubric mapping so the model can't blend them.
 *
 * Names the rubric ACTUALLY APPLIED, by id. It used to say
 * "Trinity College Dublin -> Ireland rubric", which describes a rubric that
 * does not exist: Ireland has no entry in the registry, so that target is
 * judged by the generic fallback. The model was then handed a rubric titled
 * "General (no country-specific rubric)" with no way to connect the two, and
 * produced a self-contradicting section claiming no generic targets were
 * listed while scoring one.
 */
export function renderRubricMapping(s: EvaluationSnapshot): string {
  if (s.targets.length === 0) return "- (no targets recorded)";

  return s.targets
    .map((t) => {
      const rubric = getRubric(t.country);
      const generic = rubric.id === "generic";
      return (
        `- ${t.name} (${t.countryName}) -> ${rubric.name} [id: ${rubric.id}]` +
        (generic
          ? " — no country-specific rubric exists for this country, so it is judged generically. Say so plainly rather than implying a national rubric was applied."
          : "")
      );
    })
    .join("\n");
}
