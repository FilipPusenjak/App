// When is an interrupted evaluation presumed dead?
//
// An evaluation is a single long HTTP request: the row is created as "pending",
// the model is called, and the row is updated when the answer arrives. If the
// process dies in between — a serverless function hitting its execution
// ceiling, a dev server restarted, a laptop lid closed — nothing ever comes
// back to update that row, and it sits as "pending" forever. The student sees a
// permanent, unexplained "pending" badge and no way to act on it.
//
// This module holds only the POLICY, deliberately free of database imports so
// the rule can be tested on its own. The sweep that applies it lives in
// stale-sweep.ts.

/**
 * How long a pending row is given before it is presumed dead.
 *
 * Must stay comfortably longer than the route's own execution ceiling
 * (`maxDuration` in app/api/evaluate/route.ts), so the sweep can never kill a
 * run that is still legitimately in progress — only ones whose server is no
 * longer listening. A unit test enforces that margin.
 */
export const STALE_PENDING_MINUTES = 5;

export const STALE_PENDING_MESSAGE =
  "This evaluation was interrupted before it finished — the server stopped " +
  "waiting for the model. Your profile was not changed. Run it again.";

/** True when a pending evaluation started long enough ago to be presumed dead. */
export function isStalePending(
  evaluation: { status: string; createdAt: Date },
  now: Date = new Date(),
): boolean {
  if (evaluation.status !== "pending") return false;
  const ageMs = now.getTime() - evaluation.createdAt.getTime();
  return ageMs > STALE_PENDING_MINUTES * 60 * 1000;
}

/** The cutoff instant: pending rows created before this are presumed dead. */
export function stalePendingCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - STALE_PENDING_MINUTES * 60 * 1000);
}
