// The test-prep edition's vocabulary, and the shape of what a model may return.
//
// Same convention as the rest of the app: Postgres stores strings, Zod is the
// enum, and nothing is written or read without passing through here.
//
// Two rules in this file are not stylistic and are asserted in tests:
//
//   NOTHING PREDICTS A SCORE. The student app bans admission probabilities and
//   the counselor edition bans odds; here the tempting thing to invent is a
//   FUTURE SCORE, and it is worse than either. Practice-to-real variance is
//   large, a parent reads "on track for 1510 by March" as a commitment, and the
//   tutor is the one who has to answer for it in March. findBannedPredictionPhrasing
//   below is the last gate before a narrative reaches a family.
//
//   A THRESHOLD CAPS AT MET. Inherited verbatim from lib/readiness/threshold.ts
//   rather than restated, because the stopping engine is nothing more than that
//   principle applied to one number. If the two ever disagreed, the product's
//   central claim — we will tell you when to stop — would be a UI string with
//   no computation behind it.
import { z } from "zod";
import { THRESHOLD_STATES } from "@/lib/readiness/threshold";

/* ── Accounts and access ─────────────────────────────────────────────────── */

/**
 * The scope a test-prep tutor gets, and the narrowest in the product.
 *
 * Score history, the target school list, and the thresholds derived from those
 * two. Nothing else — no activities, no essays, no differentiation data, no
 * counselor notes. A test-prep tutor was engaged for one number and everything
 * else about this student is somebody else's business.
 */
export const TEST_PREP_SCOPE = "TEST_PREP_ONLY";

/** What a test type's sections look like, and how they combine. */
export const COMPOSITE_RULES = [
  /** SAT: sections add up. */
  "SUM",
  /** ACT: sections average, rounded. */
  "AVERAGE",
  /** A single reported figure taken from the best section. */
  "HIGHEST_SECTION",
  /**
   * No numeric composite at all. Real, not a placeholder: the LNAT's essay is
   * not scored numerically, so a composite would be a number nobody reports and
   * no admissions office reads.
   */
  "NONE",
] as const;
export const compositeRuleSchema = z.enum(COMPOSITE_RULES);
export type CompositeRule = (typeof COMPOSITE_RULES)[number];

/** One section of a test, and the range it can take. */
export const testSectionSchema = z.object({
  name: z.string().trim().min(1).max(60),
  min: z.number().int(),
  max: z.number().int(),
  /**
   * The smallest meaningful step. The SAT moves in 10s, the ACT in 1s, and a
   * gap analysis that ignored this would report "you need 3 more points" on a
   * test where 3 more points is not a reachable value.
   */
  step: z.number().int().positive().default(1),
});
export type TestSection = z.infer<typeof testSectionSchema>;

export const testSectionSchemaSchema = z.object({
  sections: z.array(testSectionSchema).min(1).max(12),
  /** The composite's own range, where one exists. */
  compositeMin: z.number().int().nullable(),
  compositeMax: z.number().int().nullable(),
});
export type TestSectionSchema = z.infer<typeof testSectionSchemaSchema>;

/* ── Attempts ────────────────────────────────────────────────────────────── */

export const ATTEMPT_KINDS = [
  /** The first sitting, which anchors where a progress artifact reports from. */
  "DIAGNOSTIC",
  /** Noisy by nature. Every artifact showing one is required to say so. */
  "PRACTICE",
  /** The only kind that can actually clear a threshold. */
  "OFFICIAL",
] as const;
export const attemptKindSchema = z.enum(ATTEMPT_KINDS);
export type AttemptKind = (typeof ATTEMPT_KINDS)[number];

export const ENTERED_BY = ["STUDENT", "TUTOR"] as const;
export const enteredBySchema = z.enum(ENTERED_BY);
export type EnteredBy = (typeof ENTERED_BY)[number];

/* ── School policy ───────────────────────────────────────────────────────── */

export const TEST_POLICIES = [
  /** A score is required, so it binds outright. */
  "REQUIRED",
  /** Contributes only where submitting would strengthen the application. */
  "OPTIONAL",
  /** Cannot contribute a threshold at all, and is excluded from the maths. */
  "BLIND",
] as const;
export const testPolicySchema = z.enum(TEST_POLICIES);
export type TestPolicy = (typeof TEST_POLICIES)[number];

/** What each policy means, in the words a student reads. */
export const POLICY_MEANINGS: Record<TestPolicy, string> = {
  REQUIRED: "requires a score",
  OPTIONAL: "will look at a score if you send one",
  BLIND: "will not look at a score at all",
};

/* ── Stopping ────────────────────────────────────────────────────────────── */

export const STOPPING_KINDS = [
  /** The superscore clears the band for every non-blind school on the list. */
  "ALL_TARGETS_MET",
  /** A standard retake increment would move no school from unmet to met. */
  "MARGINAL_VALUE_ZERO",
  /** Every section is maxed against superscoring targets; sitting again cannot help. */
  "SUPERSCORE_COMPLETE",
  /** A gap remains, but in a section with almost no headroom left. */
  "DIMINISHING_RETURNS",
  /** The gap analysis does not support another sitting. */
  "RETAKE_NOT_INDICATED",
] as const;
export const stoppingKindSchema = z.enum(STOPPING_KINDS);
export type StoppingKind = (typeof STOPPING_KINDS)[number];

/** The headline a tutor sees. Plain, and never softened. */
export const STOPPING_LABELS: Record<StoppingKind, string> = {
  ALL_TARGETS_MET: "Every school on the list is cleared",
  MARGINAL_VALUE_ZERO: "More points would not change any outcome",
  SUPERSCORE_COMPLETE: "The superscore cannot improve further",
  DIMINISHING_RETURNS: "What is left is in a section with little room",
  RETAKE_NOT_INDICATED: "Another sitting is not indicated",
};

/**
 * The two that mean the ENGAGEMENT is done, not merely that a retake is unwise.
 *
 * These are the ones that emit a handoff: the student's binding constraint has
 * stopped being their score, and what remains is differentiation — which is a
 * different professional's job. Surfaced as information, never as an upsell.
 */
export const ENGAGEMENT_COMPLETE_KINDS: readonly StoppingKind[] = [
  "ALL_TARGETS_MET",
  "MARGINAL_VALUE_ZERO",
];

/* ── Target status ───────────────────────────────────────────────────────── */

export const TARGET_STATUSES = ["GAP_REMAINS", "IN_BAND", "CLEARED"] as const;
export const targetStatusSchema = z.enum(TARGET_STATUSES);
export type TargetStatus = (typeof TARGET_STATUSES)[number];

/**
 * Re-exported so a caller reading a test score's threshold state imports it
 * from the SHARED core rather than from a copy that could drift. The tutor's
 * screen and the student's own must not be able to disagree.
 */
export { THRESHOLD_STATES };

/* ── The one generated surface ───────────────────────────────────────────── */

/**
 * The parent-facing artifact.
 *
 * Note what the model is NOT asked for: no composite it computed, no band, no
 * status. Those arrive already decided by lib/testprep and are passed through —
 * a model asked to recall a percentile will produce one, confidently, and it
 * will be wrong often enough to matter to a family making a decision.
 */
export const progressNarrativeSchema = z.object({
  /** What happened this period, factually. Not a sales line. */
  headline: z.string().trim().min(1).max(240),
  /** Plain-language reading of the period's attempts. */
  summary: z.string().trim().min(1).max(1200),
  /** One section or skill area. Singular on purpose — a list is not a focus. */
  focusThisPeriod: z.string().trim().min(1).max(400),
  /**
   * Present VERBATIM when a stopping signal has fired.
   *
   * Nullable in the schema and NOT nullable in practice: the route rejects a
   * narrative whose stoppingNotice is null when a signal is live. It is typed
   * nullable only because there is a legitimate case — no signal has fired — and
   * a required field would push the model to invent one.
   */
  stoppingNotice: z.string().trim().max(800).nullable(),
  /**
   * Required, every time, no exceptions.
   *
   * Practice tests are noisy, a score is one threshold among several, and
   * clearing it is not an admission signal. A parent reading a rising number
   * without this reads it as an admission forecast, which is exactly the
   * misunderstanding this product exists to refuse.
   */
  whatThisDoesNotTellYou: z.string().trim().min(1).max(800),
});
export type ProgressNarrative = z.infer<typeof progressNarrativeSchema>;

/**
 * Whether this artifact may be stored, given what the engine decided.
 *
 * PURE, and separate from the route, because it is the single most important
 * rule in the product and a rule that lives inside a request handler is a rule
 * nobody can test without an API key. The route calls this; so do the tests.
 *
 * The rule: when a stopping signal has fired, an artifact whose stoppingNotice
 * is empty is REFUSED. Not patched, not defaulted, not warned about — refused,
 * with the tokens written off. A parent-facing document that silently omits the
 * reason to stop is worse than no document, because it is a document the family
 * will reasonably read as "keep going".
 */
export function artifactOmitsRequiredStoppingNotice(input: {
  firedKinds: readonly StoppingKind[];
  narrative: { stoppingNotice?: string | null };
}): boolean {
  if (input.firedKinds.length === 0) return false;
  return !input.narrative.stoppingNotice?.trim();
}

/* ── The phrasing gate ───────────────────────────────────────────────────── */

/**
 * Future-score prediction, in the forms a model actually writes it.
 *
 * Wider than it looks necessary, because the failure is not a model stating
 * "1510 in March" outright — it is the softer framings that carry the same
 * promise while sounding like reporting. "On track" is the worst of them: it
 * implies both a destination and a timeline, neither of which the data
 * supports, and it is the single most natural thing to write about a student
 * whose scores went up.
 */
const BANNED_PATTERNS: { pattern: RegExp; why: string }[] = [
  { pattern: /\bon track\b/i, why: "an implied destination and timeline" },
  { pattern: /\b(?:projected|projection|trajectory|trending toward|trending towards)\b/i, why: "a projected trajectory" },
  { pattern: /\bshould (?:reach|hit|score|achieve|get)\b/i, why: "a predicted score" },
  { pattern: /\b(?:will|expect(?:s|ed)? to|anticipate[sd]?|likely to) (?:reach|hit|score|achieve|improve to|get to)\b/i, why: "a predicted score" },
  { pattern: /\bby (?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i, why: "a date attached to a score" },
  { pattern: /\bby (?:the )?(?:spring|summer|fall|autumn|winter|next sitting|test day|exam day)\b/i, why: "a date attached to a score" },
  { pattern: /\b(?:forecast|predict(?:s|ed|ion)?)\b/i, why: "an explicit prediction" },
  { pattern: /\bpace to (?:reach|hit|score)\b/i, why: "a predicted score" },
  { pattern: /\bpoints? (?:per|a) (?:week|month|session)\b/i, why: "an implied future rate of gain" },
  /**
   * Admission likelihood, banned here for the same reason the student app bans
   * it. A test-prep tutor is even less placed to state it than a counselor.
   */
  { pattern: /\b(?:chances?|likelihood|odds|probability) of (?:admission|acceptance|getting in|being accepted)\b/i, why: "odds of admission" },
  { pattern: /\b(?:guarantee[sd]?|guaranteed)\b/i, why: "a guarantee" },
];

/**
 * Every banned phrasing found anywhere in a generated narrative.
 *
 * Walks the whole object rather than named fields, so a field added to the
 * schema is covered the day it is added rather than the day someone remembers
 * to add it here.
 */
export function findBannedPredictionPhrasing(value: unknown): string[] {
  const found = new Set<string>();

  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      for (const { pattern, why } of BANNED_PATTERNS) {
        if (pattern.test(node)) found.add(why);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      Object.values(node as Record<string, unknown>).forEach(walk);
    }
  };

  walk(value);
  return [...found];
}
