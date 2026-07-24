// Zod schema for a target school. `country` is the first-class field the AI
// evaluation branches on (US holistic vs UK course-specific), so it's required
// and validated against the known country list.
import { z } from "zod";
import { classificationSchema } from "./enums";
import { isValidCountryCode } from "@/lib/data/countries";

export const targetSchoolSchema = z.object({
  name: z.string().trim().min(1, { error: "School name is required." }).max(200),
  country: z
    .string()
    .trim()
    .refine((c) => isValidCountryCode(c), {
      error: "Choose a country from the list.",
    }),
  course: z.string().trim().max(200).optional(),
  classification: classificationSchema,
  priority: z.number().int().min(1).max(99).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type TargetSchoolInput = z.infer<typeof targetSchoolSchema>;
