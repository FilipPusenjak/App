// One pass of the triage digest: load candidates, apply the rules, send, record.
//
// Shaped exactly like lib/email/reminders-pass.ts, including returning a summary
// rather than a Response — its caller reports on several jobs at once and cannot
// hand back somebody else's.
//
// RIDES THE DAILY CRON rather than having a schedule of its own, for the same
// reason the check-in nudge does: Vercel's Hobby plan caps the project at two
// entries and both are spent. Running daily does not mail anybody daily —
// DIGEST_COOLDOWN_DAYS bounds the cadence, and the schedule only decides how
// soon news is noticed. See app/api/cron/daily/route.ts.
import { emailConfig } from "@/lib/email/config";
import { counselorDigestEmail } from "@/lib/email/messages";
import { sendEmail } from "@/lib/email/send";
import { DIGEST_STUDENT_LIMIT, digestsToSend } from "./digest";
import {
  digestCandidates,
  digestUnsubscribeTokenFor,
  markDigestSent,
} from "./digest-store";

export type DigestPassResult =
  | { configured: false; sent: 0; considered: 0; failed: 0 }
  | { configured: true; considered: number; sent: number; failed: number };

export async function runDigestPass(): Promise<DigestPassResult> {
  const config = emailConfig();
  if (!config) {
    // Not an error. Reported plainly so a scheduled run on an unconfigured
    // deployment reads as "nothing to do" rather than as a silent failure.
    return { configured: false, sent: 0, considered: 0, failed: 0 };
  }

  const due = digestsToSend(await digestCandidates());

  let sent = 0;
  const failed: string[] = [];

  for (const { candidate, students, newSince } of due) {
    // Minted BEFORE the send, so no digest can go out without a working way to
    // stop the next one.
    const token = await digestUnsubscribeTokenFor(candidate.counselorAccountId);

    const result = await sendEmail(
      counselorDigestEmail({
        to: candidate.email,
        orgName: candidate.orgName,
        // Truncated here rather than in the message builder, so the builder
        // stays a pure rendering of what it is handed and the count it reports
        // as "and N more" is arithmetic it can do from its own inputs.
        students: students.slice(0, DIGEST_STUDENT_LIMIT),
        newSince,
        totalNeedingAttention: students.length,
        appUrl: config.appUrl,
        unsubscribeToken: token,
      }),
    );

    if (result.ok) {
      // Only now. A send that failed leaves the timestamp untouched and is
      // retried on the next pass; one that succeeded is never repeated inside
      // the cooling-off window. That ordering is what makes this job safe to
      // run twice or to die halfway through.
      await markDigestSent(candidate.counselorAccountId);
      sent += 1;
    } else {
      failed.push(result.reason);
    }
  }

  return {
    configured: true,
    considered: due.length,
    sent,
    failed: failed.length,
  };
}
