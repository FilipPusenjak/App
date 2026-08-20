// Reading and writing commitments around a review.
//
// The follow-through loop only works if a review both READS what is already
// outstanding and RETIRES what it replaces. Without the first, it re-proposes
// work the student is already doing. Without the second, every review adds two
// to four more rows that nothing ever clears, and by the third review "do this
// next" is a graveyard of proposals nobody answered sitting beside their own
// near-duplicates.
//
// Ownership: every function here takes a profileId that the caller has already
// resolved from the session through lib/ownership. Nothing here accepts an id
// from a request.
import { prisma } from "@/lib/db";
import { commitmentsToWrite } from "./text";

/** Statuses that mean the student still has this in front of them. */
export const OPEN_STATUSES = ["PROPOSED", "ACCEPTED", "IN_PROGRESS"] as const;

export type OpenCommitment = {
  id: string;
  description: string;
  status: string;
  dueDate: Date | null;
};

/**
 * What is outstanding right now, most pressing first.
 *
 * Ordered by due date with undated last, so a bounded read keeps the things
 * with deadlines rather than whichever happened to be created first.
 */
export async function loadOpenCommitments(
  profileId: string,
  take?: number,
): Promise<OpenCommitment[]> {
  return prisma.commitment.findMany({
    where: { profileId, status: { in: [...OPEN_STATUSES] } },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    ...(take ? { take } : {}),
    select: { id: true, description: true, status: true, dueDate: true },
  });
}

/**
 * Retire the proposals a new review replaces, then write its own.
 *
 * Two rules, and the difference between them is who decided:
 *
 *   A PROPOSAL THE STUDENT NEVER ANSWERED is superseded. It was this app's
 *   suggestion, it has been overtaken by a newer read of the same profile, and
 *   leaving it open would have the student answering advice the app no longer
 *   gives.
 *
 *   ANYTHING THEY ACCEPTED SURVIVES UNTOUCHED. They said yes to it. A new
 *   review does not get to cancel a commitment on their behalf, and the whole
 *   point of the check-in is to keep asking about exactly these.
 *
 * Returns how many rows each half touched, so a caller can log or test it
 * without re-querying.
 */
export async function recordProposedCommitments(input: {
  profileId: string;
  evaluationId: string;
  proposals: {
    description: string;
    targetRung: string | null;
    dueInWeeks: number;
  }[];
  /** Injected so a test does not depend on the wall clock. */
  now?: Date;
}): Promise<{ superseded: number; created: number }> {
  const now = input.now ?? new Date();

  // Scoped to OTHER evaluations: this review's own rows are written below and
  // must not retire each other. Without that clause a re-run of this function
  // would supersede everything it had just created.
  const { count: superseded } = await prisma.commitment.updateMany({
    where: {
      profileId: input.profileId,
      status: "PROPOSED",
      NOT: { sourceEvaluationId: input.evaluationId },
    },
    data: {
      status: "SUPERSEDED",
      resolvedAt: now,
      resolvedInEvaluationId: input.evaluationId,
    },
  });

  // Read AFTER superseding, and read EVERYTHING still open rather than only
  // what the student accepted. The ordering makes the two equivalent for
  // earlier reviews — their proposals were just retired above, so they cannot
  // block their own replacement — while also covering the case that made this
  // function non-idempotent: rows this same evaluation already wrote.
  //
  // Without that, a retry reaching this code twice wrote every proposal a
  // second time. They are exempt from superseding by design (a review must not
  // retire what it just created), which left them invisible to a comparison
  // that only looked at accepted work.
  const stillOpen = await prisma.commitment.findMany({
    where: { profileId: input.profileId, status: { in: [...OPEN_STATUSES] } },
    select: { description: true },
  });

  const toWrite = commitmentsToWrite(input.proposals, stillOpen);
  if (toWrite.length === 0) return { superseded, created: 0 };

  // dueInWeeks becomes a date HERE rather than in the model's output, so every
  // due date is measured from the moment the review completed instead of from
  // whenever the model believed "today" to be.
  const { count: created } = await prisma.commitment.createMany({
    data: toWrite.map((c) => ({
      profileId: input.profileId,
      sourceEvaluationId: input.evaluationId,
      description: c.description,
      targetRung: c.targetRung,
      dueDate: new Date(now.getTime() + c.dueInWeeks * 7 * 86_400_000),
      status: "PROPOSED",
    })),
  });

  return { superseded, created };
}
