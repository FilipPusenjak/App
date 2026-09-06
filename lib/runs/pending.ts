// Is a run already going for this student, according to the database?
//
// Split from in-flight.ts on the same lines as every other pair in this
// codebase: the rules there are worth testing without Prisma in the room, and
// this is the one query that feeds them.
//
// The point of asking the SERVER rather than trusting the browser is that the
// browser forgets. A reload, a second tab, picking the phone up after starting
// a review on a laptop — in all three the fetch that knew about the run is
// gone, but the run is not: it is a serverless function still working, and its
// row has said `pending` since before the model was called.
//
// A check-in is deliberately absent here, and it is not an oversight. That
// route writes its row at the END rather than the start, so there is no
// pending row to find while one is in flight — see the note in
// app/(app)/run-progress.tsx about what that costs.
import { prisma } from "@/lib/db";
import { getOrCreateProfile } from "@/lib/ownership";
import { isStale, type InFlightRun, type RunKind } from "./in-flight";

/**
 * The run currently going for the active student, or null.
 *
 * Ordered newest-first and taken one at a time per kind: a crashed run from
 * last week is still `pending` in the table forever, and the freshest row is
 * the only one that could plausibly still be running. isStale then discards
 * even that when it has outlived what its route could have allowed.
 */
export async function findInFlightRun(): Promise<InFlightRun | null> {
  const profile = await getOrCreateProfile();

  const [evaluation, projection] = await Promise.all([
    prisma.evaluation.findFirst({
      where: { profileId: profile.id, status: "pending" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, type: true },
    }),
    prisma.projection.findFirst({
      where: { profileId: profile.id, status: "pending" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  const candidates: InFlightRun[] = [];
  if (evaluation) {
    candidates.push({
      // The column is a free String, so anything unexpected is read as the
      // full review — the longer timeout and the more cautious label.
      kind: evaluation.type === "CHECK_IN" ? "CHECK_IN" : "DEEP_REVIEW",
      startedAt: evaluation.createdAt.getTime(),
    });
  }
  if (projection) {
    candidates.push({
      kind: "PROJECTION" as RunKind,
      startedAt: projection.createdAt.getTime(),
    });
  }

  const live = candidates.filter((run) => !isStale(run));
  live.sort((a, b) => b.startedAt - a.startedAt);
  return live[0] ?? null;
}
