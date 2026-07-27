// Rubric registry — extensible by design.
//
// To support another country: write the Rubric, register it here, and it is
// picked up automatically wherever that country is a target. No schema change,
// no prompt edit, no change to the evaluation pipeline.
import type { Rubric } from "./types";
import { usRubric } from "./us";
import { ukRubric } from "./uk";
import { genericRubric } from "./generic";

export type { Rubric, RubricDimension, DimensionWeight } from "./types";
export { usRubric, ukRubric, genericRubric };

const REGISTRY: Record<string, Rubric> = {
  US: usRubric,
  GB: ukRubric,
  // "UK" is not an ISO 3166-1 code (the country list uses "GB"), but it is the
  // obvious thing to type and appeared in early seed data. Alias it so a UK
  // target can never silently fall through to the generic rubric.
  UK: ukRubric,
};

/** The rubric for a country code, falling back to the cautious generic one. */
export function getRubric(countryCode: string | null | undefined): Rubric {
  if (!countryCode) return genericRubric;
  return REGISTRY[countryCode.toUpperCase()] ?? genericRubric;
}

/** True when we have a real, country-specific rubric (not the fallback). */
export function hasCountryRubric(countryCode: string | null | undefined) {
  return Boolean(countryCode && REGISTRY[countryCode.toUpperCase()]);
}

const ALL_RUBRICS = [usRubric, ukRubric, genericRubric];

/**
 * Look a rubric up by its id. Stored results record the rubric id that produced
 * them, so this is the correct way to resolve a rubric when rendering a saved
 * evaluation — the country there is a display name, not a code.
 */
export function getRubricById(id: string | null | undefined): Rubric | null {
  if (!id) return null;
  return ALL_RUBRICS.find((r) => r.id === id) ?? null;
}

/** The distinct rubrics needed for a set of target countries, deduped. */
export function rubricsForCountries(countryCodes: string[]): Rubric[] {
  const seen = new Map<string, Rubric>();
  for (const code of countryCodes) {
    const rubric = getRubric(code);
    if (!seen.has(rubric.id)) seen.set(rubric.id, rubric);
  }
  return [...seen.values()];
}

/** Render a rubric as prompt text. Kept next to the data so they can't drift. */
export function renderRubric(rubric: Rubric): string {
  const dimensions = rubric.dimensions
    .map(
      (d) =>
        `  - ${d.label} [weight: ${d.weight}]\n    ${d.description}`,
    )
    .join("\n");
  const guidance = rubric.guidance.map((g) => `  - ${g}`).join("\n");
  const cautions = rubric.cautions.map((c) => `  - ${c}`).join("\n");

  return [
    `RUBRIC: ${rubric.name} (id: ${rubric.id})`,
    rubric.summary,
    "",
    "Dimensions (weights are how much this dimension actually moves the decision):",
    dimensions,
    "",
    "How to weigh evidence in this system:",
    guidance,
    "",
    "Do NOT assert the following for this system — defer and tell the student to verify:",
    cautions,
  ].join("\n");
}
