// Who may run a deep review, and how often.
//
// Two separate gates with different reasons, deliberately not collapsed:
//
//   ENTITLEMENT is commercial. Deep reviews run on the expensive model with
//   three times the context, so they belong to the paid tier.
//
//   THE 21-DAY FLOOR IS PEDAGOGICAL, and applies even to a user with quota left.
//   Strategy re-litigated weekly produces thrash: a student who rewrites their
//   plan every fortnight builds nothing that compounds, and the app would be
//   selling them the feeling of progress instead of progress. It is enforced
//   server-side and explained plainly, because a limit a user cannot see the
//   reason for reads as a paywall.
//
// Pure: no database. The callers pass in what they loaded.

export const DEEP_REVIEW_INTERVAL_DAYS = 21;

export const TIERS = ["FREE", "PAID"] as const;
export type Tier = (typeof TIERS)[number];

/**
 * This account's tier.
 *
 * There is no billing system in this app yet, so this is the seam where one
 * plugs in. It reads an allowlist rather than defaulting everyone to PAID:
 * defaulting open would make the entitlement test pass while gating nothing,
 * which is the failure that only shows up on the first real invoice.
 */
export function tierForUser(user: { email: string | null }): Tier {
  const allow = (process.env.DEEP_REVIEW_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  // Unset means nobody is on the paid tier yet — the honest state before
  // billing exists. Set DEEP_REVIEW_ALLOWED_EMAILS=* to open it to everyone.
  if (allow.includes("*")) return "PAID";
  const email = user.email?.trim().toLowerCase();
  return email && allow.includes(email) ? "PAID" : "FREE";
}

export type DeepReviewGate =
  | { allowed: true }
  | { allowed: false; reason: "tier"; message: string }
  | {
      allowed: false;
      reason: "interval";
      message: string;
      nextAllowedAt: Date;
      daysRemaining: number;
    };

export function checkDeepReviewAllowed(input: {
  tier: Tier;
  lastDeepReviewAt: Date | null;
  now?: Date;
}): DeepReviewGate {
  if (input.tier !== "PAID") {
    return {
      allowed: false,
      reason: "tier",
      message:
        "Deep Reviews are part of the paid plan. Your fortnightly Check-Ins keep working either way.",
    };
  }

  const now = input.now ?? new Date();
  if (!input.lastDeepReviewAt) return { allowed: true };

  const nextAllowedAt = new Date(
    input.lastDeepReviewAt.getTime() + DEEP_REVIEW_INTERVAL_DAYS * 86_400_000,
  );
  if (now.getTime() >= nextAllowedAt.getTime()) return { allowed: true };

  const daysRemaining = Math.ceil(
    (nextAllowedAt.getTime() - now.getTime()) / 86_400_000,
  );
  return {
    allowed: false,
    reason: "interval",
    message:
      `Your last Deep Review was less than ${DEEP_REVIEW_INTERVAL_DAYS} days ago. ` +
      `This gap is on purpose: a plan rewritten every week never gets far enough to show whether it was working. ` +
      `Your next one is available in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} — Check-Ins carry on in the meantime.`,
    nextAllowedAt,
    daysRemaining,
  };
}
