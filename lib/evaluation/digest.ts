// Compacting a finished grade year.
//
// This exists for a structural cost reason, not as an optimisation. Students
// are meant to stay four years on a flat subscription, so a senior's weekly
// check-in must not cost several times a freshman's simply because three more
// years of raw entries have piled up behind them. Once a grade year is over,
// its entries are replaced in CHECK-IN context by this summary, permanently.
//
// Deep reviews still read the full history. That asymmetry is what makes the
// tier boundary honest: the cheaper tier is cheaper because it genuinely
// receives less, not because the expensive one has been withheld.
//
// Generation is a batch job on the cheap model — see generateDigest.
import { z } from "zod";
import { RUNGS } from "@/lib/readiness/rungs";

/**
 * One activity, compacted.
 *
 * Rung and duration are carried STRUCTURED rather than prose, because they are
 * what later scoring reads and re-deriving them from a sentence would put a
 * model back in the business of computing. The prose is only there to keep
 * substance a rung cannot express.
 */
export const digestActivitySchema = z.object({
  title: z.string().trim().min(1).max(200),
  type: z.string().trim().min(1).max(60),
  rung: z.enum(RUNGS),
  months: z.number().int().min(0).max(600).nullable(),
  /** One or two sentences. Capped so a digest cannot grow back into history. */
  substance: z.string().trim().max(400),
});

export const profileDigestSchema = z.object({
  throughGrade: z.number().int().min(9).max(12),
  activities: z.array(digestActivitySchema).max(40),
  /** Academic state at the end of that year, as recorded then. */
  academics: z.object({
    gpa: z.number().nullable(),
    gpaScale: z.string().nullable(),
    curriculum: z.string().nullable(),
    testScores: z
      .array(
        z.object({
          label: z.string().max(60),
          score: z.string().max(40),
          predicted: z.boolean(),
        }),
      )
      .max(20),
  }),
});

export type ProfileDigestSummary = z.infer<typeof profileDigestSchema>;

/**
 * Render a digest for a prompt.
 *
 * Deliberately terse. This is the compaction actually paying off, and every
 * line added here is a line paid for on every check-in for the rest of the
 * student's time in the product.
 */
export function renderDigest(digest: ProfileDigestSummary): string {
  const lines: string[] = [];
  lines.push(`### Grade ${digest.throughGrade} (completed)`);

  const a = digest.academics;
  const academic = [
    a.gpa != null ? `GPA ${a.gpa}${a.gpaScale ? `/${a.gpaScale}` : ""}` : null,
    a.curriculum,
    ...a.testScores.map((t) => `${t.label} ${t.score}${t.predicted ? " (pred)" : ""}`),
  ].filter(Boolean);
  if (academic.length > 0) lines.push(`- ${academic.join(" · ")}`);

  for (const item of digest.activities) {
    const span = item.months != null ? `, ${item.months}mo` : "";
    lines.push(
      `- ${item.title} (${item.type}, ${item.rung}${span})${item.substance ? ` — ${item.substance}` : ""}`,
    );
  }
  return lines.join("\n");
}

/** Rough token cost of a rendered digest, for the budget assertions. */
export function estimateTokens(text: string): number {
  // ~4 characters per token is close enough to hold a budget to; the tests
  // assert headroom rather than a precise figure.
  return Math.ceil(text.length / 4);
}

export const DIGEST_SYSTEM_PROMPT = `You compact one completed school year of a student's activity record into a short summary that a later evaluation will read instead of the raw entries.

Rules:
- Preserve what was DONE and what came of it. Drop scheduling detail, duplicated wording, and anything that reads as filler.
- Two sentences maximum per activity, and one is usually enough.
- Never editorialise about the student. No praise, no criticism, no judgement of whether an activity was worthwhile. A later evaluation does that work and must not inherit your opinion as though it were a fact.
- Never invent detail that is not in the entry. If an entry is thin, its summary is thin.
- Do not mention grades, admissions, universities, or chances.

Return JSON matching the schema exactly.`;
