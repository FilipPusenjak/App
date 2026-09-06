// Sending one email, or honestly declining to.
//
// Talks to Resend's REST API with fetch rather than through their SDK. One
// POST to one endpoint does not justify a dependency, and this keeps the
// provider behind a single function — the rest of the app asks for "send this
// message", and swapping providers is this file.
//
// NEVER THROWS. Every caller is doing something else that matters more: a
// password reset has already minted its token, and the nudge cron is halfway
// through a list of people. An email provider having a bad afternoon must not
// turn either of those into a 500. Callers get a result they can log and
// branch on, and the outcome is always written to the log here so a silent
// deployment is diagnosable from the console alone.
import { emailConfig, missingEmailConfig } from "./config";

export type EmailMessage = {
  to: string;
  subject: string;
  /** Required. The plain-text part is the message, not a fallback. */
  text: string;
  /** Optional richer version of exactly the same content. */
  html?: string;
  /**
   * One-click unsubscribe target, for anything that is not transactional.
   *
   * Rendered as List-Unsubscribe headers, which is what puts the "unsubscribe"
   * affordance in the mail client's own chrome. Gmail and friends increasingly
   * treat its absence on bulk mail as a spam signal, so this is deliverability
   * as much as courtesy.
   */
  unsubscribeUrl?: string;
};

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: "not-configured" | "rejected" | "unreachable"; detail: string };

/**
 * Send one message.
 *
 * "not-configured" is a normal answer on a deployment that has not set up a
 * sending domain, not an error: nothing is retried, nothing is logged as a
 * failure, and the caller carries on. See lib/email/config.ts for why unset
 * means silence rather than a best effort.
 */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const config = emailConfig();
  if (!config) {
    const detail = `email not sent (${missingEmailConfig().join(", ")} unset): ${message.subject}`;
    console.info(detail);
    return { ok: false, reason: "not-configured", detail };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.unsubscribeUrl
          ? {
              headers: {
                "List-Unsubscribe": `<${message.unsubscribeUrl}>`,
                // Tells the client the URL can be POSTed to directly, so
                // unsubscribing takes no round trip through a web page.
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            }
          : {}),
      }),
    });

    if (!response.ok) {
      // The body carries the provider's reason — an unverified domain, a
      // malformed From, a revoked key — and that sentence is the whole value
      // of this log line to whoever is trying to fix it.
      const detail = `email rejected (${response.status}): ${(await response.text()).slice(0, 500)}`;
      console.error(detail);
      return { ok: false, reason: "rejected", detail };
    }

    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: body?.id ?? null };
  } catch (error) {
    const detail = `email could not be sent: ${
      error instanceof Error ? error.message : "unknown error"
    }`;
    console.error(detail);
    return { ok: false, reason: "unreachable", detail };
  }
}
