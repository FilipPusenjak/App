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

export const getModel = () => process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
export const getEffort = () => process.env.ANTHROPIC_EFFORT || DEFAULT_EFFORT;

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
