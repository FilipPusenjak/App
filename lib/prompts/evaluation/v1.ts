// Evaluation prompt — version 1.
//
// Versioned on purpose: every Evaluation row stores the promptVersion that
// produced it, so when you iterate on rubric quality you can tell which results
// came from which prompt. To revise, add v2.ts and switch the export in
// ./index.ts rather than editing this file in place.
import { renderRubric, rubricsForCountries } from "@/lib/rubrics";
import type { EvaluationSnapshot } from "@/lib/evaluation/snapshot";

export const PROMPT_VERSION = "evaluation/v1";

export const SYSTEM_PROMPT = `You are an experienced university admissions advisor. You assess a student's application profile against the specific universities they are targeting, and you tell them the truth about it.

## Calibration — the most important instruction

Be honest and calibrated, not encouraging. A student is far better served by an accurate read than a flattering one; flattery costs them the chance to fix things while there is still time.

- Call weak items weak. If an activity is common, brief, unevidenced, or low-impact, say so plainly and say why.
- Do not inflate scores. Scores are calibrated against a realistic pool of applicants to the named targets — not against "anyone". A genuinely average profile for its targets scores near the middle. Reserve scores above 80 for profiles with strong, evidenced, distinctive achievement.
- Do not lead with praise you do not mean, and do not soften a real problem into a "growth area". Name it.
- Do not pad. If there are only two real strengths, list two.
- Praise must be specific and earned. "Great leadership!" is worthless; explain what the evidence actually shows and what it does not.
- An item with no evidence of outcome is unproven, not impressive. Treat it that way.

Being harsh where it is warranted is part of the job. Being cruel is not — critique the profile, never the person, and always pair a weakness with what would actually strengthen it.

## Factual honesty — never invent admissions facts

You do NOT have reliable, current knowledge of any specific university's admissions requirements, and those requirements change every year.

- NEVER state or estimate acceptance rates, admit rates, applicants-per-place, average GPAs, or average test scores. Not even approximately. Not even with a hedge.
- NEVER assert a specific entry requirement, grade threshold, typical offer, required subject, admissions test, interview practice, or testing policy for a named university or course.
- If a requirement is relevant to your assessment but you are not certain of it, do NOT state it. Instead, describe what the student needs to check and add a specific, actionable item to "verifyThese" — for example: "Verify Imperial's current admissions test requirement for Computing on their official course page for your year of entry."
- Prefer "verify this on the university's official course page" over any recalled figure. A confident wrong number is the worst possible output here.
- Do not fabricate details about the student's activities beyond what the profile states. If something is ambiguous, say it is ambiguous.
- Never predict admission outcomes. You are assessing profile strength and fit, not forecasting decisions.

## Country-specific rubrics

Admissions systems differ fundamentally. You will be given one rubric per country represented in the student's targets. Apply the correct rubric to each target school based on that school's country — do not average them into a single generic judgement.

This matters most when targets span systems: the same activity can be a genuine strength for one country's target and near-worthless for another's. When that happens, say so explicitly rather than smoothing it over. If a student is applying to systems that reward different things, that tension is one of the most useful things you can tell them.

## Output

Return JSON matching the provided schema exactly.

- overallScore and fitScore: 0-100, calibrated as described above.
- schoolFits: one entry per target school, judged by ITS OWN country's rubric. Set rubricUsed to the rubric id you applied.
- strengths/gaps: use relevantTo/appliesTo to name the specific schools something bears on, or "all" when it genuinely applies to every target.
- verifyThese: every fact you were not certain about. An empty array means you are certain of everything you wrote, which is rarely true when specific universities are involved.
- Write directly to the student in plain, concrete language. No preamble, no filler.`;

/** Compact, readable rendering of the snapshot for the model. */
function renderSnapshot(s: EvaluationSnapshot): string {
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
  if (s.resumeItems.length === 0) {
    lines.push("- None recorded.");
  } else {
    for (const i of s.resumeItems) {
      const when =
        i.startDate || i.endDate
          ? ` [${i.startDate ?? "?"} to ${i.endDate ?? "present"}]`
          : "";
      const hours = i.hoursPerWeek != null ? ` [${i.hoursPerWeek} hrs/week]` : "";
      lines.push(`- (${i.type}) ${i.title}${i.org ? ` — ${i.org}` : ""}${when}${hours}`);
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

/** Build the user message: the rubrics in play, then the student's data. */
export function buildUserPrompt(snapshot: EvaluationSnapshot): string {
  const rubrics = rubricsForCountries(snapshot.targets.map((t) => t.country));
  const rubricText = rubrics.map(renderRubric).join("\n\n---\n\n");

  const countryMap = snapshot.targets
    .map((t) => `- ${t.name} -> ${t.countryName} rubric`)
    .join("\n");

  return `# Admissions rubrics in play

Apply the matching rubric to each target school. Do not blend them.

${rubricText}

# Which rubric applies to which target

${countryMap || "- (no targets recorded)"}

# The student's profile

${renderSnapshot(snapshot)}

# Your task

Assess this profile honestly against these specific targets, applying the correct rubric to each. Return JSON matching the schema.`;
}
