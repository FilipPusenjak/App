// The parent-facing progress artifact.
//
// The ONE model-generated surface in the test-prep edition, and the one with the
// most hostile incentive structure in the whole product: the tutor is sending it
// to the person who pays them, monthly, and the easiest way to keep that money
// flowing is to make it read like a case for more sessions.
//
// So the prompt's real job is not asking for a report. It is refusing three
// things the model will otherwise supply unprompted, because they are what
// "write an encouraging progress update" means in almost every text it has ever
// seen:
//
//   A PREDICTED SCORE. "On track for 1510 by March" is the single most natural
//   sentence to write about a student whose scores went up. It is also a promise
//   the tutor has to answer for in March, made by a system that has no idea. The
//   ban is enforced twice — instructed here, and checked by
//   findBannedPredictionPhrasing before the artifact can be stored.
//
//   A REASON TO CONTINUE. When the stopping engine has fired, the honest
//   artifact tells a paying parent to stop paying. The model is told to report
//   that verbatim and not to argue with it.
//
//   A COMPUTED NUMBER. Every figure the artifact needs arrives already decided
//   by lib/testprep. A model asked to recall a school's 75th percentile will
//   produce one with total confidence and no source.
import type { StoppingKind } from "@/lib/validation/testprep";

export const PROGRESS_PROMPT_VERSION = "testprep-progress/v1";

export const PROGRESS_SYSTEM_PROMPT = `You write a monthly progress update that a test-prep tutor sends to a student's parent or guardian.

WHO READS THIS. A parent who is paying for tutoring by the hour and who is not an admissions expert. They will read any number you write as a promise, and any upward line as evidence their money is working. Write accordingly: plainly, factually, and without a single word of persuasion.

WHAT YOU ARE GIVEN. Everything numeric in this brief has already been computed — scores that were actually sat, a target band derived from published admissions data, which school sets that band, where the sections stand, and whether a stopping signal has fired. Report these. Do not recompute them, do not adjust them, and do not add numbers of your own.

THE RULES, IN ORDER OF HOW BADLY BREAKING THEM WOULD HURT THIS FAMILY.

1. NEVER PREDICT A FUTURE SCORE. Not a number, not a range, not a date, not a rate of improvement. Do not write "on track", "projected", "trajectory", "should reach", "expect to hit", "by March", "at this pace", or any construction that implies where this student will end up or when. Practice-test-to-real-test variance is large. A predicted score becomes a promise the tutor has to answer for, and you have no basis for making it. Report what was scored and what the current gap is. Nothing else.

2. NEVER STATE OR IMPLY ADMISSION LIKELIHOOD. A score is one threshold among many. Clearing it is not an admission signal and you must never present it as one. No odds, no chances, no "well positioned", no "competitive for".

3. WHEN A STOPPING SIGNAL HAS FIRED, SAY SO PLAINLY AND FIRST. You will be told if one has. It means additional points would not change any admission outcome on this student's list. Put it in stoppingNotice in plain language a parent understands, including WHY — which school set the bar, and what the student's score is against it. Do not soften it, do not bury it after good news, do not pair it with a reason to continue anyway, and do not suggest the student "keep sharpening" or "maintain momentum". If the honest conclusion is that the tutoring has done its job, that is what you write.

4. THIS IS NOT MARKETING. The tutor did not commission an advertisement. Do not praise the tutor, do not characterise the sessions as valuable, do not describe effort as impressive, and do not end on an encouraging note that the data does not support. A flat, accurate report is what earns a family's trust.

5. SAY WHAT THIS DOES NOT TELL THEM. Every time, without exception, in whatThisDoesNotTellYou. At minimum: practice tests are noisy and a single practice result is not a reliable reading; a test score is one threshold among several and clearing it does not decide an admission; and this update covers test preparation only and says nothing about the rest of the application.

TONE. Write for an intelligent adult who is not an expert. Short sentences. No jargon, no percentile talk they have not been given, no exclamation marks. If a month was flat, say it was flat — a parent who is told the truth about a flat month will believe you about a good one.

OUTPUT. Return JSON matching the schema. headline is one factual sentence about what happened this period. summary is a short plain-language account of the attempts and where the student stands against the band. focusThisPeriod names ONE section or skill area, taken from the section allocation you were given. stoppingNotice is the plain-language stopping message when a signal fired, and null when none has. whatThisDoesNotTellYou is required and never null.`;

export type ProgressContext = {
  studentName: string;
  testCode: string;
  periodStart: Date;
  periodEnd: Date;
  attempts: {
    kind: string;
    takenAt: Date;
    composite: number | null;
    isVerified: boolean;
  }[];
  startingComposite: number | null;
  currentComposite: number | null;
  bestSectionScores: Record<string, number>;
  target: {
    bindingComposite: number | null;
    bandLow: number | null;
    bandHigh: number | null;
    setBy: string | null;
    status: "GAP_REMAINS" | "IN_BAND" | "CLEARED";
  };
  focusSection: string | null;
  focusDescription: string;
  firedSignals: { kind: StoppingKind; summary: string }[];
  handoff: string | null;
  previousHeadline: string | null;
};

const date = (d: Date) =>
  d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

/**
 * The brief the model is given.
 *
 * Target ≤5k tokens and nowhere near it in practice — a month of attempts is a
 * handful of rows. Kept small deliberately: everything here is a fact the model
 * must repeat rather than reason about, and a longer brief is more surface for
 * it to start reasoning across.
 */
export function buildProgressUserPrompt(ctx: ProgressContext): string {
  const lines: string[] = [];

  lines.push(`# Student and period`);
  lines.push(`- Student: ${ctx.studentName}`);
  lines.push(`- Test: ${ctx.testCode}`);
  lines.push(`- Period: ${date(ctx.periodStart)} to ${date(ctx.periodEnd)}`);

  lines.push("");
  lines.push("# Attempts in this period");
  if (ctx.attempts.length === 0) {
    lines.push(
      "- None. The student sat nothing this period. Say so plainly; do not fill the gap with encouragement.",
    );
  } else {
    for (const a of ctx.attempts) {
      lines.push(
        `- ${date(a.takenAt)}: ${a.kind}${a.composite !== null ? `, composite ${a.composite}` : ", no composite"}${
          a.isVerified ? "" : " (SELF-REPORTED, not verified against a score report)"
        }`,
      );
    }
  }

  lines.push("");
  lines.push("# Where the student stands (all computed — report, do not recalculate)");
  lines.push(
    `- Starting composite for this engagement: ${ctx.startingComposite ?? "not recorded"}`,
  );
  lines.push(`- Current best composite: ${ctx.currentComposite ?? "not recorded"}`);
  const sections = Object.entries(ctx.bestSectionScores);
  if (sections.length > 0) {
    lines.push(
      `- Best score in each section: ${sections.map(([k, v]) => `${k} ${v}`).join(", ")}`,
    );
  }

  lines.push("");
  lines.push("# The target");
  if (ctx.target.bindingComposite === null) {
    lines.push(
      "- No school on this student's list sets a score bar we hold data for. Say that plainly rather than implying a target exists.",
    );
  } else {
    lines.push(
      `- Band: ${ctx.target.bandLow} to ${ctx.target.bandHigh}, set by ${ctx.target.setBy}`,
    );
    lines.push(`- The bar to clear: ${ctx.target.bindingComposite}`);
    lines.push(`- Status: ${ctx.target.status}`);
    lines.push(
      `- The band is the middle 50% of admitted students at ${ctx.target.setBy}, not a cutoff. Do not describe it as a cutoff or a requirement.`,
    );
  }

  lines.push("");
  lines.push("# Where the room is");
  lines.push(`- ${ctx.focusDescription}`);
  if (ctx.focusSection) {
    lines.push(
      `- Use "${ctx.focusSection}" as focusThisPeriod. This is where the composite moves, based on remaining room. It is NOT a claim about how fast this student learns — do not present it as one, and do not attach a timeline to it.`,
    );
  }

  /* ── The part that decides whether this artifact is honest ─────────────── */
  lines.push("");
  if (ctx.firedSignals.length > 0) {
    lines.push("# A STOPPING SIGNAL HAS FIRED — this is the most important part");
    lines.push(
      "Additional points would not change any admission outcome on this student's list. You MUST put this in stoppingNotice, in plain language, including which school set the bar and where the student sits against it.",
    );
    lines.push(
      "Do not soften it. Do not bury it after good news. Do not pair it with a reason to keep going. A parent paying by the hour is entitled to know the work is done.",
    );
    for (const s of ctx.firedSignals) {
      lines.push(`- [${s.kind}] ${s.summary}`);
    }
    if (ctx.handoff) {
      lines.push("");
      lines.push(
        "Context for what comes next, if it helps you write the notice — state it as information, never as a pitch for another service:",
      );
      lines.push(ctx.handoff);
    }
  } else {
    lines.push("# Stopping");
    lines.push(
      "- No stopping signal has fired. Set stoppingNotice to null. Do not invent one, and do not write a reassurance that there is still work to do.",
    );
  }

  if (ctx.previousHeadline) {
    lines.push("");
    lines.push("# Last month's headline, for continuity");
    lines.push(`- ${ctx.previousHeadline}`);
    lines.push(
      "- Do not repeat it. If nothing has changed since, say that nothing has changed.",
    );
  }

  lines.push("");
  lines.push("# Your task");
  lines.push(
    "Write the update. Report what happened, state where the student stands against the band, name one focus, carry the stopping notice verbatim in substance if one fired, and state the limits of what this tells them. No predicted scores, no dates, no admission likelihood, no persuasion. Return JSON matching the schema.",
  );

  return lines.join("\n");
}
