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

/** Effort for projections. Lower than evaluations: less to weigh up. */
export const DEFAULT_PROJECTION_EFFORT = "low";

export const getModel = () => process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
export const getEffort = () => process.env.ANTHROPIC_EFFORT || DEFAULT_EFFORT;

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
