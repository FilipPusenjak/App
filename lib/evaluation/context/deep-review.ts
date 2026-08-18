// The context a deep review gets: everything, because the question is different.
//
// A deep review answers "is my overall strategy right?" — which cannot be
// answered from a delta. It needs the shape of the whole profile over years:
// what escalated, what stalled, what was started and dropped, and whether any
// of it argues for the major the student says they want.
//
// Budget: 12k tokens. Three times the check-in, and that is the honest reason
// it costs more — not a gate.
//
// SHARES NO CODE PATH with the check-in builder beyond lib/readiness.
import type { ScoredProfile } from "@/lib/readiness/score";
import { RUNG_LABELS } from "@/lib/readiness/rungs";

export type PriorReview = {
  createdAt: Date;
  /** The stored narrative's headline only — never the full document. */
  headline: string;
  thresholdBand: string | null;
  differentiationBand: string | null;
  paceStatus: string | null;
  rubricVersion: string | null;
};

export type CommitmentHistory = {
  description: string;
  status: string;
  dueDate: Date | null;
  resolvedAt: Date | null;
};

export type DeepReviewContextInput = {
  scored: ScoredProfile;
  /** Deep reviews only — a check-in is not a baseline for one. */
  priorReviews: PriorReview[];
  /** Including abandoned: what a student drops is signal, not noise. */
  commitments: CommitmentHistory[];
  intendedMajor: string | null;
  careerGoal: string | null;
  schoolContext: string | null;
  now?: Date;
};

const TOKEN_BUDGET = 12000;

export function buildDeepReviewContext(
  input: DeepReviewContextInput,
): { text: string; estimatedTokens: number } {
  const now = input.now ?? new Date();
  const s = input.scored;
  const lines: string[] = [];

  lines.push(`Today: ${now.toISOString().slice(0, 10)}`);
  lines.push(
    `Grade: ${s.gradeLevel ?? "not stated"}${
      s.monthsUntilApplication != null
        ? ` · about ${s.monthsUntilApplication} months until applications`
        : ""
    }`,
  );

  // ── Stated direction, for the coherence section ───────────────────────────
  lines.push("");
  lines.push("## What the student says they want");
  lines.push(`- Intended major: ${input.intendedMajor ?? "not stated"}`);
  lines.push(`- Career goal: ${input.careerGoal ?? "not stated"}`);
  lines.push(
    `- School context: ${input.schoolContext ?? "NOT PROVIDED — grades cannot be read in context without it"}`,
  );

  // ── Computed standing ─────────────────────────────────────────────────────
  lines.push("");
  lines.push("## Standing (computed — do not recalculate)");
  lines.push(`- Requirements: ${s.thresholdBand}`);
  lines.push(`- Differentiation: ${s.differentiation.band}`);
  lines.push(
    `- Pace: ${
      s.pace.unknownGrade
        ? "no grade given, so no comparison was made"
        : `${s.pace.status} (expected top rung by this grade: index ${s.pace.expectedTopRungIndex}, expected sustained threads: ${s.pace.expectedSustainedThreads}; actual: ${s.differentiation.topRungIndex} and ${s.differentiation.sustainedThreadCount})`
    }`,
  );

  // ── Previous deep reviews, for the required opening comparison ────────────
  lines.push("");
  lines.push("## Previous deep reviews");
  if (input.priorReviews.length === 0) {
    lines.push(
      "- None. This is the first, so establish the baseline explicitly rather than comparing to nothing.",
    );
  } else {
    for (const r of input.priorReviews) {
      lines.push(
        `- ${r.createdAt.toISOString().slice(0, 10)}: requirements ${r.thresholdBand ?? "?"}, differentiation ${r.differentiationBand ?? "?"}, pace ${r.paceStatus ?? "?"} — "${r.headline}"` +
          (r.rubricVersion && r.rubricVersion !== s.rubricVersion
            ? ` [scored under ${r.rubricVersion}, not directly comparable to today's ${s.rubricVersion}]`
            : ""),
      );
    }
  }

  // ── Full activity history with rung progression ───────────────────────────
  lines.push("");
  lines.push("## Every activity, with how far it has been taken");
  if (s.differentiation.activities.length === 0) {
    lines.push("- None recorded.");
  } else {
    for (const a of s.differentiation.activities) {
      const moved =
        a.previousRung && a.previousRung !== a.rung
          ? ` (was ${a.previousRung})`
          : "";
      lines.push(
        `- [${a.id}] ${a.title} (${a.type}) — ${a.rung}: ${RUNG_LABELS[a.rung]}${moved}${
          a.months != null ? `, ${a.months} months` : ""
        }`,
      );
    }
  }

  if (s.differentiation.stalled.length > 0) {
    lines.push("");
    lines.push("## Threads that have not moved");
    lines.push(
      "Stated as an observation, not a criticism — some things are worth doing at the same level for years.",
    );
    for (const t of s.differentiation.stalled) {
      lines.push(`- ${t.title}: ${t.months} months at ${t.rung}`);
    }
  }

  // ── Commitment history, abandonment included ──────────────────────────────
  lines.push("");
  lines.push("## Commitments made in past reviews");
  if (input.commitments.length === 0) {
    lines.push("- None yet.");
  } else {
    for (const c of input.commitments) {
      lines.push(
        `- ${c.description} — ${c.status}` +
          (c.dueDate ? `, due ${c.dueDate.toISOString().slice(0, 10)}` : "") +
          (c.resolvedAt
            ? `, resolved ${c.resolvedAt.toISOString().slice(0, 10)}`
            : ""),
      );
    }
    const abandoned = input.commitments.filter((c) => c.status === "ABANDONED");
    if (abandoned.length > 0) {
      lines.push(
        `Note the pattern: ${abandoned.length} abandoned. What someone repeatedly drops is information about what will actually get done, and a plan that ignores it will be dropped too.`,
      );
    }
  }

  // ── Full threshold breakdown, per school, with sources ────────────────────
  lines.push("");
  lines.push("## Requirements, per target (computed — do not recalculate)");
  if (s.threshold.noDataForAnyTarget) {
    lines.push(
      "- No researched requirements for any target. Nothing has been checked; say so rather than implying nothing is required.",
    );
  } else {
    for (const school of s.threshold.schools) {
      lines.push(`### ${school.school} — ${school.course}`);
      for (const c of school.components) {
        lines.push(
          `- ${c.label}: ${c.state} — requires "${c.required}"` +
            (c.has ? `; student has ${c.has}` : "; student has not recorded this") +
            (c.state === "UNKNOWN"
              ? " (not mechanically comparable — say it has not been checked rather than judging it)"
              : ""),
        );
      }
    }
  }

  const text = lines.join("\n");
  return { text, estimatedTokens: Math.ceil(text.length / 4) };
}

export const DEEP_REVIEW_TOKEN_BUDGET = TOKEN_BUDGET;
