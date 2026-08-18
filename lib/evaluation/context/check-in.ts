// The context a check-in gets: the delta, and almost nothing else.
//
// A check-in answers "am I doing the right thing right now?" — a question about
// the last two weeks. It does not need four years of history to answer it, and
// giving it four years would make it a worse deep review at check-in prices.
//
// Budget: 4k tokens. Held by three decisions, in order of how much they save:
//
//   1. Completed grade years arrive as a ProfileDigest, never as raw entries.
//      This is what keeps a senior's check-in costing about what a freshman's
//      does, across a four-year flat subscription.
//   2. Target schools arrive as computed gap deltas, not researched records.
//      A full requirements record is ~600 tokens; the delta is ~150.
//   3. Only what CHANGED since the preceding check-in is described in full.
//
// SHARES NO CODE PATH with the deep-review builder beyond lib/readiness. That
// is deliberate: the moment they share assembly, the cheap tier starts
// receiving the expensive tier's context and the price difference stops being
// honest.
import type { ScoredProfile } from "@/lib/readiness/score";
import type { ProfileDigestSummary } from "../digest";
import { renderDigest } from "../digest";
import { RUNG_LABELS } from "@/lib/readiness/rungs";

export type CheckInChange = {
  kind: "added" | "edited" | "removed";
  what: string;
  detail?: string;
};

export type OpenCommitment = {
  id: string;
  description: string;
  status: string;
  dueDate: Date | null;
};

export type CheckInContextInput = {
  scored: ScoredProfile;
  /** Everything that moved since the preceding check-in. */
  changes: CheckInChange[];
  openCommitments: OpenCommitment[];
  /** One per completed grade year. Replaces those years' raw entries. */
  digests: ProfileDigestSummary[];
  precedingAt: Date | null;
  now?: Date;
};

export type BuiltContext = {
  text: string;
  estimatedTokens: number;
};

const TOKEN_BUDGET = 4000;

export function buildCheckInContext(input: CheckInContextInput): BuiltContext {
  const now = input.now ?? new Date();
  const lines: string[] = [];
  const s = input.scored;

  lines.push(`Today: ${now.toISOString().slice(0, 10)}`);
  lines.push(
    input.precedingAt
      ? `Last check-in: ${input.precedingAt.toISOString().slice(0, 10)}`
      : `No previous check-in — this is the first.`,
  );
  lines.push(
    `Grade: ${s.gradeLevel ?? "not stated"}${
      s.monthsUntilApplication != null
        ? ` · about ${s.monthsUntilApplication} months until applications`
        : ""
    }`,
  );

  // ── Current standing, already computed ────────────────────────────────────
  // Bands, not numbers, and two of them rather than one. The model interprets
  // these; it is never asked to work them out.
  lines.push("");
  lines.push("## Standing (computed — do not recalculate)");
  lines.push(`- Requirements: ${s.thresholdBand}`);
  lines.push(`- Differentiation: ${s.differentiation.band}`);
  lines.push(
    `- Pace for grade: ${s.pace.unknownGrade ? "no grade given, so no comparison" : s.pace.status}`,
  );

  // ── What changed ──────────────────────────────────────────────────────────
  lines.push("");
  lines.push("## Changed since last check-in");
  if (input.changes.length === 0) {
    lines.push("- Nothing.");
  } else {
    for (const c of input.changes) {
      lines.push(`- ${c.kind}: ${c.what}${c.detail ? ` — ${c.detail}` : ""}`);
    }
  }

  if (s.differentiation.escalations.length > 0) {
    lines.push("");
    lines.push("## Moved up a rung");
    for (const e of s.differentiation.escalations) {
      lines.push(`- ${e.title}: ${e.from} → ${e.to}`);
    }
  }

  // ── Commitments, first-class ──────────────────────────────────────────────
  // The follow-through loop lives at this cadence, not in the deep review.
  lines.push("");
  lines.push("## Open commitments");
  if (input.openCommitments.length === 0) {
    lines.push("- None open.");
  } else {
    for (const c of input.openCommitments) {
      const due = c.dueDate
        ? ` (due ${c.dueDate.toISOString().slice(0, 10)}${c.dueDate < now ? ", OVERDUE" : ""})`
        : "";
      lines.push(`- [${c.id}] ${c.description} — ${c.status}${due}`);
    }
  }

  // ── Current threads, one line each ────────────────────────────────────────
  lines.push("");
  lines.push("## Current activities (rung in brackets)");
  if (s.differentiation.activities.length === 0) {
    lines.push("- None recorded.");
  } else {
    for (const a of s.differentiation.activities) {
      lines.push(
        `- [${a.id}] ${a.title} — ${a.rung} (${RUNG_LABELS[a.rung]})${
          a.months != null ? `, ${a.months}mo` : ""
        }`,
      );
    }
  }

  // ── Targets as deltas, never as records ───────────────────────────────────
  lines.push("");
  lines.push("## Target gaps (computed)");
  if (s.threshold.noDataForAnyTarget) {
    lines.push(
      "- No researched requirements for these targets, so nothing has been checked. Say that rather than implying nothing is required.",
    );
  } else {
    for (const school of s.threshold.schools) {
      const unmet = school.components.filter((c) => c.state === "UNMET");
      const unknown = school.components.filter((c) => c.state === "UNKNOWN");
      lines.push(
        `- ${school.school} — ${school.course}: ${school.met} met` +
          (unmet.length > 0
            ? `, unmet: ${unmet.map((c) => c.label).join(", ")}`
            : "") +
          (unknown.length > 0 ? `, not checked: ${unknown.length}` : ""),
      );
    }
  }

  // ── Prior years, compacted ────────────────────────────────────────────────
  if (input.digests.length > 0) {
    lines.push("");
    lines.push("## Earlier years (summarised)");
    for (const d of [...input.digests].sort((a, b) => a.throughGrade - b.throughGrade)) {
      lines.push(renderDigest(d));
    }
  }

  const text = lines.join("\n");
  return { text, estimatedTokens: Math.ceil(text.length / 4) };
}

export const CHECK_IN_TOKEN_BUDGET = TOKEN_BUDGET;
