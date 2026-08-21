// Turning section scores into the number a school actually reads.
//
// Pure, and separate from everything else, because three different things need
// it and must all agree: the attempt being recorded, the superscore composed
// across sittings, and the "what would one more retake buy" arithmetic in the
// stopping engine. A composite computed two ways is two different products.
//
// NOTHING HERE IS ASKED OF A MODEL. A model will happily state a composite, and
// will be wrong often enough to matter to a family — the SAT sums and the ACT
// averages-and-rounds, and that difference decides whether a single-section
// retake is worth sitting.
import type {
  CompositeRule,
  TestSectionSchema,
} from "@/lib/validation/testprep";

export type SectionScores = Record<string, number>;

/**
 * The composite for one set of section scores, or null when there isn't one.
 *
 * Null is a real answer in two cases and neither is an error: the rule is NONE
 * (the LNAT essay is not numeric, so no composite is reported anywhere), or a
 * section is missing (a partial sitting cannot produce a whole-test number, and
 * inventing one by treating the gap as zero would report a catastrophe).
 */
export function computeComposite(
  sections: SectionScores,
  rule: CompositeRule,
  schema: TestSectionSchema,
): number | null {
  if (rule === "NONE") return null;

  const values: number[] = [];
  for (const section of schema.sections) {
    const v = sections[section.name];
    if (typeof v !== "number" || Number.isNaN(v)) {
      // HIGHEST_SECTION is the one rule that tolerates a gap: it reports the
      // best single section, and a section nobody sat simply isn't a candidate.
      if (rule === "HIGHEST_SECTION") continue;
      return null;
    }
    values.push(v);
  }
  if (values.length === 0) return null;

  switch (rule) {
    case "SUM":
      return values.reduce((a, b) => a + b, 0);
    case "AVERAGE":
      // Rounded half-up, which is what the ACT does. Math.round is half-up for
      // positives and every section score here is positive.
      return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    case "HIGHEST_SECTION":
      return Math.max(...values);
  }
}

/**
 * The best score in each section, taken across sittings.
 *
 * This is what superscoring means, and it is computed here rather than at the
 * call site because the WRONG version of it is so easy to write: taking the
 * best composite and reporting its sections is not a superscore, it is just the
 * best sitting. The point of a superscore is that the best English and the best
 * Math may come from different days.
 */
export function bestSectionScores(
  attempts: { sectionScores: SectionScores }[],
  schema: TestSectionSchema,
): SectionScores {
  const best: SectionScores = {};
  for (const section of schema.sections) {
    for (const attempt of attempts) {
      const v = attempt.sectionScores[section.name];
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      const current = best[section.name];
      if (current === undefined || v > current) best[section.name] = v;
    }
  }
  return best;
}

/**
 * The composite a school would see, given what it does with multiple sittings.
 *
 * `superscores` is the whole argument. A superscoring school reads the best
 * sections combined; a non-superscoring one reads the best SINGLE SITTING, and
 * handing it a composed number would overstate what it will actually see —
 * which, on a parent-facing artifact, is the kind of overstatement that ends an
 * engagement badly.
 */
export function compositeAsSchoolSeesIt(
  attempts: { sectionScores: SectionScores; composite: number | null }[],
  rule: CompositeRule,
  schema: TestSectionSchema,
  superscores: boolean,
): number | null {
  if (attempts.length === 0) return null;

  if (superscores) {
    return computeComposite(bestSectionScores(attempts, schema), rule, schema);
  }

  // Best single sitting. Recomputed rather than trusting the stored composite,
  // so a row written before a schema correction cannot quietly set the target.
  let best: number | null = null;
  for (const attempt of attempts) {
    const c = computeComposite(attempt.sectionScores, rule, schema);
    if (c === null) continue;
    if (best === null || c > best) best = c;
  }
  return best;
}
