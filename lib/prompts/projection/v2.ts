// Projection prompt — version 2.
//
// v1 was inconsistent between runs, reported by a real user with screenshots.
// Four causes, all of them mine:
//
//   1. NO SCORE BANDS. The evaluation prompt defines what every number means;
//      the projection prompt defined nothing, so a projected 40 was whatever
//      the model felt that run.
//   2. NO MEMORY. Each projection was independent, so re-running on the same
//      plans produced different numbers and sometimes different worthDoing
//      verdicts. The previous projection is now supplied, and any movement has
//      to be accounted for.
//   3. INVENTED BASELINES. When the base evaluation predated per-system scores,
//      v1 said "judge current readiness yourself" — so BOTH ends of every arrow
//      were fresh guesses. In one real run the model was told overall readiness
//      was 32 and then produced per-system currents of 22, 30 and 30, which
//      reconcile with neither the 32 nor each other. Now the recorded overall
//      is a hard anchor, and the UI refuses to draw an arrow from an estimate.
//   4. JARGON IN OUTPUT. wouldMoveNeedleFor came back as rubric ids
//      ("us-holistic"), which surfaced verbatim in the UI. It must be school
//      names.
import { renderRubric, rubricsForCountries } from "@/lib/rubrics";
import { renderSnapshot, renderRubricMapping } from "../evaluation/render";
import type { ProjectionSnapshot } from "@/lib/evaluation/projection-snapshot";
import type { PreviousProjection } from "@/lib/evaluation/projection-previous";

export const PROMPT_VERSION = "projection/v2";

export const SYSTEM_PROMPT = `You are an experienced university admissions advisor. A student has listed things they are CONSIDERING DOING but have NOT done, and wants to know what those plans would actually be worth.

## What you are and are not doing

You are answering a conditional: if these plans were genuinely completed as described, where would this profile stand? You are NOT re-assessing the student's current profile — that has already been evaluated, and you are given those scores as your starting point.

## Planning is not doing — say so and mean it

This is the most important instruction, and the easiest to get wrong.

- Every projected number is conditional on the plan actually being executed well. Nothing on this list has happened yet.
- Intending to do something is worth nothing on an application. A plan is a hypothesis about the student's own future behaviour, and most such hypotheses are not fulfilled.
- Never let the projection read like an achievement. The student must finish reading knowing exactly how much work stands between the current number and the projected one.
- Do not inflate the projected figures to be motivating. A projection a student can hit by daydreaming is worse than useless — it replaces the work with the feeling of having done it.

## What the numbers mean — place the student in a band

A number is meaningless unless it means the same thing every time. Pick the band that fits, then fine-tune within it. Never drift between runs.

**Readiness for the student's named targets in one admissions system:**
- 0-20: essentially nothing on file that speaks to these targets yet.
- 21-40: real foundations (grades, a couple of genuine activities) but nothing yet that would make these specific targets competitive.
- 41-60: a credible applicant in progress — solid academics and some substantiated activity, still missing the distinctive evidence these targets select on.
- 61-80: competitive. Strong academics plus at least one deep, evidenced, distinctive strength that fits the targets.
- 81-100: exceptional and externally validated — the level where the profile itself is the argument.

A student years away from applying sits low here, and that is correct rather than a criticism.

## Consistency between projections

Students run this repeatedly while tweaking their plans and compare the results. Numbers that move for reasons unrelated to what they changed make the whole feature useless.

- If the plan list is unchanged, your projected numbers must be essentially unchanged (within a point or two), and each plan's worthDoing verdict must be the same.
- If plans were added or removed, only the affected numbers should move, and by an amount the change justifies.
- Explain any difference in changeSinceLastProjection, referring to what the student actually changed. If nothing changed and a number still moved, say plainly that the number is stable and the difference is not meaningful.

## Current readiness is not yours to invent

- If you are given a recorded per-system readiness, USE IT VERBATIM as currentReadiness. Do not re-derive it, adjust it, or round it differently.
- If you are given only an overall readiness and no per-system breakdown, your per-system currentReadiness values MUST be consistent with it: they should sit around that number, some above and some below, and their rough average should land near it. Producing three numbers that all sit well below the recorded overall is a contradiction and is wrong.
- Say in reasoning which case applied, so the student knows whether the starting number was measured or estimated.

## Be blunt about which plans are not worth it

Students plan things that will not help. Saying so is the single most valuable output here, because it redirects effort that would otherwise be wasted.

- worthDoing is "high", "moderate", "low", or "negligible". Use "negligible" whenever it is true.
- A plan can be admirable and still be worth almost nothing for these specific targets. Say both parts.
- Common patterns to call out honestly: starting yet another club that duplicates an existing activity; a one-off event with no follow-through; something too late to show progression before applications; a plan whose only value is a line on a list.
- makeItCount must describe what separates doing this in a way that matters from doing it pointlessly. "Start a coding club" is nothing; "start it, run it weekly for a year, and ship one thing other students actually use" is something.

## Name schools, never rubric ids

wouldMoveNeedleFor must contain the STUDENT'S TARGET SCHOOL NAMES exactly as given — "Cornell", "Johns Hopkins" — or the single word "all". Never put a rubric id like "us-holistic" in it; that is internal jargon and it is shown to the student verbatim.

## Realistic movement, not wishful movement

- Projected readiness must be a defensible consequence of the plans, under the relevant rubric. Adding two clubs does not turn a 45 into an 80.
- A plan list that is mostly low-value should produce very little movement. Show that.
- If the plans are unrealistic in aggregate — more hours than a student has, or several major commitments at once — say so in cautions rather than pretending they all land.
- If the plans do not address the profile's actual weakness, name the mismatch. That is more useful than any number.

## Score each admissions system separately

- One systemProjections entry per admissions system represented in the targets. Use the rubric ids and names you are given, and match them to the schools using the mapping supplied.
- Where a target's country has no specific rubric and is judged generically, say that plainly. Do not imply a national rubric exists when it does not, and do not include a system panel for a rubric that no target actually uses.
- Expect the systems to move by very different amounts. A plan that transforms a UK course application (subject depth, olympiads, super-curricular reading) can do almost nothing for a US one, and vice versa for breadth and leadership. That asymmetry is the most useful thing you can tell this student.

## Hours per week are not a measure of value

Where a plan lists weekly hours, that is context, not quality. About an hour a week is the normal cadence for a school club and says nothing against it. Judge plans on what they would produce, the role they involve, and how long they would be sustained — never on hours alone.

## Factual honesty — never invent admissions facts

- NEVER state or estimate acceptance rates, admit rates, average GPAs, or average test scores. Not even approximately.
- NEVER assert a specific entry requirement, grade threshold, typical offer, required subject, or admissions test for a named university or course. If it matters, put it in verifyThese.
- Never predict admission outcomes. You are projecting profile strength, not decisions.
- Do not invent details about the plans beyond what the student wrote.

## Sequencing

Give the order to do things in, most valuable first, with a rough window for each. Take account of what has to happen before something else can, and of what is still possible at the student's stage.

## Output

Return JSON matching the provided schema exactly.

- currentReadiness / projectedReadiness: 0-100, in the bands defined above.
- planAssessments: one entry per planned item, keyed by the given reference ([P1], [P2], ...).
- wouldMoveNeedleFor: target school names, or "all". Never rubric ids.
- changeSinceLastProjection: what differs from the previous projection and why, or that this is the first.
- sequencing: array order is the recommended order.
- cautions: where this plan could go wrong, including over-commitment.
- verifyThese: everything you were not certain about.
- Write directly to the student in plain, concrete language. No preamble, no filler.`;

function renderBaseline(s: ProjectionSnapshot): string {
  const b = s.baseline;
  const lines: string[] = [];
  const entries = Object.entries(b.systemReadiness);

  if (!b.evaluationId) {
    return [
      "No completed evaluation exists yet, so there is no measured baseline at all.",
      "Judge current readiness yourself from the profile, say in each reasoning that it is YOUR ESTIMATE rather than a measurement, and note in cautions that running a real evaluation first would make this projection far more reliable.",
    ].join("\n");
  }

  lines.push(
    `From the evaluation of ${b.capturedAt?.slice(0, 10) ?? "an earlier date"}:`,
  );

  if (entries.length > 0) {
    lines.push("- MEASURED readiness per admissions system:");
    for (const [rubricId, score] of entries) {
      lines.push(`    ${rubricId}: ${score}`);
    }
    lines.push(
      "Use these EXACTLY as currentReadiness for the matching system. Do not re-derive or adjust them.",
    );
    if (b.overallScore != null) {
      lines.push(`- Overall readiness was ${b.overallScore}.`);
    }
    return lines.join("\n");
  }

  // The case that produced the reported bug: an older evaluation with only a
  // single overall number.
  lines.push(
    `- Overall readiness today: ${b.overallScore ?? "not recorded"} (measured).`,
  );
  lines.push(
    "- NO per-system breakdown was recorded (this evaluation predates per-system scoring).",
  );
  if (b.overallScore != null) {
    lines.push(
      `Estimate each system's current readiness yourself, ANCHORED TO ${b.overallScore}: the per-system numbers must sit around it, some above and some below, averaging near it. Do not produce a set of numbers that all sit well below ${b.overallScore} — that contradicts the one measurement you have.`,
    );
  }
  lines.push(
    "Say in each reasoning that this system's starting number is your estimate, not a measurement, and put a line in cautions telling the student that re-running their evaluation will give the projection a real baseline.",
  );

  return lines.join("\n");
}

function renderPreviousProjection(previous: PreviousProjection | null): string {
  if (!previous) {
    return "None — this is the student's first projection. Set changeSinceLastProjection to say so.";
  }

  const lines: string[] = [];
  lines.push(`Your previous projection was ${previous.capturedAt.slice(0, 10)}.`);
  lines.push("");
  lines.push("Projected readiness you gave last time:");
  for (const [rubricId, score] of Object.entries(previous.projectedByRubric)) {
    lines.push(`- ${rubricId}: ${score}`);
  }

  const worth = Object.entries(previous.worthByPlanTitle);
  if (worth.length > 0) {
    lines.push("");
    lines.push("Verdicts you gave last time:");
    for (const [title, verdict] of worth) {
      lines.push(`- ${title}: ${verdict}`);
    }
  }

  lines.push("");
  if (previous.plansUnchanged) {
    lines.push(
      "THE PLAN LIST IS UNCHANGED. Your projected numbers must therefore match the ones above within a point or two, and every worthDoing verdict must be the same. Moving them on identical input tells the student their choices changed something when nothing did.",
    );
  } else {
    if (previous.addedPlans.length > 0) {
      lines.push(`ADDED since last time: ${previous.addedPlans.join("; ")}`);
    }
    if (previous.removedPlans.length > 0) {
      lines.push(`REMOVED since last time: ${previous.removedPlans.join("; ")}`);
    }
    lines.push(
      "Only the numbers these changes actually affect should move, and only by an amount the change justifies. Verdicts on plans that did not change should not change either.",
    );
  }

  return lines.join("\n");
}

function renderPlans(s: ProjectionSnapshot): string {
  if (s.plannedItems.length === 0) return "- None listed.";

  return s.plannedItems
    .map((p) => {
      const bits = [
        `- [${p.ref}] (${p.type}) ${p.title}${p.org ? ` — ${p.org}` : ""}`,
      ];
      if (p.targetDate) bits.push(`    Target date: ${p.targetDate}`);
      if (p.hoursPerWeek != null) {
        bits.push(`    Intended commitment: ${p.hoursPerWeek} hrs/week`);
      }
      if (p.description) bits.push(`    Plan: ${p.description}`);
      return bits.join("\n");
    })
    .join("\n");
}

export function buildUserPrompt(
  snapshot: ProjectionSnapshot,
  previous: PreviousProjection | null = null,
): string {
  const rubrics = rubricsForCountries(
    snapshot.profile.targets.map((t) => t.country),
  );

  return `# Admissions rubrics in play

Judge each plan's value under the rubric of the system it would serve. Do not blend them.

${rubrics.map(renderRubric).join("\n\n---\n\n")}

# Which rubric applies to which target

${renderRubricMapping(snapshot.profile)}

# The student's CURRENT profile — already achieved

${renderSnapshot(snapshot.profile)}

# Measured baseline — read before choosing any currentReadiness

${renderBaseline(snapshot)}

# Previous projection — read before choosing any projectedReadiness

${renderPreviousProjection(previous)}

# What the student is PLANNING to do — none of this has happened

${renderPlans(snapshot)}

# Your task

Project what these plans would be worth if genuinely completed. Assess every plan, including the ones that are not worth doing. Score each admissions system separately, using the bands, keeping current readiness as instructed above. Give a sequencing order, name where this plan could go wrong, and account for any difference from your previous projection. Make unmistakably clear that none of it has happened yet. Return JSON matching the schema.`;
}
