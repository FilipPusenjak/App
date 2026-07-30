// Zod schema for the "things I plan to do" form.
//
// Mirrors the resume-item schema (same type enum, same optional fields) so a
// plan that gets done can be retyped as a real item without surprises.
import { z } from "zod";
import { resumeItemTypeSchema } from "./enums";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" ? undefined : v));

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" || v == null ? undefined : v))
  .refine((v) => v == null || !Number.isNaN(Date.parse(v)), {
    error: "Enter a valid date.",
  })
  .transform((v) => (v == null ? undefined : new Date(v)));

export const plannedItemSchema = z.object({
  type: resumeItemTypeSchema,
  title: z
    .string()
    .trim()
    .min(1, { error: "Give this plan a title." })
    .max(200),
  org: optionalText(200),
  description: optionalText(2000),
  targetDate: optionalDate,
  hoursPerWeek: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" || v == null ? undefined : Number(v)))
    .refine((v) => v == null || (!Number.isNaN(v) && v >= 0 && v <= 168), {
      error: "Hours per week must be between 0 and 168.",
    }),
});

export type PlannedItemInput = z.infer<typeof plannedItemSchema>;
