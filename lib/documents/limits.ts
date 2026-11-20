// What the Common App allows, by application cycle.
//
// VERSIONED BY CYCLE, NOT CONSTANTS. The Common App revises its forms each
// August; a limit hard-coded into a component is one that silently goes wrong
// in a later year. Every character count in the document builder reads from
// here through limitsFor(), and a test fails the moment the current cycle has
// no entry — so a new cycle is a deliberate edit to this file, made after
// checking the new year's guide, rather than last year's numbers carried over.
//
// Pure: no database, no session.

export type CommonAppLimits = {
  maxActivities: number;
  /** Position/Leadership description. */
  position: number;
  /** Organization name. */
  organization: number;
  /** Activity details, honors won, and accomplishments. */
  description: number;
  maxHonors: number;
  honorTitle: number;
};

/**
 * Where each cycle's numbers come from, kept beside them so the next person to
 * edit this file knows which ones were checked and which were not.
 */
export type LimitsProvenance = {
  activities: string;
  honors: string;
  /** False until the honors values are confirmed against an official source. */
  honorsConfirmed: boolean;
};

export const COMMON_APP_LIMITS: Record<string, CommonAppLimits> = {
  "2026-27": {
    maxActivities: 10,
    position: 50,
    organization: 100,
    description: 150,
    maxHonors: 5,
    honorTitle: 100,
  },
};

export const COMMON_APP_LIMITS_PROVENANCE: Record<string, LimitsProvenance> = {
  "2026-27": {
    activities:
      'Common App, "Approaching the activities section" (September 2026): up to ten activities; Position/Leadership description 50 characters; Organization name 100; Activity details, honors won, and accomplishments 150.',
    honors:
      "Five honors with 100-character titles, as given in the build spec. Not yet confirmed against an official Common App source — check the live application before relying on them.",
    honorsConfirmed: false,
  },
};

/**
 * The application cycle a date falls in.
 *
 * The Common App opens each new year on 1 August, so August 2026 through July
 * 2027 is "2026-27". UTC, so the answer does not depend on where the server is.
 */
export function cycleFor(date: Date): string {
  const year = date.getUTCFullYear();
  const start = date.getUTCMonth() >= 7 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function currentCycle(now: Date = new Date()): string {
  return cycleFor(now);
}

/**
 * The limits for a cycle. Throws for a cycle with no entry rather than falling
 * back to another year's — a stale limit shipped to a student is worse than a
 * loud failure here, and the cycle test catches it before release.
 */
export function limitsFor(cycle: string): CommonAppLimits {
  const limits = COMMON_APP_LIMITS[cycle];
  if (!limits) {
    throw new Error(
      `No Common App limits configured for the ${cycle} cycle. Check that year's first-year guide and add them to lib/documents/limits.ts.`,
    );
  }
  return limits;
}

/**
 * How a character limit is counted: UTF-16 code units, i.e. JavaScript's
 * String length. That is never smaller than the number of characters a person
 * sees, so a text that fits here cannot overflow a form that counts either way.
 */
export function charCount(text: string): number {
  return text.length;
}

// ─── The Common App's own vocabulary ──────────────────────────────────────────
//
// The dropdown values below are the ones the Activities and Honors sections
// have used in recent years. The official guides checked for 2026-27 confirm
// the character limits above but do not list these values, so they are NOT yet
// confirmed for this cycle; check them against the live application.

export const COMMON_APP_ACTIVITY_TYPES = [
  "Academic",
  "Art",
  "Athletics: Club",
  "Athletics: JV/Varsity",
  "Career Oriented",
  "Community Service (Volunteer)",
  "Computer/Technology",
  "Cultural",
  "Dance",
  "Debate/Speech",
  "Environmental",
  "Family Responsibilities",
  "Foreign Exchange",
  "Foreign Language",
  "Internship",
  "Journalism/Publication",
  "Junior R.O.T.C.",
  "LGBT",
  "Music: Instrumental",
  "Music: Vocal",
  "Religious",
  "Research",
  "Robotics",
  "School Spirit",
  "Science/Math",
  "Social Justice",
  "Student Govt./Politics",
  "Theater/Drama",
  "Work (Paid)",
  "Other Club/Activity",
] as const;
export type CommonAppActivityType = (typeof COMMON_APP_ACTIVITY_TYPES)[number];

export const TIMINGS = ["SCHOOL_YEAR", "SCHOOL_BREAK", "ALL_YEAR"] as const;
export type Timing = (typeof TIMINGS)[number];
export const TIMING_LABELS: Record<Timing, string> = {
  SCHOOL_YEAR: "During school year",
  SCHOOL_BREAK: "During school break",
  ALL_YEAR: "All year",
};

/** 13 stands for the Common App's "Post-graduate". */
export const GRADE_LEVELS = [9, 10, 11, 12, 13] as const;
export function gradeLabel(grade: number): string {
  return grade === 13 ? "PG" : String(grade);
}

/** "grade 11" or "grades 10, 11" — the student's grades as a phrase. */
export function gradesPhrase(levels: number[]): string {
  return `${levels.length === 1 ? "grade" : "grades"} ${levels.map(gradeLabel).join(", ")}`;
}

export const RECOGNITION_LEVELS = [
  "SCHOOL",
  "STATE_REGIONAL",
  "NATIONAL",
  "INTERNATIONAL",
] as const;
export type RecognitionLevel = (typeof RECOGNITION_LEVELS)[number];
export const RECOGNITION_LABELS: Record<RecognitionLevel, string> = {
  SCHOOL: "School",
  STATE_REGIONAL: "State/Regional",
  NATIONAL: "National",
  INTERNATIONAL: "International",
};
