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
instructions. Nobody has said yes yet.`;

export const SYSTEM_PROMPT = V10_SYSTEM_PROMPT + COMMITMENTS_SECTION;

/**
 * v10's prompt, plus what the student reported since their last review.
 *
 * Developments used to be read by the retired tier and by check-ins. Losing the
 * tier must not lose the reading: a student who writes "the club folded, so the
 * workshop could not happen" and is then handed a review that judges the
 * abandoned commitment in silence has been ignored by the one feature built to
 * listen to them.
 *
 * Appended to `variable`, never to `stable`. The split exists for prompt
 * caching, which is a PREFIX match — putting the most volatile text in the app
 * behind the cache breakpoint would invalidate the rubrics on every run and
 * turn a saving into a surcharge.
 */
export function buildUserPromptParts(
  snapshot: EvaluationSnapshot,
  diff: SnapshotDiff | null = null,
  reuse: ItemReuse = NO_REUSE,
  requirements: ResolvedRequirement[] = [],
  developments: ReportedDevelopment[] = [],
): { stable: string; variable: string } {
  const parts = buildV10Parts(snapshot, diff, reuse, requirements);
  // No heading when there is nothing under it — an empty section is an
  // invitation to invent something to put in it.
  if (developments.length === 0) return parts;

  const reported = developments
    .map((d) => `- ${d.createdAt.toISOString().slice(0, 10)}: ${d.body}`)
    .join("\n");

  return {
    stable: parts.stable,
    variable: `${parts.variable}

# What the student reported since their last review

Their words, unedited, and the only part of this context they wrote themselves.
Everything else here is something the app computed about them. Read these before
judging anything they explain — an activity that stopped for a reason the
student gave you is a different fact from one that stopped in silence.

${reported}`,
  };
}
