// Evaluation prompt — version 11.
//
// v11 adds proposed commitments to the evaluation, because the evaluation is
// now the only thing that runs. The retired Deep Review tier was the sole
// producer of Commitment rows, and without a replacement the accept/decline
// controls would have gone permanently empty and the fortnightly check-in
// would have had nothing to follow up on — the loop would still have been
// there, with nothing moving through it.
//
// No score definition changes. See versions.ts, where v11 redefines nothing:
// a student's numbers must not move because the output grew a field.
//
// COMPOSED FROM v10 RATHER THAN COPIED, which breaks this directory's usual
// one-file-per-version convention on purpose. The versions are standalone so
// that attribution stays exact — an evaluation records the prompt that produced
// it, and reading that file should show what the model was actually told. That
// argument holds for a version that changes JUDGEMENT. This one changes only
// the output contract, and copying three hundred lines of calibration text to
// append one section would leave two copies of the most carefully tuned prose
// in the app, free to drift the first time either is edited. The composition is
// explicit and the appended section is right here, so the attribution property
// survives: v11 is v10 plus what follows.
import { RUNGS } from "@/lib/readiness/rungs";
import {
  SYSTEM_PROMPT as V10_SYSTEM_PROMPT,
  buildUserPromptParts as buildV10Parts,
} from "./v10";
import type { EvaluationSnapshot } from "@/lib/evaluation/snapshot";
import type { SnapshotDiff } from "@/lib/evaluation/diff";
import { NO_REUSE, type ItemReuse } from "@/lib/evaluation/item-reuse";
import type { ResolvedRequirement } from "@/lib/requirements/lookup";

export { buildUserPrompt } from "./v10";

/** What the student wrote about their own fortnight, in their words. */
export type ReportedDevelopment = { body: string; createdAt: Date };

export const PROMPT_VERSION = "evaluation/v11";

const rungList = RUNGS.map((r) => `"${r}"`).join(" | ");

/**
 * The commitments section, appended to v10's system prompt.
 *
 * The hard part is not asking for commitments — it is stopping the model from
 * re-emitting the action list under a second name. An action is advice the
 * student reads; a commitment is a row with a status and a due date that a
 * later check-in asks about BY NAME, and that the student had to say yes to.
 * If those come back identical the follow-through loop tracks advice nobody
 * agreed to, which is where it started.
 */
const COMMITMENTS_SECTION = `

## Proposed commitments

Propose 2-4 things the student could commit to. These are NOT a restatement of
your action list, and a commitment that reads like an action has failed.

The difference is what happens next. An action is advice: they read it, and
nothing follows. A commitment becomes a tracked item with a due date that gets
put in front of them again in a fortnight and asked about by name. So:

- **Checkable by someone else.** "Work on the simulation" cannot be verified.
  "Send the simulation write-up to one teacher for feedback" can.
- **One step, not a programme.** If it cannot be finished in the window you
  give it, it is a plan and belongs in actions instead.
- **Startable now, at this student's stage.** Never propose something gated
  behind years of prerequisites — the same rule that governs actions.
- **Their own work, not someone else's decision.** "Get accepted to the
  programme" is an outcome they do not control. "Submit the application before
  the March deadline" is theirs.

\`dueInWeeks\` is a whole number of weeks from today, and the server turns it
into a real date — do not write a date yourself. Choose it honestly: long
enough to be possible around schoolwork, short enough that the next check-in or
two can tell whether it happened.

\`targetRung\` is the rung this commitment is meant to reach, when it is about
one activity. Use exactly one of these strings, or \`null\` when the commitment
is not about climbing a single activity:

${rungList}

Never a human-readable label — \`null\` means \`null\`, not \`"none"\` or \`""\`.
This value is checked after you answer, and a wrong one discards your entire
response rather than the field.

**Propose, never assume.** The student accepts or declines each of these. Write
them as things they could take on, not as things they have agreed to or as
instructions. Nobody has said yes yet.

**Do not re-propose what they already took on.** When the context lists
commitments they have accepted, those are live and being tracked already.
Proposing one again asks them to agree to something they agreed to weeks ago,
and it then appears twice everywhere. If an accepted commitment is still the
right thing and has not happened, say so in your assessment — that is a finding
about follow-through, and it is more useful than a duplicate row.`;

export const SYSTEM_PROMPT = V10_SYSTEM_PROMPT + COMMITMENTS_SECTION;

/** A commitment the student still has in front of them. */
export type OpenCommitmentLine = {
  description: string;
  status: string;
  dueDate: Date | null;
};

/**
 * The two things v11 adds to v10's context, both about the student's own
 * follow-through rather than their profile.
 *
 * An options object rather than two more positional parameters: five was
 * already at the edge, and `(snapshot, null, undefined, [], [], [])` at a call
 * site is a bug waiting to be written.
 */
export type EvaluationExtras = {
  /** What the student wrote, since their last REVIEW — not since a check-in. */
  developments?: ReportedDevelopment[];
  /** What is already outstanding, so the review does not re-propose it. */
  openCommitments?: OpenCommitmentLine[];
};

/**
 * v10's prompt, plus what the student said and what they are already on the
 * hook for.
 *
 * DEVELOPMENTS used to be read by the retired tier and by check-ins. Losing the
 * tier must not lose the reading: a student who writes "the club folded, so the
 * workshop could not happen" and is then handed a review that judges the
 * abandoned commitment in silence has been ignored by the one feature built to
 * listen to them.
 *
 * OPEN COMMITMENTS are here because this review proposes more of them. A review
 * that cannot see what the student already accepted proposes it again, and the
 * accept/decline loop fills with duplicates of itself — the failure that shows
 * up on the second review, not the first.
 *
 * Both are appended to `variable`, never to `stable`. The split exists for
 * prompt caching, which is a PREFIX match: putting the most volatile text in
 * the app behind the cache breakpoint would invalidate the rubrics on every run
 * and turn a saving into a surcharge.
 */
export function buildUserPromptParts(
  snapshot: EvaluationSnapshot,
  diff: SnapshotDiff | null = null,
  reuse: ItemReuse = NO_REUSE,
  requirements: ResolvedRequirement[] = [],
  extras: EvaluationExtras = {},
): { stable: string; variable: string } {
  const parts = buildV10Parts(snapshot, diff, reuse, requirements);
  const developments = extras.developments ?? [];
  const openCommitments = extras.openCommitments ?? [];

  // No heading when there is nothing under it — an empty section is an
  // invitation to invent something to put in it.
  let variable = parts.variable;

  if (openCommitments.length > 0) {
    const lines = openCommitments
      .map((c) => {
        const due = c.dueDate
          ? ` (due ${c.dueDate.toISOString().slice(0, 10)})`
          : "";
        return `- ${c.description} — ${c.status}${due}`;
      })
      .join("\n");

    variable += `

# Commitments already open

What this student has been asked to do, and whether they took it on. PROPOSED
means the last review suggested it and they have not answered. ACCEPTED and
IN_PROGRESS mean they said yes and it is being tracked.

Do not propose an ACCEPTED or IN_PROGRESS item again. If one of them has not
happened and still should, that belongs in your assessment as a finding about
follow-through — not in proposedCommitments as a duplicate.

${lines}`;
  }

  if (developments.length > 0) {
    const reported = developments
      .map((d) => `- ${d.createdAt.toISOString().slice(0, 10)}: ${d.body}`)
      .join("\n");

    variable += `

# What the student reported since their last review

Their words, unedited, and the only part of this context they wrote themselves.
Everything else here is something the app computed about them. Read these before
judging anything they explain — an activity that stopped for a reason the
student gave you is a different fact from one that stopped in silence.

${reported}`;
  }

  return { stable: parts.stable, variable };
}
