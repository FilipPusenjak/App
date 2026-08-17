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
import { isUsableKey } from "./match";
import { candidateKeys } from "./resolve";

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
  // One target expands to several candidate keys — the name as typed, its
  // acronym, its curated alias, and the mechanical "University of X" rewrites.
  // Which target a key came from has to survive the round trip, so a row can be
  // labelled with the name the STUDENT used and so ambiguity can be detected
  // per target rather than across the whole batch.
  const byKey = new Map<string, { name: string; course: string }>();
  const keysForTarget: { name: string; course: string; keys: string[] }[] = [];

  for (const t of targets) {
    const keys = candidateKeys(t).filter(isUsableKey);
    if (keys.length === 0) continue;
    keysForTarget.push({ name: t.name, course: t.course!, keys });
    for (const key of keys) {
      // First target to claim a key keeps it. Two targets resolving to the same
      // key are the same course at the same place, so either label is correct.
      if (!byKey.has(key)) byKey.set(key, { name: t.name, course: t.course! });
    }
  }
  if (byKey.size === 0) return [];

  const rows = await prisma.courseRequirement.findMany({
    where: { matchKey: { in: [...byKey.keys()] } },
  });
  const rowByKey = new Map(rows.map((row) => [row.matchKey, row]));

  const now = Date.now();
  const resolved: ResolvedRequirement[] = [];

  for (const target of keysForTarget) {
    const hits = target.keys
      .map((key) => rowByKey.get(key))
      .filter((row) => row != null);
    if (hits.length === 0) continue;

    // AMBIGUITY IS NOT A RANKING PROBLEM. If one typed name reached records
    // belonging to two different institutions, there is no evidence here about
    // which the student meant, and showing either one is the confident wrong
    // answer this whole path is built to avoid. Drop the target; the evaluation
    // says "check the course page", which is what it did before any of this.
    const distinct = new Set(hits.map((row) => `${row.country}::${row.university}`));
    if (distinct.size > 1) continue;

    // Stored JSON is re-validated on the way out, like every other structured
    // value in this app. A row that no longer satisfies the schema is dropped
    // rather than half-rendered.
    const row = hits[0]!;
    const parsed = requirementsSchema.safeParse(safeJson(row.requirementsJson));
    if (!parsed.success) continue;

    resolved.push({
      targetName: target.name,
      course: target.course,
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
