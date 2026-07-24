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
