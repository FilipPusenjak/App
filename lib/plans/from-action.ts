// Turning an evaluation's recommended action into a plan.
//
// The app produces a ranked list of things worth doing, and separately tracks
// things the student intends to do and projects what they would be worth. Those
// were never connected: the student read "Enter the Senior Maths Challenge in
// October" and then retyped it into the plan form by hand, which nobody does.
// So the most valuable output of an evaluation mostly evaporated.
//
// This is the join. Pure — no Prisma, no session — because the two decisions
// worth arguing about are what carries across and what does NOT.

/** The subset of an evaluation action this needs. */
export type ActionLike = {
  title: string;
  detail: string;
  timeframe: string;
};

/**
 * Query parameters that prefill the plan form.
 *
 * Prefill-and-confirm rather than one-click-create, deliberately. A plan feeds
 * projections, and a projection is only worth anything if the target date and
 * commitment are real. Creating a row silently with neither would manufacture
 * weak plan entries the student never chose — and the one thing that genuinely
 * cannot be carried over is the date: `timeframe` is prose ("This term", "Next
 * 3 months"), and turning that into a calendar date is a guess about the
 * student's year that this app has no business making.
 *
 * So the timeframe travels as CONTEXT next to the date field, and the student
 * picks the date. What the model actually said is preserved; what it did not
 * say is not invented.
 */
export function planDraftParams(action: ActionLike): URLSearchParams {
  const params = new URLSearchParams();
  params.set("title", action.title);
  if (action.detail) params.set("description", action.detail);
  if (action.timeframe) params.set("timeframe", action.timeframe);
  return params;
}

/**
 * Where to send somebody after they save a plan drafted from an evaluation.
 *
 * An ID, never a path. This value makes a round trip through a URL and a form
 * field before something redirects to it, which is the exact shape of an open
 * redirect — so what travels is the id alone, the path is built server-side in
 * createPlanAction, and anything that is not a plausible id is ignored rather
 * than followed. A caller cannot express an off-site destination here.
 */
const ID = /^[a-z0-9]{20,32}$/i;

export function isEvaluationId(value: string | undefined): boolean {
  return typeof value === "string" && ID.test(value);
}

/** The href for "add this action to my plan". */
export function planDraftHref(
  action: ActionLike,
  /**
   * The evaluation being read. Carried so saving returns here rather than
   * dropping the student on /plans — they were mid-way through a list of
   * recommended actions, and losing their place means the second action never
   * gets added.
   */
  fromEvaluationId?: string,
): string {
  const params = planDraftParams(action);
  if (isEvaluationId(fromEvaluationId)) params.set("from", fromEvaluationId!);
  return `/plans/new?${params.toString()}`;
}

/**
 * A title reduced for comparison, so an action can be recognised in the plan.
 *
 * Matching on the title is a heuristic and is treated as one: it decides
 * whether a button reads "Add to my plan" or "In your plan", and nothing else.
 * Being wrong costs a student one duplicate row they can delete, which is why
 * the comparison is loose enough to survive the small edits people make when
 * confirming a form — case, punctuation, trailing whitespace — rather than
 * demanding the string come back byte-identical.
 */
export function comparableTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

/** Which of these actions the student has already put in their plan. */
export function plannedActionTitles(
  actions: ActionLike[],
  planTitles: string[],
): Set<string> {
  const planned = new Set(planTitles.map(comparableTitle));
  const out = new Set<string>();
  for (const action of actions) {
    if (planned.has(comparableTitle(action.title))) out.add(action.title);
  }
  return out;
}
