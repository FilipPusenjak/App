// How often a student may regenerate, per calendar month.
//
// A run costs a few cents, so the cap is not about any one run. It exists
// because uncapped regeneration is the one way this feature's cost can run
// away — a student mashing "regenerate" to get a different phrasing. Only runs
// that actually called the model count: a run served entirely from the cache
// cost nothing and uses nothing up.
import { prisma } from "@/lib/db";

export const REGENERATION_CAPS = {
  /** Whole-list generations per month. */
  LIST_PER_MONTH: 5,
  /** Regenerations of one entry (or one grammar fix of one story) per month. */
  ENTRY_PER_MONTH: 3,
} as const;

export type GenerationScope = "LIST" | "ENTRY" | "GRAMMAR";

/** Start of the current calendar month, UTC. Caps reset on the 1st. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function capFor(scope: GenerationScope): number {
  return scope === "LIST" ? REGENERATION_CAPS.LIST_PER_MONTH : REGENERATION_CAPS.ENTRY_PER_MONTH;
}

/** The decision, given how many runs this month already used the model. */
export function capDecision(
  scope: GenerationScope,
  used: number,
): { ok: true; remaining: number } | { ok: false; message: string } {
  const cap = capFor(scope);
  if (used < cap) return { ok: true, remaining: cap - used };
  return {
    ok: false,
    message:
      scope === "LIST"
        ? `You've regenerated the whole list ${cap} times this month, the most a month allows. You can still edit any field by hand, and regenerate again from the 1st.`
        : `This entry has been regenerated ${cap} times this month, the most a month allows. You can still edit it by hand, and regenerate it again from the 1st.`,
  };
}

/** Runs that used the model this month, for one scope (and one entry). */
export async function runsThisMonth(input: {
  profileId: string;
  scope: GenerationScope;
  entryKey?: string;
  now?: Date;
}): Promise<number> {
  return prisma.documentGenerationLog.count({
    where: {
      profileId: input.profileId,
      // A grammar fix of a story counts against that story's entry cap.
      scope: input.scope,
      ...(input.entryKey ? { entryKey: input.entryKey } : {}),
      modelCalls: { gt: 0 },
      createdAt: { gte: monthStart(input.now ?? new Date()) },
    },
  });
}
