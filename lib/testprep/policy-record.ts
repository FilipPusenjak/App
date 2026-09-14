// One researched school test policy, and what makes it fit to become data.
//
// PURE — no database, so the rules below can be tested directly and the ingest
// script is only a loop around them.
//
// THE NUMBERS IN THESE RECORDS BECOME A TARGET A FAMILY IS HELD TO. A p75 that
// is wrong by a hundred points is a student told to keep paying for sittings
// they did not need, or told to stop before they were ready. That is the whole
// reason this file is strict about things a looser importer would wave through:
//
//   QUARTILES MUST BE ORDERED. p25 <= p50 <= p75 is not a nicety — deriveTarget
//   reads p75 as the bar and p25/p50 to decide whether a test-optional school is
//   worth submitting to. Out-of-order quartiles make that comparison meaningless
//   in a way nothing downstream can detect.
//
//   A BLIND SCHOOL MAY NOT CARRY QUARTILES. A school that will not look at a
//   score has no middle 50% of submitted scores to report, so a record claiming
//   both is describing something that does not exist — and since target.ts
//   excludes blind schools entirely, the numbers would sit in the database
//   looking authoritative and never be read.
//
//   AN OPTIONAL OR REQUIRED SCHOOL WITHOUT QUARTILES IS ACCEPTED, and simply
//   sets no bar. Refusing it would mean a school could not appear in the
//   catalogue at all until someone found its numbers, and a school that is
//   present-but-silent is more honest than one that is absent.
//
// PROVENANCE IS MANDATORY. sourceDataVersion is what a recomputation keys on
// when a cycle's data is superseded, and what answers "where did 1500 come
// from" months later. A record without it is a number with no source, which is
// the thing target.ts exists to avoid.
import { z } from "zod";
import { isValidCountryCode } from "@/lib/data/countries";
import { testPolicySchema } from "@/lib/validation/testprep";

const trimmed = (max: number) => z.string().trim().min(1).max(max);

/** A percentile on the test's own scale. Bounds are checked per test later. */
const percentile = z.number().int().positive().nullable().optional();

export const policyRecordSchema = z
  .object({
    /** The school's official name, as the catalogue should show it. */
    school: trimmed(200),
    country: trimmed(2).refine(isValidCountryCode, {
      error: "Not an ISO country code we recognise.",
    }),
    /** State or province. Part of School's uniqueness, so it pins which campus. */
    region: z.string().trim().max(120).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),

    /** Which test this policy is about, by TestType.code. */
    test: trimmed(20),
    /** The admissions cycle it applies to, e.g. 2027. */
    cycle: z.number().int().min(2000).max(2100),

    policy: testPolicySchema,
    superscores: z.boolean().default(false),
    scoreChoice: z.boolean().default(false),

    p25: percentile,
    p50: percentile,
    p75: percentile,
  })
  .superRefine((r, ctx) => {
    const quartiles = [r.p25, r.p50, r.p75].filter(
      (v): v is number => typeof v === "number",
    );

    if (r.policy === "BLIND" && quartiles.length > 0) {
      ctx.addIssue({
        code: "custom",
        message:
          "A test-blind school reports no middle 50% — it does not look at scores.",
        path: ["p50"],
      });
    }

    // Ordered where present. A record giving only p25 and p75 is still checked
    // against each other; one giving a single figure has nothing to compare.
    const { p25, p50, p75 } = r;
    const ordered =
      (p25 == null || p50 == null || p25 <= p50) &&
      (p50 == null || p75 == null || p50 <= p75) &&
      (p25 == null || p75 == null || p25 <= p75);
    if (!ordered) {
      ctx.addIssue({
        code: "custom",
        message: `Quartiles out of order: ${p25 ?? "—"} / ${p50 ?? "—"} / ${p75 ?? "—"}.`,
        path: ["p50"],
      });
    }
  });

export type PolicyRecord = z.infer<typeof policyRecordSchema>;

/** The whole file: records plus the provenance every one of them inherits. */
export const policyFileSchema = z.object({
  /**
   * Where these came from and when, e.g. "testprep/2027-common-data-set".
   *
   * Stamped onto every policy row. recomputeForPolicyVersion keys on it, so a
   * corrected batch re-derives exactly the targets that rested on the old one.
   */
  sourceDataVersion: trimmed(120),
  records: z.array(z.unknown()),
});

/**
 * Is this percentile a value the test can actually produce?
 *
 * Checked against the seeded schema rather than hardcoded, so a record claiming
 * an SAT of 36 — an ACT figure filed under the wrong test, which is the likeliest
 * research error — is rejected rather than silently becoming a bar no student
 * can clear.
 */
export function percentileInRange(
  value: number,
  schema: { compositeMin: number | null; compositeMax: number | null },
): boolean {
  if (schema.compositeMin != null && value < schema.compositeMin) return false;
  if (schema.compositeMax != null && value > schema.compositeMax) return false;
  return true;
}
