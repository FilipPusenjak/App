// Per-user rate limiting for the evaluation endpoint.
//
// Evaluations cost real money per call, so the endpoint is limited per
// authenticated user id (never per IP, and never trusting anything the client
// sends).
//
// SCOPE: this is an in-memory limiter. It is correct for local development and
// a single server process, and it resets on restart. It does NOT hold across
// multiple instances or serverless invocations. It is deliberately written
// behind the RateLimiter interface so swapping in a database- or Redis-backed
// implementation later is a one-file change with no caller edits.

export type RateLimitResult =
  | { ok: true }
  | { ok: false; reason: "cooldown" | "hourly"; retryAfterSeconds: number };

export interface RateLimiter {
  check(key: string): Promise<RateLimitResult>;
}

/** Minimum gap between two evaluations by the same user. */
export const COOLDOWN_SECONDS = 20;
/** Maximum evaluations per user per rolling hour. */
export const MAX_PER_HOUR = 10;

const HOUR_MS = 60 * 60 * 1000;

class InMemoryRateLimiter implements RateLimiter {
  // key -> timestamps (ms) of accepted requests within the last hour
  private hits = new Map<string, number[]>();

  async check(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter(
      (t) => now - t < HOUR_MS,
    );

    const last = recent[recent.length - 1];
    if (last != null && now - last < COOLDOWN_SECONDS * 1000) {
      return {
        ok: false,
        reason: "cooldown",
        retryAfterSeconds: Math.ceil(
          (COOLDOWN_SECONDS * 1000 - (now - last)) / 1000,
        ),
      };
    }

    if (recent.length >= MAX_PER_HOUR) {
      const oldest = recent[0]!;
      return {
        ok: false,
        reason: "hourly",
        retryAfterSeconds: Math.ceil((HOUR_MS - (now - oldest)) / 1000),
      };
    }

    recent.push(now);
    this.hits.set(key, recent);
    return { ok: true };
  }
}

// Survive dev hot-reloads so the limit isn't reset on every code change.
const globalForLimiter = globalThis as unknown as {
  evaluationRateLimiter?: RateLimiter;
};

export const evaluationRateLimiter: RateLimiter =
  globalForLimiter.evaluationRateLimiter ?? new InMemoryRateLimiter();

if (process.env.NODE_ENV !== "production") {
  globalForLimiter.evaluationRateLimiter = evaluationRateLimiter;
}
