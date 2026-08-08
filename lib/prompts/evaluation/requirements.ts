// Rendering researched course requirements into the evaluation prompt.
//
// The model has no lookup: its read on what a course requires comes from
// recollection, which is why `verifyThese` exists. Where we have a SOURCED
// requirement, the model should defer to it — and where we do not, nothing
// changes and it keeps saying "check this".
//
// The instruction below is written to prevent the failure this data could
// introduce: silent over-reach. Sourced facts must not license the model to
// speak confidently about everything ELSE at that university, and an aging or
// stale row must not be treated as current.
import type { ResolvedRequirement } from "@/lib/requirements/lookup";
import {
  REQUIREMENT_FIELDS,
  REQUIREMENT_LABELS,
} from "@/lib/validation/course-requirements";

export function renderRequirements(
  resolved: ResolvedRequirement[],
): string | null {
  if (resolved.length === 0) return null;

  const blocks = resolved.map((r) => {
    const lines = [`## ${r.targetName} — ${r.course}`];
    const caveats: string[] = [];
    if (r.stale) {
      caveats.push(
        `the source page was for an EARLIER cycle (${r.cycleYear}) and may no longer hold`,
      );
    }
    if (r.aging) {
      caveats.push(
        `this was researched on ${r.gatheredOn.toISOString().slice(0, 10)} and requirements are republished annually`,
      );
    }
    if (caveats.length > 0) {
      lines.push(`NOT CONFIRMED CURRENT — ${caveats.join("; ")}.`);
    } else {
      lines.push(`Verified for the ${r.cycleYear} cycle.`);
    }

    for (const field of REQUIREMENT_FIELDS) {
      const fact = r.requirements[field];
      if (fact) lines.push(`- ${REQUIREMENT_LABELS[field]}: ${fact.value}`);
    }
    return lines.join("\n");
  });

  return `These entry requirements were taken from official university and national admissions pages. Each one is quoted and linked in the student's record.

**Where a requirement appears below, use it and do not contradict it from memory.** Your own recollection of what a course requires is exactly what these replace.

**Where a requirement is NOT listed below, nothing has changed:** you do not know it, and it belongs in verifyThese as before. A course appearing here does not mean everything about that course is known — it means these specific fields are.

**Anything marked NOT CONFIRMED CURRENT is a lead, not a fact.** Reference it as "as of" its date, and still put it in verifyThese.

Never restate these as your own knowledge, and never generalise from one course to another at the same university.

${blocks.join("\n\n")}`;
}
