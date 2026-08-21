// The counselor edition's vocabulary, and the shape of what a model may return.
//
// Same convention as the rest of the app: Postgres stores strings, Zod is the
// enum, and nothing is written or read without passing through here.
//
// Two rules in this file are not stylistic and are asserted in tests:
//
//   EVERY MODEL CLAIM CARRIES A BASIS. A counselor has to vet output before
//   repeating it to a paying parent, so a discussion point without a traceable
//   computed fact behind it is not usable material — it is a claim they would
//   have to take on faith from a system that knows less about admissions than
//   they do.
//
//   NO PROBABILITIES, EVER. The student app bans them; here it is worse. A
//   counselor repeating a model-generated percentage to a family is a
//   professional liability, and the phrasing check below is the last gate.
import { z } from "zod";

/* ── Accounts and access ─────────────────────────────────────────────────── */

export const COUNSELOR_TYPES = [
  "INDEPENDENT",
  /**
   * A school-employed counselor, inside FERPA's education-records regime.
   * Carried from the start although only INDEPENDENT ships — see the schema.
   */
  "SCHOOL_BASED",
  "TUTORING_CENTER",
] as const;
export const counselorTypeSchema = z.enum(COUNSELOR_TYPES);
export type CounselorType = (typeof COUNSELOR_TYPES)[number];

export const LINK_STATUSES = ["PENDING", "ACTIVE", "PAUSED", "ENDED"] as const;
export const linkStatusSchema = z.enum(LINK_STATUSES);
export type LinkStatus = (typeof LINK_STATUSES)[number];

export const INVITED_BY = ["COUNSELOR", "STUDENT", "GUARDIAN"] as const;
export const invitedBySchema = z.enum(INVITED_BY);

export const LINK_SCOPES = [
  "FULL",
  "ACADEMIC_ONLY",
  "ACTIVITIES_ONLY",
  /**
   * The test-prep edition's scope, and the narrowest in the product.
   *
   * Deliberately NOT handled by scopedProfileInclude or
   * scopedProfileSelectFields below — both compute their permissions from
   * `academics` and `activities` flags that TEST_PREP_ONLY sets neither of, so
   * both FAIL CLOSED for it and return nothing. That is the correct default and
   * not an oversight: a test-prep tutor reads through lib/testprep/access.ts,
   * which has its own explicit allow-list, and anything routed through the
   * counselor helpers by accident should come back empty rather than guess.
   */
  "TEST_PREP_ONLY",
] as const;
export const linkScopeSchema = z.enum(LINK_SCOPES);
export type LinkScope = (typeof LINK_SCOPES)[number];

/** What each scope may see, in the student's terms. Rendered to them. */
export const SCOPE_MEANINGS: Record<LinkScope, string> = {
  FULL: "Your grades, courses, test scores, activities and targets",
  ACADEMIC_ONLY: "Your grades, courses and test scores — not your activities",
  ACTIVITIES_ONLY: "Your activities and targets — not your grades or test scores",
  TEST_PREP_ONLY:
    "Your test scores and target schools only — not your grades, activities, essays or anything else",
};

/* ── Triage ──────────────────────────────────────────────────────────────── */

export const TRIAGE_KINDS = [
  "STALE_PROFILE",
  "THRESHOLD_NEWLY_BINDING",
  "COMMITMENT_OVERDUE",
  "TRAJECTORY_DROP",
  "DEADLINE_APPROACHING",
  "GOAL_TRAJECTORY_MISMATCH",
  "RUNG_STALLED",
  "NO_RECENT_SESSION",
] as const;
export const triageKindSchema = z.enum(TRIAGE_KINDS);
export type TriageKind = (typeof TRIAGE_KINDS)[number];

/**
 * What each signal means, written for a professional in a hurry.
 *
 * Plain language and no jargon, because this is the text that decides whether a
 * counselor opens a student on a Saturday morning. Every one of these is an
 * OBSERVATION — none tells the counselor what to do about it.
 */
export const TRIAGE_LABELS: Record<TriageKind, string> = {
  STALE_PROFILE: "Nothing updated in a while",
  THRESHOLD_NEWLY_BINDING: "A requirement just became a problem",
  COMMITMENT_OVERDUE: "Agreed to something, past its date",
  TRAJECTORY_DROP: "Depth has gone backwards",
  DEADLINE_APPROACHING: "Deadline near, prerequisites unmet",
  GOAL_TRAJECTORY_MISMATCH: "Activities don't point at the stated goal",
  RUNG_STALLED: "Same level in an activity for a long time",
  NO_RECENT_SESSION: "You haven't met in a while",
};

export const SEVERITY_MIN = 1;
export const SEVERITY_MAX = 5;

/* ── Session prep ────────────────────────────────────────────────────────── */

export const PREP_OUTCOMES = [
  "PENDING",
  "HELD",
  "SKIPPED",
  "RESCHEDULED",
] as const;
export const prepOutcomeSchema = z.enum(PREP_OUTCOMES);

export const URGENCIES = ["NOW", "THIS_TERM", "MONITOR"] as const;
export const urgencySchema = z.enum(URGENCIES);

/** Reused verbatim from the student app's pace module — same three words. */
export const PREP_FEASIBILITY = ["FEASIBLE", "TIGHT", "TOO_LATE"] as const;

/**
 * The basis string on a claim.
 *
 * Deliberately `min(3)` and nothing cleverer: the VALUE of a basis is that a
 * counselor can trace it, and a regex demanding a dotted path would reject a
 * perfectly traceable reason for failing to look like an identifier. What
 * matters is that it is present, which the schema enforces, and that it names
 * something computed, which the prompt asks for and a human can check.
 */
const basisSchema = z.string().trim().min(3).max(200);

export const sessionPrepNarrativeSchema = z.object({
  /** Why this student surfaced, one sentence. */
  headline: z.string().trim().min(1).max(300),
  /** What changed, factually. Not an interpretation. */
  sinceLastSession: z.string().trim().min(1).max(1200),
  discussionPoints: z
    .array(
      z.object({
        point: z.string().trim().min(1).max(600),
        basis: basisSchema,
        urgency: urgencySchema,
      }),
    )
    .max(6),
  /**
   * Things only the counselor can find out.
   *
   * The most valuable field here, and the one that makes this assistance rather
   * than replacement: the counselor can ask whether the student actually enjoys
   * the placement, whether the parents agree about the UK plan, whether a grade
   * drop was a bad semester or a bad situation. A profile cannot contain any of
   * that, and the model should be reaching for exactly what it cannot see.
   */
  questionsToAsk: z.array(z.string().trim().min(1).max(400)).max(8),
  optionsToConsider: z
    .array(
      z.object({
        option: z.string().trim().min(1).max(600),
        /** What it COSTS. An option without a tradeoff is a recommendation. */
        tradeoff: z.string().trim().min(1).max(600),
        feasibility: z.enum(PREP_FEASIBILITY),
        basis: basisSchema,
      }),
    )
    .max(6),
  /**
   * Buried or slow-moving signals a session-to-session view would miss.
   *
   * Null is a legitimate answer and is preferable to a manufactured one — a
   * field that always finds something teaches a counselor to stop reading it.
   */
  whatIMayHaveMissed: z.string().trim().min(1).max(1200).nullable(),
});
export type SessionPrepNarrative = z.infer<typeof sessionPrepNarrativeSchema>;

/* ── Recommendations ─────────────────────────────────────────────────────── */

export const RECOMMENDATION_SOURCES = [
  "MODEL_SUGGESTED",
  "COUNSELOR_AUTHORED",
] as const;
export const recommendationSourceSchema = z.enum(RECOMMENDATION_SOURCES);

export const RECOMMENDATION_STATUSES = [
  "PROPOSED",
  "DELIVERED",
  "DECLINED_BY_COUNSELOR",
  "ACCEPTED_BY_STUDENT",
] as const;
export const recommendationStatusSchema = z.enum(RECOMMENDATION_STATUSES);
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

/**
 * Which transitions a counselor may make.
 *
 * ACCEPTED_BY_STUDENT is absent from every list as a target, and that is the
 * whole point: only the student's own acceptance produces it. A counselor who
 * could mark their own advice as accepted would be recording an outcome that
 * never happened, in the one table meant to record what actually did.
 */
export const RECOMMENDATION_TRANSITIONS: Record<string, RecommendationStatus[]> = {
  PROPOSED: ["DELIVERED", "DECLINED_BY_COUNSELOR"],
  DELIVERED: ["DECLINED_BY_COUNSELOR"],
  DECLINED_BY_COUNSELOR: [],
  ACCEPTED_BY_STUDENT: [],
};

/* ── The phrasing nothing here may produce ───────────────────────────────── */

/**
 * Admission-probability phrasing, in every form it turns up in.
 *
 * A superset of the student app's list rather than a copy of it, because the
 * failure here is worse: a student reading "roughly 12%" carries a wrong number
 * around, while a counselor repeating it to a fee-paying parent has staked their
 * professional credibility on it.
 */
/**
 * The probability words, PLURALS INCLUDED.
 *
 * Written once because getting it wrong once is enough: "chance of admission"
 * was caught and "chances of admission" was not, which is the form a model
 * actually writes.
 */
const ODDS_WORD = "(?:chances?|likelihoods?|probabilit(?:y|ies)|odds|shots?)";

/** Small numbers as words as well as digits — "one in three" is a ratio too. */
const SMALL_NUMBER =
  "(?:one|two|three|four|five|six|seven|eight|nine|ten|\\d{1,3})";

const BANNED_PATTERNS: { pattern: RegExp; why: string }[] = [
  { pattern: new RegExp(`\\b\\d{1,3}\\s*(?:%|percent)\\s*${ODDS_WORD}`, "i"), why: "a stated percentage chance" },
  // The same claim with the number AFTER the word — "chances of admission
  // improve to about 60 percent" — which the pattern above cannot see.
  { pattern: new RegExp(`${ODDS_WORD}[^.!?]{0,60}?\\b\\d{1,3}\\s*(?:%|percent)\\b`, "i"), why: "a stated percentage chance" },
  { pattern: new RegExp(`\\b${ODDS_WORD}\\s+(?:of|at)\\s+(?:admission|acceptance|getting in|being accepted|an offer)`, "i"), why: "odds of admission" },
  { pattern: /\b(?:will|won'?t|will not)\s+(?:get|be)\s+(?:in|admitted|accepted)\b/i, why: "a prediction of the decision" },
  { pattern: /\b(?:guaranteed|certain|sure)\s+(?:admission|acceptance|to get in)/i, why: "a guarantee of admission" },
  // A hedged prediction is still a prediction, and is the form a model reaches
  // for once the blunt ones are refused. Requires the probability adverb, so
  // "she will get an offer decision in December" — a fact about a calendar —
  // is left alone.
  { pattern: /\b(?:will|would|is|are|'ll|they'?ll|he'?ll|she'?ll)\s+(?:very\s+|almost\s+)?(?:probably|likely|certainly|surely|undoubtedly)\s+(?:get|receive|be given|land|secure|win)\b/i, why: "a hedged prediction of the decision" },
  { pattern: new RegExp(`\\b${SMALL_NUMBER}\\s*(?:in|out of)\\s*${SMALL_NUMBER}\\s+(?:chance|shot)`, "i"), why: "odds expressed as a ratio" },
  // A base rate stated as a ratio — "roughly one in three applicants like this
  // get in". The admissions word is REQUIRED within the sentence, so ordinary
  // counselling arithmetic ("three of their five targets require chemistry")
  // does not trip it.
  { pattern: new RegExp(`\\b${SMALL_NUMBER}\\s+(?:in|out of)\\s+${SMALL_NUMBER}\\b[^.!?]{0,60}?\\b(?:applicants?|admitted|accepted|gets? in|an offer|offers?)\\b`, "i"), why: "an admission rate applied to this student" },
  { pattern: /\blikely\s+to\s+(?:be\s+(?:admitted|accepted|rejected|denied)|get\s+in)\b/i, why: "a likelihood of the decision" },
  { pattern: /\b(?:safety|match|reach)\s+with\s+\d{1,3}\s*%/i, why: "a classification with a percentage" },
  { pattern: /\bno\s+(?:real\s+)?(?:chance|hope)\s+(?:of|at)\b/i, why: "a claim that admission is impossible" },
];

/**
 * Every banned phrasing found anywhere in a generated narrative.
 *
 * Walks the whole object rather than named fields, so a new field added to the
 * schema is covered the day it is added rather than the day someone remembers
 * to add it here.
 */
export function findBannedCounselorPhrasing(value: unknown): string[] {
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
