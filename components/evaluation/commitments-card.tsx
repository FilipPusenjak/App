// What a review asked of the student, with live status and the controls to
// answer it.
//
// Extracted so one renderer serves both shapes. Commitments used to be produced
// only by the retired Deep Review tier and rendered only inside its body; the
// evaluation now proposes them too, and the rows are the same rows in the same
// table. Two copies of this card would be two places for the wording — and for
// the rule that a proposal is never accepted on the student's behalf — to
// drift apart.
import { CommitmentControls } from "./commitment-controls";
import { Card, Pill, dueLabel } from "./detail-ui";

export type ReviewCommitment = {
  id: string;
  description: string;
  status: string;
  dueDate: Date | null;
};

export function CommitmentsCard({
  commitments,
}: {
  commitments: ReviewCommitment[];
}) {
  if (commitments.length === 0) return null;

  return (
    <Card
      title="What this review asked of you"
      subtitle="Proposed, never accepted on your behalf. A commitment only starts appearing in your check-ins once you take it on."
    >
      <ul className="space-y-3">
        {commitments.map((c) => (
          <li
            key={c.id}
            className="rounded-lg border border-black/10 p-3 dark:border-white/15"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={COMMITMENT_STYLES[c.status]}>
                {COMMITMENT_LABELS[c.status] ?? c.status}
              </Pill>
              {dueLabel(c.dueDate) && (
                <span className="text-xs text-zinc-500">
                  {dueLabel(c.dueDate)}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-sm">{c.description}</p>
            <CommitmentControls id={c.id} status={c.status} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

const COMMITMENT_STYLES: Record<string, string> = {
  PROPOSED: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  ACCEPTED:
    "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
  IN_PROGRESS:
    "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
  COMPLETED: "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300",
  ABANDONED: "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300",
};

const COMMITMENT_LABELS: Record<string, string> = {
  PROPOSED: "proposed",
  ACCEPTED: "you took this on",
  IN_PROGRESS: "in progress",
  COMPLETED: "done",
  // Not "failed". Dropping something deliberately is a legitimate outcome, and
  // the app should not moralise about a student who changed direction.
  ABANDONED: "set aside",
};
