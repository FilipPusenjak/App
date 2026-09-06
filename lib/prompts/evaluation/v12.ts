// Evaluation prompt v12 — v11, plus a length for the sections that multiply.
//
// WHAT CHANGED AND WHY. Nearly half of what a Deep Review costs is the visible
// prose the model writes, and almost all of that prose lives in two families of
// section that appear once per target and once per item: school fits and item
// assessments. Measured on the deployment, visible output ran 4,700–7,200
// tokens per review — four to five thousand words, to a fifteen-year-old, at
// $25 per million output tokens. A ten-target, eight-item profile produced
// eighteen three-paragraph sections.
//
// v12 asks for about four sentences in each of those, and up to three key
// risks per school fit. Nothing else changes: the summary, strengths,
// weaknesses, actions and gaps appear once per review and keep whatever length
// they need. The shape of the output is identical; each repeated section is
// tighter. The numbers come from lib/validation/evaluation-limits.ts, the same
// module the validator reads, so the prompt cannot ask for one length while the
// validator enforces another.
//
// NO SCORE CHANGES MEANING. This is a length instruction on prose, so
// versions.ts registers it with nothing redefined and no boundary is drawn on
// a student's chart.
//
// The validator's ceiling sits at twice the target — see evaluation-limits.ts
// for why a review that runs a little long is a review and not a failure.
import {
  SYSTEM_PROMPT as V11_SYSTEM_PROMPT,
  buildUserPromptParts,
  budgetNote,
  type EvaluationExtras,
  type OpenCommitmentLine,
  type ReportedDevelopment,
} from "./v11";
import {
  KEY_RISKS_TARGET,
  SECTION_TARGET_CHARS,
  SECTION_TARGET_SENTENCES,
} from "@/lib/validation/evaluation-limits";

export { buildUserPrompt } from "./v10";
export { buildUserPromptParts, budgetNote };
export type { EvaluationExtras, OpenCommitmentLine, ReportedDevelopment };

export const PROMPT_VERSION = "evaluation/v12";

/**
 * Appended to the v11 system prompt. Written as a section of its own rather
 * than threaded into the per-school and per-item sections above it, so the
 * rule is stated once, with its reason, where the model reads instructions
 * about the shape of its answer.
 */
const LENGTH_SECTION = `

## Length of the sections that repeat

Two kinds of section in your answer appear ONCE PER TARGET or ONCE PER ITEM:
every entry in schoolFits, and every entry in itemAssessments. They multiply.
A student with ten targets and eight activities is reading eighteen of them,
and each one has to earn its length against the seventeen others.

For those, and only those:

- assessment, classificationReason, compoundsInto, verdict and howToStrengthen:
  about ${SECTION_TARGET_CHARS} characters each — roughly ${SECTION_TARGET_SENTENCES} sentences. Say the specific
  thing and why; do not restate the profile, and do not pad toward a paragraph.
  A section that has said what it needs to in two sentences is finished.
- keyRisks: at most ${KEY_RISKS_TARGET}, each a short phrase. Where there is no significant risk,
  say so in one line rather than inventing three.

Everything that appears once per review — the summary, strengths, weaknesses,
actions, gaps, the stage outlook — is unchanged and takes the length it needs.
That is where the argument lives; the repeated sections are the evidence for it.

A response whose repeated sections run to several times the length asked for
will be rejected and you will be asked to write it again shorter. Write it
shorter the first time.`;

export const SYSTEM_PROMPT = V11_SYSTEM_PROMPT + LENGTH_SECTION;
