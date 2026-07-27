// Per-user rate limiting for the evaluation endpoint.
//
// Evaluations cost real money per call, so the endpoint is limited per
// authenticated user id (never per IP, and never trusting anything the client
// sends).
//
// The limiter is backed by the Evaluation table rather than process memory.
// That matters once deployed: serverless platforms run many short-lived
// instances, so an in-memory counter would reset constantly and enforce nothing.
// The evaluation rows ARE the record of what was spent, which makes them the
// correct source of truth — no extra table, and it survives restarts and scales
// across instances for free.
import { prisma } from "@/lib/db";

export type RateLimitResult =
  | { ok: true }
  | { ok: false; reason: "cooldown" | "hourly"; retryAfterSeconds: number };

export interface RateLimiter {
  check(userId: string): Promise<RateLimitResult>;
}

/** Minimum gap between two evaluations by the same user. */
export const COOLDOWN_SECONDS = Number(
  process.env.EVAL_COOLDOWN_SECONDS ?? 20,
);
/** Maximum billable evaluations per user per rolling hour. */
export const MAX_PER_HOUR = Number(process.env.EVAL_MAX_PER_HOUR ?? 10);

const HOUR_MS = 60 * 60 * 1000;

class DatabaseRateLimiter implements RateLimiter {
  async check(userId: string): Promise<RateLimitResult> {
    const now = Date.now();

    // Cooldown applies to every attempt, including samples — it exists to stop
    // the endpoint being hammered, not just to control spend.
    const mostRecent = await prisma.evaluation.findFirst({
      where: { profile: { userId } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    if (mostRecent) {
      const sinceLast = now - mostRecent.createdAt.getTime();
      if (sinceLast < COOLDOWN_SECONDS * 1000) {
        return {
          ok: false,
          reason: "cooldown",
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((COOLDOWN_SECONDS * 1000 - sinceLast) / 1000),
          ),
        };
      }
    }

    // The hourly cap counts only billable runs. Samples cost nothing, so they
    // shouldn't lock a user out while they're still trying the app without a key.
    const windowStart = new Date(now - HOUR_MS);
    const billable = await prisma.evaluation.findMany({
      where: {
        profile: { userId },
        isSample: false,
        createdAt: { gte: windowStart },
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });

    if (billable.length >= MAX_PER_HOUR) {
      const oldest = billable[0]!.createdAt.getTime();
      return {
        ok: false,
        reason: "hourly",
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((HOUR_MS - (now - oldest)) / 1000),
        ),
      };
    }

    return { ok: true };
  }
}

export const evaluationRateLimiter: RateLimiter = new DatabaseRateLimiter();
