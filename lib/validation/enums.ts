// Enum-like values, defined once here as the single source of truth. The Prisma
// schema stores these as plain strings (SQLite has no enums); these Zod enums are
// what the app actually validates against, and the *_LABELS maps drive the UI.
import { z } from "zod";

/**
 * Whether the stated grade level is in progress or already finished.
 *
 * Asked of the student rather than worked out from the date. School years do not
 * begin or end on a shared date — June is mid-year in the southern hemisphere and
 * done in the northern, and an international school can sit on neither calendar —
 * so a date-based guess is wrong for a whole hemisphere of users at a time.
 */
export const GRADE_STATUSES = ["in_progress", "completed"] as const;

/**
 * What the profile form pre-selects.
 *
 * A student typing a grade into this app is, overwhelmingly, in the middle of
 * it: the year is underway in the northern hemisphere from late summer and in
 * the southern from the start of the calendar year, so "in progress" is the
 * right guess in almost every month for almost everybody. The exception is the
 * student who finished in the summer and has not started the next year, and the
 * field is right there to change.
 *
 * A DEFAULT, not an assumption baked into the prompt. That distinction is the
 * whole point: the model is told what the profile says rather than told to work
 * it out from the date, so this stays correctable by the one person who knows,
 * and nothing downstream has a season hardcoded into it.
 */
export const GRADE_STATUS_DEFAULT: GradeStatus = "in_progress";
export const gradeStatusSchema = z.enum(GRADE_STATUSES);
export type GradeStatus = (typeof GRADE_STATUSES)[number];
export const GRADE_STATUS_LABELS: Record<GradeStatus, string> = {
  in_progress: "I am in it now",
  completed: "I have just finished it",
};

/** How each status is stated to the model. Full sentences, because the prompt
 *  reads as prose and "completed" alone invites the same guess back. */
export const GRADE_STATUS_PROMPT: Record<GradeStatus, string> = {
  in_progress: "the student is CURRENTLY IN this grade — it is not finished yet",
  completed:
    "the student has ALREADY FINISHED this grade — the next one has not started yet, so do not treat that year as still ahead of them",
};

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

/**
 * Kinds that cover more than one subject, so the type alone doesn't say which
 * — "AP exam" could be Physics or Spanish, so a label is how the two are told
 * apart. A single-score kind like SAT needs no label; TEST_SCORE_KIND_LABELS
 * already says everything there is to say about it.
 */
export const TEST_SCORE_KINDS_REQUIRING_LABEL = new Set<TestScoreKind>([
  "ap",
  "ib_subject",
  "gcse",
  "predicted_grade",
  "other",
]);

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
