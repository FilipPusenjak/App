// Zod schemas for the profile, test scores, and resume items. Actions parse
// FormData into plain objects (empty strings -> undefined, dates/numbers coerced)
// and validate here before touching the database.
import { z } from "zod";
import {
  curriculumSchema,
  resumeItemTypeSchema,
  testScoreKindSchema,
} from "./enums";
import { isValidCountryCode } from "@/lib/data/countries";

export const profileSchema = z.object({
  /** What the account calls this student. Null/blank for a solo student. */
  studentName: z.string().trim().max(120).optional(),
  gradeLevel: z.string().trim().max(100).optional(),
  schoolName: z.string().trim().max(200).optional(),
  schoolContext: z.string().trim().max(2000).optional(),
  curriculum: curriculumSchema.optional(),
  gpa: z.number().min(0).max(100).optional(),
  gpaScale: z.string().trim().max(20).optional(),
  intendedMajor: z.string().trim().max(200).optional(),
  careerGoal: z.string().trim().max(300).optional(),
  countryOfOrigin: z
    .string()
    .trim()
    .refine((c) => c === "" || isValidCountryCode(c), {
      error: "Choose a country from the list.",
    })
    .optional(),
});

export const testScoreSchema = z.object({
  kind: testScoreKindSchema,
  label: z.string().trim().min(1, { error: "Label is required." }).max(200),
  score: z.string().trim().min(1, { error: "Score is required." }).max(50),
  maxScore: z.string().trim().max(50).optional(),
  predicted: z.boolean().optional(),
  takenOn: z.date().optional(),
});

export const resumeItemSchema = z
  .object({
    type: resumeItemTypeSchema,
    title: z.string().trim().min(1, { error: "Title is required." }).max(200),
    description: z.string().trim().max(5000).optional(),
    org: z.string().trim().max(200).optional(),
    startDate: z.date().optional(),
    endDate: z.date().optional(),
    hoursPerWeek: z.number().min(0).max(168).optional(),
    evidenceNotes: z.string().trim().max(5000).optional(),
  })
  .refine(
    (v) => !v.startDate || !v.endDate || v.endDate >= v.startDate,
    { error: "End date can't be before the start date.", path: ["endDate"] },
  );

export type ProfileInput = z.infer<typeof profileSchema>;
export type TestScoreInput = z.infer<typeof testScoreSchema>;
export type ResumeItemInput = z.infer<typeof resumeItemSchema>;
