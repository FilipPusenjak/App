// Turning a commitment the student accepted into something in their plan.
//
// PURE — no database. The rule is small but it is the whole bug, so it lives
// somewhere it can be stated once and tested directly.
//
// The bug: "I'll do this" moved a Commitment from PROPOSED to ACCEPTED and
// nothing else. Commitments and PlannedItems are two separate tables — the
// first is "what a review asked of me", the second is "what I intend to do" —
// and accepting never crossed between them. So the student pressed the button,
// went to Plans, and found it empty. Worse than empty: the projection reads
// PlannedItems, so the thing they had just committed to counted for nothing in
// the one feature that exists to say what their plan would be worth.
//
// Confirmed on the deployment before this was written: one student with three
// accepted commitments and zero planned items, and the author with the same.

/** The statuses where the student still intends to do the thing. */
const ACTIVE = new Set(["ACCEPTED", "IN_PROGRESS"]);

/**
 * Should a commitment at this status have a matching item in the plan?
 *
 * The derived item exists exactly while the commitment is live. COMPLETED and
 * ABANDONED both fall out of the plan, for the same reason: neither is still
 * PLANNED. Nothing is lost by that — the Commitment row keeps the history
 * either way, including the abandonment, which is the most honest signal in
 * that table. What would be lost by keeping them is the projection's meaning,
 * since it would go on pricing work the student has already done or dropped.
 */
export function shouldBeInPlan(commitmentStatus: string): boolean {
  return ACTIVE.has(commitmentStatus);
}

/** PlannedItem.title is bounded; a commitment's description is not. */
export const PLAN_TITLE_MAX = 200;

export type DerivedPlannedItem = {
  type: string;
  title: string;
  description: string | null;
  targetDate: Date | null;
};

/**
 * The plan item a commitment becomes.
 *
 * `type` defaults to "project" because a commitment is a thing to be done and
 * carries no category of its own — there is no honest way to infer whether
 * "read three papers on protein folding" is research or coursework. The
 * student can change it on the Plans page, where every other field is editable
 * too; guessing something more specific would just be a guess that looks like
 * a fact.
 *
 * The full description is kept even when the title is cut, so nothing the
 * review actually asked for is lost to a character limit.
 */
export function plannedItemFromCommitment(commitment: {
  description: string;
  dueDate: Date | null;
}): DerivedPlannedItem {
  const text = commitment.description.trim();
  const truncated = text.length > PLAN_TITLE_MAX;

  return {
    type: "project",
    title: truncated ? `${text.slice(0, PLAN_TITLE_MAX - 1).trimEnd()}…` : text,
    description: truncated ? text : null,
    targetDate: commitment.dueDate,
  };
}
