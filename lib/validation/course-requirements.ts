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
import { COUNTRIES } from "@/lib/data/countries";

/** The permitted codes, as a set — this list is the app's, not ISO's. */
const COUNTRY_CODES = new Set(COUNTRIES.map((c) => c.code));

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
  /**
   * The compressed fact, one line. This is what reaches the prompt.
   *
   * 450, not the 300 this started at: a real batch of researched requirements
   * (UC's fifteen-course "A-G" subject list, EU language-certificate detail)
   * ran up to 394 characters for a single genuine, densely-stated fact — not
   * padding. 300 was an arbitrary guess that discarded correct, sourced data
   * for being a paragraph a few words too long.
   */
  value: z.string().trim().min(3).max(450),
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
 *
 * Free text, not a closed enum. The first version required one of
 * "course" | "faculty" | "institution", and against a real research batch it
 * rejected roughly 340 records — 29% of the set — where the SCOPE was the only
 * problem: a genuinely well-sourced rate described as "university-wide
 * first-year admission, Fall 2025" or similar, phrased the way the source
 * actually phrases it. That is MORE precise than the three-value enum would
 * have captured, not less. The enum was solving a problem free text already
 * solves, at the cost of discarding real data. What still matters — some
 * stated scope, evidenced by a quote — is unchanged.
 */
export const acceptanceRateSchema = z.object({
  percent: z.number().min(0).max(100),
  scope: z.string().trim().min(3).max(200),
  quote: z.string().trim().min(15).max(1000),
  sourceUrl: sourceUrlSchema,
});

const currentYear = new Date().getUTCFullYear();

/**
 * Codes a researcher plausibly writes that this app does not use.
 *
 * Corrected rather than rejected, because each is UNAMBIGUOUS — there is
 * exactly one thing "UK" can mean — and rejecting a batch of otherwise sound
 * UK records over a two-letter convention would throw away real research to
 * make a point. Everything genuinely ambiguous still falls through to the
 * rejection below.
 *
 * The correction is reported by the ingest, never silent. A record whose
 * country was changed is a record whose researcher is working from the wrong
 * list, and that is worth knowing before the next batch.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  UK: "GB",
  EN: "GB",
  // Not ISO either, and the same mistake in the other direction.
  EL: "GR",
};

export const courseRequirementRecordSchema = z.object({
  university: z.string().trim().min(2).max(200),
  /**
   * One of the app's permitted country codes — NOT merely two characters.
   *
   * This was `.length(2)` and nothing more, which accepted "UK", "EN", "XX"
   * and "ZZ" alike and stored them. That is the worst shape a data bug can
   * take here: the record lands, the ingest reports it as accepted, and it then
   * matches no student ever, because a target's country is one of these codes
   * and "UK" is not among them. Silent, and invisible until someone wonders why
   * a researched course never appears.
   *
   * The research brief warns about exactly this and calls it "the single most
   * damaging mistake available to you". A warning in a prompt is not
   * enforcement; this is.
   */
  country: z
    .string()
    .trim()
    .length(2)
    .transform((c) => c.toUpperCase())
    .transform((c) => COUNTRY_ALIASES[c] ?? c)
    .refine((c) => COUNTRY_CODES.has(c), {
      message:
        "Country is not one of the app's permitted codes, so a record carrying it could never match a student's target. Use the code from the brief's list — the United Kingdom is GB, not UK.",
    }),
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
  /**
   * `.catch(undefined)`: a malformed acceptance rate is DROPPED rather than
   * failing the record. It is internal-only and never shown to a student, so
   * it must never be the reason a sourced, public-facing requirement — the
   * thing this table exists for — is discarded. See validateRecord, which
   * detects the drop and reports it rather than losing it silently.
   */
  acceptanceRate: acceptanceRateSchema.nullable().optional().catch(undefined),
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
  | {
      ok: true;
      record: CourseRequirementRecord;
      /**
       * True when the input carried an acceptanceRate that failed validation
       * and was dropped rather than sinking the record — see the `.catch()` on
       * acceptanceRate above. Surfaced so the drop is reported, not silent.
       */
      droppedAcceptanceRate: boolean;
      /**
       * The code as written, when it was not the one this app uses.
       *
       * Null when the record already carried a permitted code. Set — to e.g.
       * "UK" — when it was corrected, so the ingest can say so. A researcher
       * working from the wrong country list is a fact about the NEXT batch as
       * much as this one, and it is invisible unless reported.
       */
      correctedCountryFrom: string | null;
    }
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
  if (parsed.success) {
    const raw = (input ?? {}) as { acceptanceRate?: unknown; country?: unknown };
    const droppedAcceptanceRate =
      raw.acceptanceRate != null && parsed.data.acceptanceRate == null;

    const written =
      typeof raw.country === "string" ? raw.country.trim().toUpperCase() : null;
    const correctedCountryFrom =
      written && written !== parsed.data.country ? written : null;

    return {
      ok: true,
      record: parsed.data,
      droppedAcceptanceRate,
      correctedCountryFrom,
    };
  }

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
