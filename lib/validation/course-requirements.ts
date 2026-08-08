// Validating researched course entry requirements before they can be believed.
//
// This is the gate between an agent's research output and something an app
// tells a 14-year-old. There is no human review step, so the schema IS the
// review: anything it accepts will be shown to students as fact, and anything
// it rejects costs nothing but a "check the course page".
//
// So it is deliberately unforgiving in one specific way: A FACT WITHOUT A
// SOURCE IS NOT A FACT. Every requirement must arrive with a verbatim quote and
// the URL it came from, and a record that supplies a value without them is
// rejected rather than partially accepted. That single rule is what stops a
// model's recollection being laundered into an authoritative-looking table,
// which is the whole failure mode this data introduces.
//
// Being rejected is a safe outcome and being wrong is not, so every rule below
// resolves ambiguity toward rejection.
import { z } from "zod";

/** Where an acceptance rate applies. Never the same number twice. */
export const RATE_SCOPES = ["course", "faculty", "institution"] as const;
export const rateScopeSchema = z.enum(RATE_SCOPES);
export type RateScope = (typeof RATE_SCOPES)[number];

/**
 * A URL that could plausibly be an official source.
 *
 * We cannot verify "official" from here — that is a judgement the brief asks
 * the researcher to make. What we CAN enforce is that it is a real https URL
 * and not one of the aggregator domains the brief explicitly bans, so an
 * obvious violation is caught mechanically rather than trusted.
 */
const BANNED_SOURCE_HOSTS = [
  "thestudentroom.co.uk",
  "wikipedia.org",
  "reddit.com",
  "quora.com",
  "medium.com",
  "chatgpt.com",
  "claude.ai",
];

const sourceUrlSchema = z
  .string()
  .url()
  .refine((u) => u.startsWith("https://"), {
    message: "Source must be https — a plain http page is not citable.",
  })
  .refine(
    (u) => {
      let host: string;
      try {
        host = new URL(u).hostname.toLowerCase();
      } catch {
        return false;
      }
      return !BANNED_SOURCE_HOSTS.some(
        (banned) => host === banned || host.endsWith(`.${banned}`),
      );
    },
    {
      message:
        "Source is a forum, wiki or aggregator. Official university or national admissions pages only.",
    },
  );

/**
 * One researched fact.
 *
 * The quote is not decoration. It is what makes the claim checkable a year
 * later without redoing the research, and it is the thing a fabricated fact
 * cannot produce. A minimum length is enforced because "yes" or "required" is
 * not a quotation of anything.
 */
export const sourcedFactSchema = z.object({
  /** The compressed fact, one line. This is what reaches the prompt. */
  value: z.string().trim().min(3).max(300),
  /** Verbatim from the source page. */
  quote: z.string().trim().min(15).max(1000),
  sourceUrl: sourceUrlSchema,
});
export type SourcedFact = z.infer<typeof sourcedFactSchema>;

/** Every field is optional; absent means "unknown", which is a safe answer. */
export const requirementsSchema = z.object({
  gradeRequirement: sourcedFactSchema.nullable().optional(),
  requiredSubjects: sourcedFactSchema.nullable().optional(),
  admissionsTest: sourcedFactSchema.nullable().optional(),
  languageRequirement: sourcedFactSchema.nullable().optional(),
  interview: sourcedFactSchema.nullable().optional(),
  workExperience: sourcedFactSchema.nullable().optional(),
  restrictedEntry: sourcedFactSchema.nullable().optional(),
  applicationRoute: sourcedFactSchema.nullable().optional(),
});
export type Requirements = z.infer<typeof requirementsSchema>;

export const REQUIREMENT_FIELDS = [
  "gradeRequirement",
  "requiredSubjects",
  "admissionsTest",
  "languageRequirement",
  "interview",
  "workExperience",
  "restrictedEntry",
  "applicationRoute",
] as const;
export type RequirementField = (typeof REQUIREMENT_FIELDS)[number];

/** Student-facing labels. These reach the UI, so they read as English. */
export const REQUIREMENT_LABELS: Record<RequirementField, string> = {
  gradeRequirement: "Grades",
  requiredSubjects: "Required subjects",
  admissionsTest: "Admissions test",
  languageRequirement: "Language",
  interview: "Interview",
  workExperience: "Work experience",
  restrictedEntry: "Restricted entry",
  applicationRoute: "How to apply",
};

/**
 * An acceptance rate. Internal only — never rendered, never given to the model
 * as a number.
 *
 * `scope` is mandatory precisely because the number is meaningless without it:
 * an institution-wide rate, a faculty rate and a course rate are three
 * different figures, and none of them is the rate for a given applicant.
 */
export const acceptanceRateSchema = z.object({
  percent: z.number().min(0).max(100),
  scope: rateScopeSchema,
  quote: z.string().trim().min(15).max(1000),
  sourceUrl: sourceUrlSchema,
});

const currentYear = new Date().getUTCFullYear();

export const courseRequirementRecordSchema = z.object({
  university: z.string().trim().min(2).max(200),
  /** ISO 3166-1 alpha-2, uppercase. */
  country: z
    .string()
    .trim()
    .length(2)
    .transform((c) => c.toUpperCase()),
  course: z.string().trim().min(2).max(200),
  /**
   * The admissions cycle the page describes. Bounded rather than free: a year
   * far in the past means the researcher read an archived page, and one far in
   * the future means they guessed.
   */
  cycleYear: z.number().int().min(currentYear - 3).max(currentYear + 3),
  /** The researcher's own flag that the page was for an older cycle. */
  stale: z.boolean().default(false),
  gatheredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD."),
  primarySourceUrl: sourceUrlSchema,
  requirements: requirementsSchema,
  acceptanceRate: acceptanceRateSchema.nullable().optional(),
  omitted: z
    .array(
      z.object({
        field: z.string().trim().min(2),
        reason: z.string().trim().min(10),
      }),
    )
    .default([]),
});
export type CourseRequirementRecord = z.infer<
  typeof courseRequirementRecordSchema
>;

/**
 * A record carrying nothing usable is rejected.
 *
 * Not pedantry: storing a row whose every field is null makes the app look as
 * though it researched a course and found no requirements, which is a
 * different and more misleading claim than never having looked. Absence of a
 * row means "we have not checked"; a row means "we checked".
 */
export const validatedCourseRequirementSchema =
  courseRequirementRecordSchema.refine(
    (r) => REQUIREMENT_FIELDS.some((f) => r.requirements[f]),
    {
      message:
        "Record has no sourced requirement at all. An empty row claims we looked and found nothing, which is not the same as not having looked.",
    },
  );

export type IngestOutcome =
  | { ok: true; record: CourseRequirementRecord }
  | { ok: false; identifier: string; errors: string[] };

/**
 * Validate one record from the agent's file.
 *
 * Returns rather than throws, so a bad record does not abort the batch — the
 * useful outcome of an ingest is "these 40 landed, these 6 did not and here is
 * why", not a stack trace on the seventh.
 */
export function validateRecord(input: unknown): IngestOutcome {
  const parsed = validatedCourseRequirementSchema.safeParse(input);
  if (parsed.success) return { ok: true, record: parsed.data };

  // Identify the record even when it failed, so the report names something a
  // human can find in the source file.
  const raw = (input ?? {}) as { university?: unknown; course?: unknown };
  const identifier =
    typeof raw.university === "string" && typeof raw.course === "string"
      ? `${raw.university} — ${raw.course}`
      : "(unidentifiable record)";

  return {
    ok: false,
    identifier,
    errors: parsed.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
    ),
  };
}
