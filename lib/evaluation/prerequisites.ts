// What a profile still needs before it can be evaluated at all.
//
// PURE — no database, no session. The counts come from whoever already has
// the profile loaded, which on both surfaces is somebody who loaded it for
// another reason anyway.
//
// This exists because the rule was written inline on the Evaluations page and
// nowhere else, so the only way to discover it was to press the button and
// read the greyed-out sentence underneath. Of sixteen profiles on the
// deployment when this was written, six could not run anything — and the most
// telling group was the three who had added a target school and then stopped,
// which is somebody who arrived with real intent and was never told what the
// remaining step was. A rule that decides whether the product's main feature
// is reachable belongs somewhere both surfaces can ask.
//
// The two requirements are not arbitrary and are worth stating in the terms
// the model actually needs:
//
//   A TARGET, because the rubric is chosen by where you are applying. A US
//   and a UK target are judged by different admissions systems, and with no
//   target there is no system to judge against — not a weaker evaluation, no
//   evaluation.
//
//   SOMETHING TO ASSESS, because an evaluation of an empty profile is a
//   sentence about nothing. One activity or one test score is enough to
//   start; the assessment gets better as the profile does.

export type ProfileCounts = {
  targets: number;
  resumeItems: number;
  testScores: number;
};

export type FirstRunStep = {
  id: "targets" | "content";
  /** Imperative, and the same words on every surface that shows it. */
  label: string;
  /** WHY it is needed, not a restatement of the label. */
  detail: string;
  href: string;
  done: boolean;
};

/** Anything to judge: one activity or one score. Not both. */
function hasContent(counts: ProfileCounts): boolean {
  return counts.resumeItems > 0 || counts.testScores > 0;
}

/**
 * Both steps, always both, each marked done or not.
 *
 * Deliberately not "the next missing one". Somebody deciding whether to spend
 * ten minutes on this needs to see the whole distance, and a list that reveals
 * a second requirement only after the first is met reads as moving goalposts.
 */
export function firstRunSteps(counts: ProfileCounts): FirstRunStep[] {
  return [
    {
      id: "targets",
      label: "Add a university you're aiming at",
      detail:
        "The rubric depends on where you're applying — a US and a UK target are judged by different systems.",
      href: "/targets",
      done: counts.targets > 0,
    },
    {
      id: "content",
      label: "Add an activity or a test score",
      detail:
        "One is enough to start. There's nothing to assess on an empty profile.",
      href: "/profile",
      done: hasContent(counts),
    },
  ];
}

/** Is this profile evaluable at all? */
export function canRunEvaluation(counts: ProfileCounts): boolean {
  return counts.targets > 0 && hasContent(counts);
}

/**
 * The one-line version, for a disabled button's own explanation.
 *
 * Targets are reported first when both are missing, matching the order of
 * firstRunSteps — the two surfaces must not disagree about which thing to do
 * next. Undefined when the profile is ready, so a caller can pass it straight
 * to a `disabled` prop.
 */
export function blockingReason(counts: ProfileCounts): string | undefined {
  if (counts.targets === 0) {
    return "Add a target school first — the rubric depends on where you're applying.";
  }
  if (!hasContent(counts)) {
    return "Add resume items or test scores first — there's nothing to assess yet.";
  }
  return undefined;
}
