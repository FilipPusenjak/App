// A run that is happening right now, and how long it is allowed to be.
//
// PURE — no database, no React. Both the server (reading a pending row) and
// the browser (holding a fetch that has not settled) describe an in-flight run
// with this shape, so the banner does not care which one it came from.
//
// This exists because "a run is happening" used to live in useState inside the
// button that started it. Navigating away unmounted that button, and with it
// the only evidence anything was happening: the student was left on a page
// with no indication that the minute-long thing they just paid for was still
// going. Some of them will conclude it did not start and press it again.

export type RunKind = "DEEP_REVIEW" | "CHECK_IN" | "PROJECTION";

/** What a run is called, in the words the rest of the app already uses. */
export const RUN_LABELS: Record<RunKind, string> = {
  DEEP_REVIEW: "Deep Review",
  CHECK_IN: "Check-In",
  PROJECTION: "Projection",
};

/**
 * How long each kind may run before we stop claiming it is still going.
 *
 * These are the routes' own `maxDuration` ceilings — 300s for a Deep Review
 * and a projection, 120s for a check-in — plus a small margin for the request
 * and the write that follows it.
 *
 * The margin is what makes this safe to read from a database row. A serverless
 * function that dies mid-run leaves its row `pending` forever, and nothing
 * comes along later to correct it. Without a ceiling, one crashed run would
 * pin a "still working…" banner to every page of that student's account
 * permanently, and the only thing more corrosive than losing the indicator is
 * one that lies.
 */
export const RUN_TIMEOUT_SECONDS: Record<RunKind, number> = {
  DEEP_REVIEW: 330,
  CHECK_IN: 150,
  PROJECTION: 330,
};

export type InFlightRun = {
  kind: RunKind;
  /** When the run began — the row's createdAt, or the moment fetch was called. */
  startedAt: number;
};

/**
 * Has this run been going longer than its route could possibly allow?
 *
 * True means "stop showing this", not "it failed" — we genuinely do not know
 * which, and the run's own row is the place that answers it.
 */
export function isStale(run: InFlightRun, now: number = Date.now()): boolean {
  return now - run.startedAt > RUN_TIMEOUT_SECONDS[run.kind] * 1000;
}

/** The banner's line while a run is going. */
export function runningLabel(kind: RunKind): string {
  // A check-in is the cheap tier and usually the quick one; the other two are
  // the ones worth warning somebody about before they wonder if it hung.
  return kind === "CHECK_IN"
    ? "Checking in…"
    : `Running your ${RUN_LABELS[kind]}… this can take a minute.`;
}

/** Where the finished run can be read. */
export function resultHref(kind: RunKind, id: string): string {
  return kind === "PROJECTION" ? `/projections/${id}` : `/evaluations/${id}`;
}
