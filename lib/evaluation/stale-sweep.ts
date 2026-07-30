// Applies the stale-pending policy (see stale.ts) to the database.
//
// Rather than a background job or a cron — neither of which a small deployment
// should need — the sweep runs opportunistically: whenever evaluations are
// listed or a new one is started, any pending row old enough to be definitively
// dead is marked failed with an explanation.
//
// Scoped by the authenticated user like every other query in this app, so it
// can only ever touch the caller's own rows.
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { STALE_PENDING_MESSAGE, stalePendingCutoff } from "./stale";

/**
 * Mark the current user's abandoned pending evaluations as failed.
 * Returns how many were swept. Safe (and cheap) to call on every page load.
 */
export async function failStalePendingEvaluations(): Promise<number> {
  const userId = await requireUserId();

  const { count } = await prisma.evaluation.updateMany({
    where: {
      profile: { userId },
      status: "pending",
      createdAt: { lt: stalePendingCutoff() },
    },
    data: {
      status: "failed",
      error: STALE_PENDING_MESSAGE,
      completedAt: new Date(),
    },
  });

  return count;
}
