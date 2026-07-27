// Shared rendering helpers for evaluation prompts.
//
// The prompt TEXT is what gets versioned (v1.ts, v2.ts). Turning the snapshot
// and rubrics into text is mechanical, so it lives here and is shared — keeping
// a formatting fix from having to be made in every version.
import { renderRubric, rubricsForCountries } from "@/lib/rubrics";
import type { EvaluationSnapshot } from "@/lib/evaluation/snapshot";

/** Compact, readable rendering of the student's data. */
export function renderSnapshot(s: EvaluationSnapshot): string {
  const st = s.student;
  const lines: string[] = [];

  lines.push("## Student");
  lines.push(`- Grade level: ${st.gradeLevel ?? "not stated"}`);
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
        `- ${t.name} (${t.countryName}) — course: ${t.course ?? "NOT SPECIFIED"} — student's tag: ${t.classification}${t.priority != null ? ` — priority ${t.priority}` : ""}`,
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

/** Explicit school -> rubric mapping so the model can't blend them. */
export function renderRubricMapping(s: EvaluationSnapshot): string {
  return (
    s.targets.map((t) => `- ${t.name} -> ${t.countryName} rubric`).join("\n") ||
    "- (no targets recorded)"
  );
}
