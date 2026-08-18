// Presentational pieces shared by every evaluation shape's detail view.
//
// Extracted from the legacy evaluation page when the Deep Review needed the
// same vocabulary. Sharing them is not tidiness: a "reach" badge that is rose
// on one page and amber on another teaches a student that the two pages mean
// different things by the word, which is the opposite of what this app is for.
//
// Server components — no interactivity lives here.
import type React from "react";

export function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {subtitle && <p className="mb-3 mt-0.5 text-sm text-zinc-500">{subtitle}</p>}
      <div className={subtitle ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

/** A small capsule of state. `tone` comes from the maps below. */
export function Pill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone ?? NEUTRAL_TONE}`}
    >
      {children}
    </span>
  );
}

export const NEUTRAL_TONE =
  "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300";

export const HELPFULNESS_STYLES: Record<string, string> = {
  high: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
  moderate:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  low: "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300",
  negligible:
    "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
};

export const FOUNDATIONAL_LABELS: Record<string, string> = {
  high: "strong foundation",
  moderate: "useful foundation",
  low: "weak foundation",
  none: "nothing to build on",
};

export const CLASSIFICATION_STYLES: Record<string, string> = {
  reach: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  match: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  safety: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
};

/**
 * How selective the model judged each course to be.
 *
 * On a legacy evaluation this sat next to a fit score, because the two only
 * mean something together. A Deep Review has no fit score by design, which
 * makes this the ONLY thing telling a student how high the bar is — so it
 * matters more here, not less.
 */
export const SELECTIVITY_LABELS: Record<string, string> = {
  open: "open admission",
  accessible: "accessible",
  selective: "selective",
  highly_selective: "highly selective",
  extremely_selective: "extremely selective",
};

/**
 * Feasibility of closing a gap, from lib/readiness/pace.
 *
 * TOO_LATE is styled plainly rather than alarmingly. A student is owed the
 * truth that something has closed, but a red badge on a door that shut before
 * they were old enough to reach it is punishment for the calendar.
 */
export const FEASIBILITY_STYLES: Record<string, string> = {
  FEASIBLE:
    "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
  TIGHT: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  TOO_LATE: "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300",
};

export const FEASIBILITY_LABELS: Record<string, string> = {
  FEASIBLE: "there's time",
  TIGHT: "tight on time",
  TOO_LATE: "no longer reachable",
};

/**
 * Trajectory is SLOPE, not level — the level is already in the computed bands.
 * Worded so neither reading is a verdict on the student: "flattening" is a
 * description of the last few months, not of them.
 */
export const DIRECTION_LABELS: Record<string, string> = {
  STEEPENING: "Picking up — recent work is going deeper than earlier work",
  STEADY: "Steady — building at a consistent depth",
  FLATTENING: "Levelling off — recent work is broadly repeating earlier work",
};

export const DIRECTION_STYLES: Record<string, string> = {
  STEEPENING:
    "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
  STEADY: "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300",
  FLATTENING:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
};

/** How long a commitment has, phrased as a date the student can act on. */
export function dueLabel(dueDate: Date | null): string | null {
  if (!dueDate) return null;
  return `due ${dueDate.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}
