// Shared rendering helpers for evaluation prompts.
//
// The prompt TEXT is what gets versioned (v1.ts, v2.ts). Turning the snapshot
// and rubrics into text is mechanical, so it lives here and is shared — keeping
// a formatting fix from having to be made in every version.
import { getRubric, renderRubric, rubricsForCountries } from "@/lib/rubrics";
import type { EvaluationSnapshot } from "@/lib/evaluation/snapshot";
import type { SnapshotDiff } from "@/lib/evaluation/diff";

/** Compact, readable rendering of the student's data. */
export function renderSnapshot(s: EvaluationSnapshot): string {
  const st = s.student;
  const lines: string[] = [];

  lines.push("## Student");
  lines.push(`- Grade level: ${st.gradeLevel ?? "not stated"}`);
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
  if (s.resumeItems.length === 0) {
    lines.push("- None recorded.");
  } else {
    for (const i of s.resumeItems) {
      const when =
        i.startDate || i.endDate
          ? ` [${i.startDate ?? "?"} to ${i.endDate ?? "present"}]`
          : "";
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
  lines.push("Scores you gave last time:");
  lines.push(
    `- overallScore: ${p.overallScore ?? "not recorded"}`,
  );
  lines.push(
    `- gradeRelativeScore: ${p.gradeRelativeScore ?? "not recorded"}`,
  );
  const fits = Object.entries(p.fitScores);
  if (fits.length > 0) {
    lines.push("- fitScore per school:");
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
  if (diff.unchanged) {
    lines.push(
      "THE PROFILE IS UNCHANGED. Your scores must therefore stay essentially the same as last time (within a point or two). Drifting on identical input would tell the student their work changed something when it did not.",
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
