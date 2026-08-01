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
 * "1h" is the default because the real pattern is read the evaluation, edit
 * the profile for a while, run it again — gaps that a 5-minute cache almost
 * never survives. It pays from the third run in an hour; "5m" pays from the
 * second, but only if the runs are minutes apart. Set ANTHROPIC_CACHE_TTL to
 * "5m" if your runs are bursty, or "off" to disable caching entirely.
 */
export const DEFAULT_CACHE_TTL = "1h";

export const getModel = () => process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
export const getEffort = () => process.env.ANTHROPIC_EFFORT || DEFAULT_EFFORT;

/**
 * The cache_control value to attach to a stable prompt block, or undefined
 * when caching is switched off.
 */
export function getCacheControl():
  | { type: "ephemeral"; ttl?: "5m" | "1h" }
  | undefined {
  const ttl = process.env.ANTHROPIC_CACHE_TTL || DEFAULT_CACHE_TTL;
  if (ttl === "off") return undefined;
  if (ttl === "5m") return { type: "ephemeral" };
  return { type: "ephemeral", ttl: "1h" };
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
