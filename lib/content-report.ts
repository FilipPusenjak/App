// The vocabulary of a content report. Shared by the form, the action and the
// operations queue, so the three cannot disagree about what a reason means.

export const REPORT_KINDS = [
  "EVALUATION",
  "PROJECTION",
  "SESSION_PREP",
  "PROGRESS_ARTIFACT",
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  EVALUATION: "Evaluation",
  PROJECTION: "Projection",
  SESSION_PREP: "Session prep",
  PROGRESS_ARTIFACT: "Progress briefing",
};

export const REPORT_REASONS = ["OFFENSIVE", "HARMFUL", "INACCURATE", "OTHER"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  OFFENSIVE: "Offensive or inappropriate",
  HARMFUL: "Hurtful or discouraging in a way it shouldn't be",
  INACCURATE: "Factually wrong",
  OTHER: "Something else",
};
