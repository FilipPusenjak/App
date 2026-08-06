// Enum-like values, defined once here as the single source of truth. The Prisma
// schema stores these as plain strings (SQLite has no enums); these Zod enums are
// what the app actually validates against, and the *_LABELS maps drive the UI.
import { z } from "zod";

export const CURRICULA = [
  "pre_ib",
  "ib",
  "ap",
  "a_levels",
  "gcse",
  "other",
] as const;
export const curriculumSchema = z.enum(CURRICULA);
export type Curriculum = (typeof CURRICULA)[number];
export const CURRICULUM_LABELS: Record<Curriculum, string> = {
  pre_ib: "Pre-IB",
  ib: "IB",
  ap: "AP",
  a_levels: "A-Levels",
  gcse: "GCSE",
  other: "Other",
};

export const RESUME_ITEM_TYPES = [
  "coursework",
  "extracurricular",
  "leadership",
  "award",
  "research",
  "work",
  "volunteering",
  "project",
  "certification",
] as const;
export const resumeItemTypeSchema = z.enum(RESUME_ITEM_TYPES);
export type ResumeItemType = (typeof RESUME_ITEM_TYPES)[number];
export const RESUME_ITEM_TYPE_LABELS: Record<ResumeItemType, string> = {
  coursework: "Coursework",
  extracurricular: "Extracurricular",
  leadership: "Leadership role",
  award: "Award",
  research: "Research",
  work: "Work / Internship",
  volunteering: "Volunteering",
  project: "Project",
  certification: "Certification",
};

export const CLASSIFICATIONS = ["reach", "match", "safety"] as const;
export const classificationSchema = z.enum(CLASSIFICATIONS);
export type Classification = (typeof CLASSIFICATIONS)[number];
export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  reach: "Reach",
  match: "Match",
  safety: "Safety",
};

export const TEST_SCORE_KINDS = [
  "sat",
  "act",
  "ap",
  "ib_subject",
  "ib_total",
  "predicted_grade",
  "ucat",
  "gcse",
  "ielts",
  "toefl",
  "other",
] as const;
export const testScoreKindSchema = z.enum(TEST_SCORE_KINDS);
export type TestScoreKind = (typeof TEST_SCORE_KINDS)[number];
export const TEST_SCORE_KIND_LABELS: Record<TestScoreKind, string> = {
  sat: "SAT",
  act: "ACT",
  ap: "AP exam",
  ib_subject: "IB subject",
  ib_total: "IB total",
  predicted_grade: "Predicted grade",
  ucat: "UCAT",
  gcse: "GCSE",
  ielts: "IELTS",
  toefl: "TOEFL",
  other: "Other",
};

// ---------------------------------------------------------------------------
// Activity Discovery
// ---------------------------------------------------------------------------

/**
 * How far a student actually got in an activity.
 *
 * Ordered from least to most involved, and deliberately about DEPTH rather
 * than prestige: "started the thing" outranks "attended the thing" because
 * that is the distinction a student reading this can act on. The two
 * competitive rungs sit at the end because they are the ones that carry
 * external validation.
 */
export const ACTIVITY_RUNGS = [
  "participant",
  "contributor",
  "officer",
  "initiator",
  "regional",
  "national",
] as const;
export const activityRungSchema = z.enum(ACTIVITY_RUNGS);
export type ActivityRung = (typeof ACTIVITY_RUNGS)[number];
export const ACTIVITY_RUNG_LABELS: Record<ActivityRung, string> = {
  participant: "Took part",
  contributor: "Contributed regularly",
  officer: "Held a role",
  initiator: "Started or founded it",
  regional: "Regional level",
  national: "National level",
};

/** Categories of the shared activity taxonomy. */
export const ACTIVITY_CATEGORIES = [
  "research",
  "clinical",
  "service",
  "leadership",
  "competition",
  "arts",
  "athletics",
  "work",
  "independent",
] as const;
export const activityCategorySchema = z.enum(ACTIVITY_CATEGORIES);
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];
export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  research: "Research",
  clinical: "Clinical & healthcare",
  service: "Service & volunteering",
  leadership: "Leadership",
  competition: "Competitions",
  arts: "Arts",
  athletics: "Athletics",
  work: "Work & internships",
  independent: "Independent projects",
};

/**
 * School type, for the "schools like yours" rung of the widening ladder.
 *
 * Coarse on purpose. Finer attributes would let a caller narrow a cohort until
 * it resolved to one person, which is the attack the whole feature is built
 * against.
 */
export const SCHOOL_TYPES = [
  "state",
  "private",
  "independent",
  "international",
  "selective",
  "other",
] as const;
export const schoolTypeSchema = z.enum(SCHOOL_TYPES);
export type SchoolType = (typeof SCHOOL_TYPES)[number];
export const SCHOOL_TYPE_LABELS: Record<SchoolType, string> = {
  state: "State / public",
  private: "Private",
  independent: "Independent",
  international: "International",
  selective: "Selective / grammar",
  other: "Other",
};

/** Bands, never counts — for the same reason activity counts are bucketed. */
export const SCHOOL_SIZE_BANDS = ["small", "medium", "large"] as const;
export const schoolSizeBandSchema = z.enum(SCHOOL_SIZE_BANDS);
export type SchoolSizeBand = (typeof SCHOOL_SIZE_BANDS)[number];
export const SCHOOL_SIZE_BAND_LABELS: Record<SchoolSizeBand, string> = {
  small: "Under 500 students",
  medium: "500–1,500 students",
  large: "Over 1,500 students",
};
