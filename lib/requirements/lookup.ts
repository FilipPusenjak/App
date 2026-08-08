// Finding researched requirements for a student's targets — SERVER ONLY.
//
// Reference data, not user data: these rows are shared across every student
// targeting the same course and belong to nobody, so there is no ownership
// filter here and there should not be. What IS ownership-scoped is the list of
// targets passed in, which callers only ever get from a profile loaded through
// lib/ownership.
//
// A target with no matching row yields nothing, and the evaluation behaves
// exactly as it does today for that school — "check the official course page".
// That is the designed failure and it is why the matcher refuses to guess.
import { prisma } from "@/lib/db";
import {
  requirementsSchema,
  type Requirements,
} from "@/lib/validation/course-requirements";
import { isUsableKey, matchKey } from "./match";

export type ResolvedRequirement = {
  /** The target as the STUDENT named it, so the UI labels it their way. */
  targetName: string;
  course: string;
  requirements: Requirements;
  cycleYear: number;
  stale: boolean;
  gatheredOn: Date;
  primarySourceUrl: string;
  /** True once the research is old enough to be doubted. */
  aging: boolean;
};

/**
 * How long researched requirements are trusted before the UI starts hedging.
 *
 * Entry requirements are republished annually, so a row from a previous cycle
 * is not evidence about this one. Eleven months is deliberately just inside a
 * year: it starts warning before the data is definitely wrong rather than
 * after.
 */
const AGING_AFTER_DAYS = 330;

/** Look up requirements for a set of targets. Missing ones are simply absent. */
export async function findRequirementsForTargets(
  targets: { name: string; country: string; course: string | null }[],
): Promise<ResolvedRequirement[]> {
  const wanted = new Map<string, { name: string; course: string }>();
  for (const t of targets) {
    // No course means no lookup. A university-level guess at course-specific
    // requirements is exactly the wrong match this is built to avoid.
    if (!t.course) continue;
    const key = matchKey({
      university: t.name,
      country: t.country,
      course: t.course,
    });
    if (isUsableKey(key)) wanted.set(key, { name: t.name, course: t.course });
  }
  if (wanted.size === 0) return [];

  const rows = await prisma.courseRequirement.findMany({
    where: { matchKey: { in: [...wanted.keys()] } },
  });

  const now = Date.now();
  const resolved: ResolvedRequirement[] = [];
  for (const row of rows) {
    // Stored JSON is re-validated on the way out, like every other structured
    // value in this app. A row that no longer satisfies the schema is dropped
    // rather than half-rendered.
    const parsed = requirementsSchema.safeParse(
      safeJson(row.requirementsJson),
    );
    if (!parsed.success) continue;

    const asked = wanted.get(row.matchKey);
    resolved.push({
      targetName: asked?.name ?? row.university,
      course: asked?.course ?? row.course,
      requirements: parsed.data,
      cycleYear: row.cycleYear,
      stale: row.stale,
      gatheredOn: row.gatheredOn,
      primarySourceUrl: row.primarySourceUrl,
      aging:
        now - row.gatheredOn.getTime() > AGING_AFTER_DAYS * 24 * 60 * 60 * 1000,
    });
  }
  return resolved;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
