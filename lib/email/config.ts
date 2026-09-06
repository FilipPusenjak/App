// Whether this deployment can send email, and where links in it should point.
//
// PURE — no network, no database, no provider SDK. Everything here is a
// decision about environment variables, which is exactly the part worth
// testing directly and exactly the part that silently goes wrong.
//
// FAILS CLOSED, like CRON_SECRET and OPERATOR_EMAILS before it: unset means
// this deployment sends nothing, rather than sends badly. That is not a
// placeholder state, it is the correct one until a domain is verified —
// sending from an unverified domain gets the mail rejected or filed as spam,
// and a password reset in someone's spam folder is worse than a page that
// honestly says to ask the operator.

/** The provider's API key. Absent on any deployment that has not set one up. */
const apiKey = () => process.env.RESEND_API_KEY?.trim() || "";

/**
 * The From address, which must be on a domain verified with the provider.
 *
 * Deliberately has no default. A plausible-looking fallback
 * (noreply@<the app's host>) would be a domain nobody has verified, so every
 * send would fail at the provider — and it would fail LATER, in production,
 * rather than here where the reason is obvious.
 */
const from = () => process.env.EMAIL_FROM?.trim() || "";

export type EmailConfig = {
  apiKey: string;
  from: string;
  /** Absolute origin for links, with no trailing slash. */
  appUrl: string;
};

/**
 * Where this app is served from.
 *
 * Same resolution order as scripts/reset-link.ts, and for the same reason
 * given there: a link to the wrong host looks right and goes nowhere. Returns
 * null rather than guessing localhost, which is the address of the one machine
 * the recipient is definitely not using.
 */
export function resolveAppUrl(
  // Only the four keys it reads, rather than the whole ProcessEnv — a caller
  // testing this should not have to supply NODE_ENV to ask a question about
  // APP_URL.
  env: Partial<
    Record<"APP_URL" | "AUTH_URL" | "NEXTAUTH_URL" | "VERCEL_URL", string | undefined>
  > = process.env as Record<string, string | undefined>,
): string | null {
  const candidate =
    env.APP_URL ||
    env.AUTH_URL ||
    env.NEXTAUTH_URL ||
    (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined);
  const trimmed = candidate?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : null;
}

/**
 * The configuration, or null when this deployment cannot send.
 *
 * All three parts are required together. A key with no From address cannot
 * send, and either of them without an app URL sends mail whose links go
 * nowhere — which for a password reset is the entire content of the message.
 */
export function emailConfig(): EmailConfig | null {
  const key = apiKey();
  const sender = from();
  const url = resolveAppUrl();
  if (!key || !sender || !url) return null;
  return { apiKey: key, from: sender, appUrl: url };
}

/** True when this deployment is set up to send. */
export function canSendEmail(): boolean {
  return emailConfig() !== null;
}

/**
 * What is missing, for an operator reading a log line.
 *
 * Names the variables rather than saying "email is not configured", because
 * the person reading it is trying to find out which one they forgot.
 */
export function missingEmailConfig(): string[] {
  const missing: string[] = [];
  if (!apiKey()) missing.push("RESEND_API_KEY");
  if (!from()) missing.push("EMAIL_FROM");
  if (!resolveAppUrl()) missing.push("APP_URL");
  return missing;
}
