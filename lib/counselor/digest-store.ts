// The database half of the triage digest. The rules live in digest.ts.
//
// Reads only what the mail is allowed to say — a student's name and the shape
// of their signals. No basis, no score, no band: see counselorDigestEmail for
// why the mail names students and nothing else about them.
//
// Loading a signal here is NOT a counselor read of a student's record and is
// deliberately not logged as one. Nobody has looked at anything yet; a machine
// counted rows to decide whether to send a message. The read log records a
// human opening a student's file, and diluting it with cron activity would make
// it useless as the thing a student is shown about who accessed their data.
import { prisma } from "@/lib/db";
import { unsubscribeTokenFor } from "@/lib/email/reminders-store";
import type { DigestCandidate, DigestStudent } from "./digest";

/**
 * Every counselor who might be due a digest, with what the rules need.
 *
 * Deliberately loads a WIDE set and lets digestDecision reject most of it,
 * rather than encoding the rules into this query — the rules are the part worth
 * testing and the part that will be argued with, and a query with them baked in
 * can only be checked against a database.
 *
 * An account with no email cannot be mailed and is dropped here rather than
 * failing later: it is a fact about the row, not a decision about cadence.
 */
export async function digestCandidates(): Promise<DigestCandidate[]> {
  const accounts = await prisma.counselorAccount.findMany({
    select: {
      id: true,
      orgName: true,
      digestOptOutAt: true,
      digestLastSentAt: true,
      user: { select: { email: true } },
      links: {
        // The same conditions the caseload page reads: a link the counselor
        // cannot currently see is not one they can act on, and naming that
        // student in mail would be a disclosure without a live consent behind
        // it.
        where: {
          status: "ACTIVE",
          endedAt: null,
          studentConsentAt: { not: null },
          guardianConsentAt: { not: null },
        },
        select: {
          id: true,
          studentProfile: { select: { studentName: true } },
          signals: {
            where: { resolvedAt: null },
            select: { severity: true, computedAt: true },
          },
        },
      },
    },
  });

  return accounts.map((account) => {
    const students: DigestStudent[] = [];

    for (const link of account.links) {
      if (link.signals.length === 0) continue;
      students.push({
        linkId: link.id,
        name: link.studentProfile.studentName,
        topSeverity: Math.max(...link.signals.map((s) => s.severity)),
        signalCount: link.signals.length,
        newestSignalAt: link.signals
          .map((s) => s.computedAt)
          .reduce((newest, at) => (at > newest ? at : newest)),
      });
    }

    return {
      counselorAccountId: account.id,
      email: account.user.email,
      orgName: account.orgName,
      students,
      optedOutAt: account.digestOptOutAt,
      lastDigestAt: account.digestLastSentAt,
    };
  });
}

/**
 * The unsubscribe secret for the human behind this counselor account.
 *
 * Reuses User.unsubscribeToken rather than minting a second one. It is one
 * bearer credential per person scoped to one action — stopping mail — and a
 * second token would mean two links to honour, two ways to leak, and a person
 * who unsubscribed once still receiving the other stream.
 */
export async function digestUnsubscribeTokenFor(
  counselorAccountId: string,
): Promise<string> {
  const account = await prisma.counselorAccount.findUniqueOrThrow({
    where: { id: counselorAccountId },
    select: { userId: true },
  });
  // Delegated so there is exactly one place that mints and stores this.
  return unsubscribeTokenFor(account.userId);
}

/**
 * Record that a digest went out.
 *
 * Called ONLY after the provider accepted the message — the same ordering the
 * check-in nudge uses, and for the same reason: a failed send leaves the
 * timestamp alone and is retried tomorrow, a successful one cannot repeat
 * inside the cooling-off window, and a cron that fires twice cannot mail
 * anybody twice.
 */
export async function markDigestSent(
  counselorAccountId: string,
  at: Date = new Date(),
) {
  await prisma.counselorAccount.update({
    where: { id: counselorAccountId },
    data: { digestLastSentAt: at },
  });
}
