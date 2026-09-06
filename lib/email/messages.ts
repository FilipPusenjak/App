// What the emails actually say.
//
// PURE — these build a message from its inputs and send nothing, so the
// wording is testable without a provider and without a database.
//
// Both are written as text first. The HTML is the same sentences with links
// made clickable, never extra content, so a client that shows the plain part
// loses nothing — and neither does a student reading it on a phone in a
// stripped-down mail app.
//
// HOUSE STYLE, same as the rest of the app: no exclamation marks, no
// "Hi there!", no invented urgency. These go to teenagers about their
// university applications, and a manufactured deadline is the one thing that
// would make this app feel like every other thing shouting at them.

import type { EmailMessage } from "./send";
import { oneClickUnsubscribeUrl, unsubscribeUrl } from "./reminders";

/** Minimal escaping for the values interpolated into the HTML parts. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A password reset link.
 *
 * Says how long it lasts, because the token really does expire in an hour and
 * somebody opening this the next morning needs to know why it did not work
 * rather than conclude the app is broken.
 *
 * Does NOT say who requested it or from where. An unrequested reset email is
 * either a typo or somebody probing, and neither is improved by reporting an
 * IP address to a fifteen-year-old.
 */
export function passwordResetEmail(input: {
  to: string;
  resetUrl: string;
  ttlMinutes: number;
}): EmailMessage {
  const { to, resetUrl, ttlMinutes } = input;

  const text = [
    "Someone asked to reset the password for this account.",
    "",
    "Choose a new one here:",
    resetUrl,
    "",
    `That link works once and expires in ${ttlMinutes} minutes.`,
    "",
    "If it wasn't you, you can ignore this. Your password has not changed,",
    "and nobody can get in without opening the link above.",
  ].join("\n");

  const html = [
    "<p>Someone asked to reset the password for this account.</p>",
    `<p><a href="${escapeHtml(resetUrl)}">Choose a new password</a></p>`,
    `<p>That link works once and expires in ${ttlMinutes} minutes.</p>`,
    "<p>If it wasn't you, you can ignore this. Your password has not changed, ",
    "and nobody can get in without opening the link above.</p>",
    // Repeated in full because a mail client that strips the anchor leaves the
    // recipient with a message about a link they cannot reach.
    `<p style="color:#666;font-size:12px">If the link doesn't work, paste this into your browser:<br>${escapeHtml(resetUrl)}</p>`,
  ].join("");

  return { to, subject: "Reset your password", text, html };
}

/**
 * The fortnightly nudge: a check-in is available.
 *
 * The honest framing of what this is FOR. Of the students on the deployment
 * when this was written, not one had come back on a later day than they signed
 * up — and the product's whole loop is a check-in every fortnight. Nothing
 * brought anybody back, because nothing could.
 *
 * So it says what changed and what it takes, and it does not pretend to know
 * something it does not. It never claims their profile has improved, never
 * implies a deadline, and never states or hints at odds of admission — the
 * same rule the evaluations themselves are held to.
 */
export function checkInNudgeEmail(input: {
  to: string;
  /** The student's own name, when the account has one. */
  name: string | null;
  /** Whole days since their last real run. */
  daysSince: number;
  appUrl: string;
  /** The account's unsubscribe secret; both link forms are built from it. */
  unsubscribeToken: string;
}): EmailMessage {
  const { to, name, daysSince, appUrl, unsubscribeToken } = input;
  const greeting = name ? `${name}, it's` : "It's";
  const checkInUrl = `${appUrl}/evaluations`;
  // The visible link renders a page that says what happened; the header link
  // accepts the client's one-click POST. Same token, same effect.
  const visibleUnsubscribe = unsubscribeUrl(appUrl, unsubscribeToken);
  const headerUnsubscribe = oneClickUnsubscribeUrl(appUrl, unsubscribeToken);

  const text = [
    `${greeting} been ${daysSince} days since your last check-in.`,
    "",
    "A check-in looks at what's changed since then and tells you whether you're",
    "on pace — it takes a minute, and often it costs nothing at all, because",
    "when nothing material has moved it says so without running anything.",
    "",
    `Run one here: ${checkInUrl}`,
    "",
    "If anything happened that your profile doesn't capture yet — a result, a",
    "conversation, a plan that changed — add it on your dashboard first. The",
    "check-in reads those before anything else.",
    "",
    "—",
    `Don't want these? Unsubscribe: ${visibleUnsubscribe}`,
  ].join("\n");

  const html = [
    `<p>${escapeHtml(greeting)} been ${daysSince} days since your last check-in.</p>`,
    "<p>A check-in looks at what's changed since then and tells you whether ",
    "you're on pace — it takes a minute, and often it costs nothing at all, ",
    "because when nothing material has moved it says so without running anything.</p>",
    `<p><a href="${escapeHtml(checkInUrl)}">Run a check-in</a></p>`,
    "<p>If anything happened that your profile doesn't capture yet — a result, ",
    "a conversation, a plan that changed — add it on your dashboard first. The ",
    "check-in reads those before anything else.</p>",
    `<p style="color:#666;font-size:12px"><a href="${escapeHtml(visibleUnsubscribe)}">Unsubscribe from these reminders</a></p>`,
  ].join("");

  return {
    to,
    subject: "Your check-in is ready",
    text,
    html,
    // Bulk mail. The header is what puts an unsubscribe control in the mail
    // client's own chrome, and its absence is treated as a spam signal.
    unsubscribeUrl: headerUnsubscribe,
  };
}
