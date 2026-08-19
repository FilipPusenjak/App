// One line of history, for an evaluation in any shape.
//
// The history list is the one screen that shows every run a student has ever
// done, side by side. That makes it the place where flattening is most
// tempting and most wrong: a legacy run carries a percentile, a deep review
// carries two bands, a check-in carries neither, and the list has to stay
// readable without pretending they are the same measurement.
//
// So each row states its own instrument. A percentile row shows "72/100"; a
// deep review shows its bands as words; a check-in shows that it was a
// fortnightly delta. Nothing is converted into anything else, and no row is
// silently reduced to the bare status string "completed", which is what the
// list did before it understood more than one shape.
import {
  readStoredEvaluation,
  headlineOf,
  type StoredShape,
} from "@/lib/evaluation/stored-shape";

export type HistoryEntry = {
  /** "Deep Review", "Check-In", or "Evaluation". */
  tier: string;
  /** The pill: a percentile, a band, or a run state. */
  badge: string;
  /**
   * Whether the badge is a 0-100 score, so the caller can tone it by value.
   * Bands are deliberately NOT toned: "emerging" is early, not bad, and
   * colouring it red would tell a ninth-grader they are failing at having
   * started.
   */
  badgeIsScore: boolean;
  /** Secondary bands or context, already worded for a student. */
  detail: string | null;
  headline: string | null;
};

type Row = {
  status: string;
  isSample: boolean;
  overallScore: number | null;
  resultJson: string | null;
  promptVersion: string | null;
  type?: string | null;
  thresholdSnapshotJson?: string | null;
  differentiationSnapshotJson?: string | null;
  materialChange?: boolean | null;
};

export function summariseHistoryRow(row: Row): HistoryEntry {
  const shape = readStoredEvaluation(row);
  const tier = tierLabel(row, shape);
  const headline = headlineOf(shape);

  if (row.status === "pending") {
    return { tier, badge: "Running…", badgeIsScore: false, detail: null, headline: null };
  }
  if (row.status === "failed") {
    return { tier, badge: "Failed", badgeIsScore: false, detail: null, headline: null };
  }

  // Checked BEFORE the shape, because a no-change check-in has no resultJson at
  // all — the route deliberately writes the row with no narrative, no model and
  // no cost. Dispatching on the parsed shape first would send it down the
  // "unrecognised" path and label a deliberate, successful, free run with the
  // bare word "completed".
  if (row.materialChange === false) {
    return {
      tier,
      badge: "No material change",
      badgeIsScore: false,
      detail: "Nothing moved enough to be worth a write-up.",
      headline: null,
    };
  }

  if (shape.kind === "legacy") {
    const score = row.overallScore ?? shape.result.overallScore;
    return score != null
      ? { tier, badge: `${score}/100`, badgeIsScore: true, detail: null, headline }
      : { tier, badge: tier, badgeIsScore: false, detail: null, headline };
  }

  if (shape.kind === "deep-review") {
    const threshold = bandOf(row.thresholdSnapshotJson ?? null);
    const differentiation = bandOf(row.differentiationSnapshotJson ?? null);
    return {
      tier,
      badge: threshold ? `Requirements: ${threshold}` : tier,
      badgeIsScore: false,
      detail: differentiation ? `Differentiation: ${differentiation}` : null,
      headline,
    };
  }

  if (shape.kind === "check-in") {
    return {
      tier,
      badge: tier,
      badgeIsScore: false,
      detail: "A fortnight's change, not a full standing.",
      headline,
    };
  }

  return { tier, badge: row.status, badgeIsScore: false, detail: null, headline: null };
}

/**
 * What the percentile evaluation is called. It is the only review that runs.
 *
 * The name moved rather than the thing: "Deep Review" used to mean a separate
 * band-based tier, which has been retired. Everything a student runs today is
 * this.
 */
export const REVIEW_LABEL = "Deep Review";

/**
 * What the retired tier's rows are called.
 *
 * They cannot simply be called "Deep Review" as well. A handful of rows exist
 * in the old band shape, and a student opening one would find no percentile
 * anywhere in a document sharing its name with the scored review they ran last
 * week — so the name says which it is. It is not called "old" or "legacy",
 * because neither tells them anything about what they are about to read.
 */
export const RETIRED_REVIEW_LABEL = "Deep Review (earlier format)";

/**
 * What to call this run.
 *
 * The order here is load-bearing, and getting it wrong is exactly the mistake
 * this file exists to prevent.
 *
 * `type` looks like the authority and is not, because its column DEFAULTS to
 * "DEEP_REVIEW". That default was chosen so pre-tier rows would not be
 * mislabelled as check-ins, but it means every row of every kind carries it,
 * and reading it first has caused two separate faults already — a mislabelled
 * history and a 21-day lockout measured against a review that never ran.
 *
 * `promptVersion` is the honest discriminator. It records the prompt that
 * actually produced the row, it is never defaulted, and it survives a narrative
 * that will not parse — which is the case `type` was reached for in the first
 * place.
 */
export function tierLabel(
  row: { type?: string | null; promptVersion?: string | null },
  shape: StoredShape,
): string {
  // 1. What produced it. Never defaulted, so never lies.
  const version = row.promptVersion ?? "";
  if (version.startsWith("deep-review/")) return RETIRED_REVIEW_LABEL;
  if (version.startsWith("check-in/")) return "Check-In";
  if (version.startsWith("evaluation/")) return REVIEW_LABEL;

  // 2. What it parsed as. Only reached for rows written before promptVersion
  //    was recorded at all.
  if (shape.kind === "deep-review") return RETIRED_REVIEW_LABEL;
  if (shape.kind === "check-in") return "Check-In";
  if (shape.kind === "legacy") return REVIEW_LABEL;

  // 3. The column, last — it is the only thing left for a row whose narrative
  //    is unreadable. Its default finally agrees with reality now that the
  //    evaluation is the Deep Review, but it is still consulted last: a row
  //    that genuinely came from the retired tier is indistinguishable here, and
  //    guessing the commoner of the two is the best that can be done blind.
  if (row.type === "CHECK_IN") return "Check-In";
  return REVIEW_LABEL;
}

function bandOf(json: string | null): string | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { band?: unknown };
    return typeof parsed.band === "string" ? parsed.band : null;
  } catch {
    return null;
  }
}
