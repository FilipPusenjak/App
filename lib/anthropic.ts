// Anthropic client — SERVER ONLY.
//
// This module must never be imported into a client component. The API key is
// read from the server environment (.env.local, gitignored) and is never sent
// to the browser; the only thing the browser can do is POST to /api/evaluate.
import Anthropic from "@anthropic-ai/sdk";

/**
 * Model id. Verified against the current Anthropic model list rather than
 * assumed — override in .env.local if you want a different one.
 */
export const DEFAULT_MODEL = "claude-opus-5";

/**
 * Effort controls how much the model thinks, trading cost against depth.
 * "medium" is a deliberate cost/quality balance for a solo project; raise to
 * "high" in .env.local if you want more thorough evaluations.
 */
export const DEFAULT_EFFORT = "medium";

/**
 * Model for "what if I did these things" projections.
 *
 * Deliberately a cheaper model than the evaluation. A projection is a lighter
 * task — it reasons forward from scores an evaluation already established,
 * rather than judging a whole profile from scratch — and it is the run a
 * student will repeat most while experimenting with plans.
 */
export const DEFAULT_PROJECTION_MODEL = "claude-sonnet-5";

/**
 * Effort for projections.
 *
 * Was "low" for cost. Low effort is the least consistent setting in the app,
 * and projections are the one output a student runs repeatedly and compares
 * against itself — so instability there is far more damaging than the saving is
 * worth. Still cheaper than an evaluation, which uses a bigger model.
 */
export const DEFAULT_PROJECTION_EFFORT = "medium";

/**
 * How long a cached prompt prefix is kept.
 *
 * Nearly 90% of an evaluation's input is byte-identical on every run — the
 * system prompt and the rubrics — so it is worth caching. The economics:
 * reads cost 0.1x, but WRITES cost 1.25x at 5 minutes and 2x at an hour. So a
 * student who runs once and stops pays slightly MORE than with no cache at
 * all, and the choice of TTL is really a bet on how they use it.
 *
 * "1h" is the window, but whether an entry is written at all now depends on
 * whether one plausibly still exists to read — see getCacheControl. Set
 * ANTHROPIC_CACHE_TTL to "5m" for a shorter window, "always" to write on every
 * run regardless, or "off" to disable caching entirely.
 */
export const DEFAULT_CACHE_TTL = "1h";

export const getModel = () => process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
export const getEffort = () => process.env.ANTHROPIC_EFFORT || DEFAULT_EFFORT;

/** How long an entry survives, for deciding whether one still exists. */
export const CACHE_TTL_MS: Record<"5m" | "1h", number> = {
  "5m": 5 * 60 * 1000,
  "1h": 60 * 60 * 1000,
};

/**
 * The cache_control value to attach to a stable prompt block, or undefined
 * when a cache entry should NOT be written.
 *
 * `lastRunAt` is the decisive argument and the reason this is not a constant.
 * A cache WRITE costs 2x base input; a read costs 0.1x. So writing an entry
 * nobody reads is an 89% surcharge on the cached portion, and for someone who
 * runs an evaluation, reads it, and comes back tomorrow, EVERY run is that
 * surcharge. Caching shipped as an unconditional default and made those runs
 * substantially more expensive — the opposite of the intent.
 *
 * So an entry is written only when one plausibly still exists to be read: the
 * previous run was recent enough to be inside the TTL. Cold, occasional runs
 * pay base price and no premium; a counselor working through several students,
 * or anyone iterating, gets the hit and the saving.
 *
 * Set ANTHROPIC_CACHE_TTL to "off" to disable entirely, or "always" to write
 * unconditionally (worth it only under steady traffic from many users).
 */
export function getCacheControl(
  lastRunAt: Date | null | undefined,
): { type: "ephemeral"; ttl?: "5m" | "1h" } | undefined {
  const setting = process.env.ANTHROPIC_CACHE_TTL || DEFAULT_CACHE_TTL;
  if (setting === "off") return undefined;

  const ttl = setting === "5m" ? "5m" : "1h";
  const control =
    ttl === "5m"
      ? ({ type: "ephemeral" } as const)
      : ({ type: "ephemeral", ttl: "1h" } as const);

  if (setting === "always") return control;

  // No previous run means nothing to read back: a first evaluation would pay
  // the write premium for an entry that expires unused far more often than not.
  if (!lastRunAt) return undefined;

  // Written with a margin, because an entry that expired seconds ago is a
  // write at 2x rather than the read it was gambling on.
  const elapsed = Date.now() - lastRunAt.getTime();
  return elapsed < CACHE_TTL_MS[ttl] * 0.9 ? control : undefined;
}

export const getProjectionModel = () =>
  process.env.ANTHROPIC_PROJECTION_MODEL || DEFAULT_PROJECTION_MODEL;
export const getProjectionEffort = () =>
  process.env.ANTHROPIC_PROJECTION_EFFORT || DEFAULT_PROJECTION_EFFORT;

/** True when a real API key is configured. */
export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/**
 * The client, or null when no key is set. Returning null (instead of throwing)
 * is what lets the app fall back to a clearly-labelled sample evaluation so the
 * whole feature can be exercised before billing is sorted out.
 */
export function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}
