// The database half of check-in reminders. The rules live in reminders.ts.
import { prisma } from "@/lib/db";
import { canRunEvaluation } from "@/lib/evaluation/prerequisites";
import { mintUnsubscribeToken, type ReminderCandidate } from "./reminders";

/**
 * Everyone who might be due a reminder, with what the rules need to decide.
 *
 * Deliberately loads a WIDE set and lets reminderDecision reject most of it,
 * rather than encoding the rules into this query. The rules are the part worth
 * testing and the part that will be argued with; a query with them baked in
 * can only be checked by running it against a database.
 *
 * Counselor accounts are excluded at the source. A caseload account is not a
 * student and does not run check-ins on its own behalf.
 */
export async function reminderCandidates(): Promise<ReminderCandidate[]> {
  const users = await prisma.user.findMany({
    where: { counselorAccount: null },
    select: {
      id: true,
      email: true,
      name: true,
      remindersOptOutAt: true,
      remindersLastSentAt: true,
      profiles: {
        select: {
          _count: {
            select: {
              targetSchools: true,
              resumeItems: true,
              testScores: true,
            },
          },
          evaluations: {
            // Filtered to COMPLETED in the query, not afterwards. Taking the
            // newest run and then discarding it for not being completed lets a
            // later failure hide an earlier baseline — and that student, who
            // has run something and has been gone a month, is exactly who this
            // job exists to reach.
            where: { isSample: false, status: "completed" },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true },
          },
        },
      },
    },
  });

  return users.map((user) => {
    // An account can hold several students. The reminder is to the ACCOUNT, so
    // it is due when any of its profiles is due — the most recently active one
    // decides, and any evaluable profile makes the mail actionable.
    const runs = user.profiles.flatMap((p) => p.evaluations);
    const lastRunAt =
      runs.map((e) => e.createdAt).sort((a, b) => b.getTime() - a.getTime())[0] ??
      null;

    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      lastRunAt,
      hasBaseline: runs.length > 0,
      canRun: user.profiles.some((p) =>
        canRunEvaluation({
          targets: p._count.targetSchools,
          resumeItems: p._count.resumeItems,
          testScores: p._count.testScores,
        }),
      ),
      optedOutAt: user.remindersOptOutAt,
      lastRemindedAt: user.remindersLastSentAt,
    };
  });
}

/**
 * The account's unsubscribe token, minting one on first use.
 *
 * Every reminder must carry a working unsubscribe link, so this runs before
 * the send rather than after it — a message that goes out with no way to stop
 * the next one is the thing that gets a sender blocked.
 */
export async function unsubscribeTokenFor(userId: string): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { unsubscribeToken: true },
  });
  if (existing?.unsubscribeToken) return existing.unsubscribeToken;

  const token = mintUnsubscribeToken();
  await prisma.user.update({ where: { id: userId }, data: { unsubscribeToken: token } });
  return token;
}

/**
 * Record that a reminder went out.
 *
 * Called ONLY after the provider accepted the message. That ordering is what
 * makes the job safe to interrupt: a failed send leaves the timestamp alone
 * and is retried next run, and a successful one is never repeated inside the
 * cooling-off window.
 */
export async function markReminderSent(userId: string, at: Date = new Date()) {
  await prisma.user.update({
    where: { id: userId },
    data: { remindersLastSentAt: at },
  });
}

/**
 * Act on an unsubscribe link.
 *
 * Idempotent: a mail client that prefetches the URL, a second click, and a
 * forwarded copy all produce the same already-unsubscribed state rather than
 * an error page that reads like the unsubscribe did not work.
 *
 * The token is NOT rotated on use, for that reason — invalidating it would
 * turn the second click into a failure.
 */
export async function unsubscribeByToken(token: string): Promise<boolean> {
  const trimmed = token.trim();
  if (!trimmed) return false;

  const user = await prisma.user.findUnique({
    where: { unsubscribeToken: trimmed },
    select: { id: true, remindersOptOutAt: true },
  });
  if (!user) return false;

  const now = new Date();

  if (!user.remindersOptOutAt) {
    await prisma.user.update({
      where: { id: user.id },
      data: { remindersOptOutAt: now },
    });
  }

  // STOPS EVERY STREAM, not the one the link happened to arrive in. The columns
  // are separate so the two states can be represented independently, but a
  // person clicking "unsubscribe" means stop mailing me — honouring that
  // narrowly, and then sending them the other kind next week, is how a sender
  // earns a spam complaint it entirely deserves.
  //
  // updateMany rather than update: an account with no caseload matches nothing
  // and that is a no-op, not an error.
  await prisma.counselorAccount.updateMany({
    where: { userId: user.id, digestOptOutAt: null },
    data: { digestOptOutAt: now },
  });

  return true;
}
